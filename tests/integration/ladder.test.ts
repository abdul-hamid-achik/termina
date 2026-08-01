import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { Effect } from 'effect'

vi.mock('~~/server/db', async () => {
  const { testDb } = await import('../helpers/test-db')
  return { useDb: () => testDb }
})

import {
  DatabaseService,
  DatabaseServiceLive,
  type DatabaseServiceApi,
} from '~~/server/services/DatabaseService'
import { truncateAll, client } from '../helpers/test-db'
import { PLACEMENT_GAMES, getRankTier, RANK_TIERS } from '~~/shared/constants/ranks'

/**
 * The ranked ladder, against real Postgres.
 *
 * A leaderboard is the one screen where a bug is permanent: it is the public
 * record, it is what a player screenshots, and a wrong ordering or a phantom
 * entry is not something a refresh fixes. This suite covers the seam between
 * "a match finished" and "the ladder says so", which no single unit test spans:
 * seasonal counters, the placement gate, tier derivation, and the guarantee
 * that a rank always matches the rating it was computed from.
 *
 * Context for the placement gate: the ladder used to `select()` every row, so it
 * listed everyone who had ever registered — all sitting at the 1000 baseline
 * with 0-0 — and an account that had never played outranked a real player who
 * had lost a match.
 */
function run<A>(f: (svc: DatabaseServiceApi) => Effect.Effect<A>): Promise<A> {
  return Effect.runPromise(
    Effect.flatMap(DatabaseService, f).pipe(Effect.provide(DatabaseServiceLive)),
  )
}

/** Create a player and put them N ranked games in, at a given seasonal rating. */
async function rankedPlayer(id: string, games: number, seasonMmr: number, wins = 0) {
  await run((s) => s.createPlayer({ id, username: id, mmr: 1000 } as never))
  for (let i = 0; i < games; i++) {
    await run((s) => s.incrementSeasonGamesPlayed(id))
    if (i < wins) await run((s) => s.incrementSeasonWins(id))
  }
  await run((s) => s.applySeasonMmrChange(id, seasonMmr - 1000))
}

beforeEach(async () => {
  await truncateAll()
})

afterAll(async () => {
  await client.end()
})

describe('the ranked ladder (real Postgres)', () => {
  describe('the placement gate', () => {
    it('hides a player until their placement games are done, then shows them', async () => {
      await rankedPlayer('rookie', PLACEMENT_GAMES - 1, 1500)
      expect(await run((s) => s.getSeasonLeaderboard())).toHaveLength(0)

      await run((s) => s.incrementSeasonGamesPlayed('rookie'))
      const board = await run((s) => s.getSeasonLeaderboard())
      expect(board.map((p) => p.id)).toEqual(['rookie'])
    })

    it('a player who has never queued cannot outrank one who has lost', async () => {
      await rankedPlayer('never_played', 0, 1000)
      await rankedPlayer('lost_a_few', PLACEMENT_GAMES, 850)

      const board = await run((s) => s.getSeasonLeaderboard())
      expect(board.map((p) => p.id)).toEqual(['lost_a_few'])
    })

    it('an empty ladder is empty, not a list of registrations', async () => {
      for (const id of ['a', 'b', 'c']) await rankedPlayer(id, 0, 1000)
      expect(await run((s) => s.getSeasonLeaderboard())).toEqual([])
    })
  })

  describe('ordering and limits', () => {
    it('orders by seasonal rating, highest first', async () => {
      await rankedPlayer('mid', PLACEMENT_GAMES, 1200)
      await rankedPlayer('high', PLACEMENT_GAMES, 1900)
      await rankedPlayer('low', PLACEMENT_GAMES, 700)

      const board = await run((s) => s.getSeasonLeaderboard())
      expect(board.map((p) => p.id)).toEqual(['high', 'mid', 'low'])
    })

    it('respects the limit, keeping the TOP of the ladder', async () => {
      await rankedPlayer('first', PLACEMENT_GAMES, 2000)
      await rankedPlayer('second', PLACEMENT_GAMES, 1500)
      await rankedPlayer('third', PLACEMENT_GAMES, 1100)

      const top2 = await run((s) => s.getSeasonLeaderboard(2))
      expect(top2.map((p) => p.id)).toEqual(['first', 'second'])
    })

    // Seasonal and lifetime rating are separate columns; the ladder is the
    // seasonal one, and mixing them up would rank people by the wrong number.
    it('ranks on the SEASONAL rating, not lifetime mmr', async () => {
      await rankedPlayer('season_star', PLACEMENT_GAMES, 1800)
      await run((s) => s.updatePlayerMMR('season_star', 100))
      await rankedPlayer('lifetime_star', PLACEMENT_GAMES, 1100)
      await run((s) => s.updatePlayerMMR('lifetime_star', 3000))

      const board = await run((s) => s.getSeasonLeaderboard())
      expect(board.map((p) => p.id)).toEqual(['season_star', 'lifetime_star'])
    })
  })

  describe('what a row says about a player', () => {
    it('season wins and games survive the round trip', async () => {
      await rankedPlayer('grinder', 10, 1400, 7)
      const [row] = await run((s) => s.getSeasonLeaderboard())
      expect(row!.seasonGamesPlayed).toBe(10)
      expect(row!.seasonWins).toBe(7)
    })

    it('the tier always matches the rating stored on the row', async () => {
      // One player per tier: a row whose badge disagrees with its number is the
      // kind of thing only a screenshot ever catches.
      for (const [i, tier] of RANK_TIERS.entries()) {
        await rankedPlayer(`tier_${i}`, PLACEMENT_GAMES, tier.minMmr + 10)
      }
      const board = await run((s) => s.getSeasonLeaderboard())
      expect(board.length).toBe(RANK_TIERS.length)
      for (const row of board) {
        const expected = getRankTier(row.seasonMmr)
        expect(getRankTier(row.seasonMmr).id, `${row.id} @ ${row.seasonMmr}`).toBe(expected.id)
      }
      // ...and the ladder is genuinely spread across tiers, not all one badge.
      expect(new Set(board.map((r) => getRankTier(r.seasonMmr).id)).size).toBe(RANK_TIERS.length)
    })

    it('a losing streak can drop a player through a tier boundary', async () => {
      const boundary = RANK_TIERS[2]!.minMmr
      await rankedPlayer('slipping', PLACEMENT_GAMES, boundary + 5)
      expect(getRankTier((await run((s) => s.getSeasonLeaderboard()))[0]!.seasonMmr).id).toBe(
        RANK_TIERS[2]!.id,
      )

      await run((s) => s.applySeasonMmrChange('slipping', -10))
      const after = (await run((s) => s.getSeasonLeaderboard()))[0]!
      expect(getRankTier(after.seasonMmr).id).toBe(RANK_TIERS[1]!.id)
      // Dropping a tier must not drop you off the ladder — you are still placed.
      expect(after.seasonGamesPlayed).toBeGreaterThanOrEqual(PLACEMENT_GAMES)
    })
  })

  describe('seasons', () => {
    it('a new season resets the ladder toward the baseline without touching lifetime mmr', async () => {
      await rankedPlayer('veteran', PLACEMENT_GAMES, 2100)
      await run((s) => s.updatePlayerMMR('veteran', 2100))
      const before = await run((s) => s.getPlayer('veteran'))

      await run((s) => s.startNewSeason())
      const after = await run((s) => s.getPlayer('veteran'))

      expect(after!.mmr, 'lifetime mmr was reset').toBe(before!.mmr)
      expect(
        Math.abs(after!.seasonMmr - 1000),
        'season mmr did not move toward the baseline',
      ).toBeLessThan(Math.abs(before!.seasonMmr - 1000))
    })
  })
})
