import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { Effect } from 'effect'

// Point the service's useDb() at the real test-DB connection. Async factory so
// it's hoist-safe (the import resolves at factory-call time, not hoist time).
vi.mock('~~/server/db', async () => {
  const { testDb } = await import('../helpers/test-db')
  return { useDb: () => testDb }
})

import {
  DatabaseService,
  DatabaseServiceLive,
  type DatabaseServiceApi,
} from '~~/server/services/DatabaseService'
import { truncateAll, client, testDb } from '../helpers/test-db'
import { playerProviders, players } from '~~/server/db/schema'
import { eq } from 'drizzle-orm'
import { PLACEMENT_GAMES } from '~~/shared/constants/ranks'

// Run one DatabaseService method against the real test DB.
function run<A>(f: (svc: DatabaseServiceApi) => Effect.Effect<A>): Promise<A> {
  return Effect.runPromise(
    Effect.flatMap(DatabaseService, f).pipe(Effect.provide(DatabaseServiceLive)),
  )
}

function seedPlayer(over: Record<string, unknown> = {}) {
  return run((svc) => svc.createPlayer({ id: 'p1', username: 'u1', mmr: 1000, ...over } as never))
}

beforeEach(async () => {
  await truncateAll()
})

afterAll(async () => {
  await client.end()
})

describe('DatabaseService (real Postgres)', () => {
  describe('getPlayer', () => {
    it('returns the player by id', async () => {
      await seedPlayer()
      const p = await run((s) => s.getPlayer('p1'))
      expect(p?.id).toBe('p1')
      expect(p?.username).toBe('u1')
    })
    it('returns null for a non-existent player', async () => {
      expect(await run((s) => s.getPlayer('nope'))).toBeNull()
    })
  })

  describe('getPlayerByProvider', () => {
    it('finds a player by provider + providerId', async () => {
      await seedPlayer({ provider: 'github', providerId: 'gh_1' })
      const p = await run((s) => s.getPlayerByProvider('github', 'gh_1'))
      expect(p?.id).toBe('p1')
    })
    it('uses playerProviders and backfills legacy provider rows', async () => {
      await seedPlayer({ provider: 'github', providerId: 'gh_legacy' })
      const p = await run((s) => s.getPlayerByProvider('github', 'gh_legacy'))
      expect(p?.id).toBe('p1')

      const [linked] = await testDb.select().from(playerProviders)
      expect(linked).toMatchObject({ playerId: 'p1', provider: 'github', providerId: 'gh_legacy' })
    })
    it('finds a normalized provider row even when legacy columns are empty', async () => {
      await seedPlayer()
      await run((s) => s.linkProvider('p1', 'github', 'gh_normalized', 'ghuser', null))
      const p = await run((s) => s.getPlayerByProvider('github', 'gh_normalized'))
      expect(p?.id).toBe('p1')
    })
    it('returns null when no provider match', async () => {
      await seedPlayer({ provider: 'github', providerId: 'gh_1' })
      expect(await run((s) => s.getPlayerByProvider('discord', 'gh_1'))).toBeNull()
    })
  })

  describe('createPlayer', () => {
    it('creates and returns the player with its id', async () => {
      const created = await run((s) => s.createPlayer({ id: 'pX', username: 'x' } as never))
      expect(created.id).toBe('pX')
      expect(created.mmr).toBe(1000) // default
      expect(await run((s) => s.getPlayer('pX'))).not.toBeNull()
    })
  })

  describe('updatePlayerMMR', () => {
    it('updates the MMR', async () => {
      await seedPlayer({ mmr: 1000 })
      await run((s) => s.updatePlayerMMR('p1', 1234))
      expect((await run((s) => s.getPlayer('p1')))?.mmr).toBe(1234)
    })
  })

  describe('recordMatch + getMatch + getMatchHistory', () => {
    async function seedMatch(matchId = 'm1') {
      await seedPlayer()
      return run((s) =>
        s.recordMatch({ id: matchId, mode: 'ranked_5v5' } as never, [
          { matchId, playerId: 'p1', team: 'chaff', heroId: 'echo' } as never,
        ]),
      )
    }

    it('records a match (+ players) and reports persistence success', async () => {
      const persisted = await seedMatch('m1')
      expect(persisted).toBe('inserted')
    })
    it('returns an idempotent result when the same match is recorded twice', async () => {
      await seedMatch('m1')
      const retried = await run((s) =>
        s.recordMatch(
          { id: 'm1', mode: 'ranked_5v5' } as never,
          [{ matchId: 'm1', playerId: 'p1', team: 'chaff', heroId: 'echo' }] as never,
        ),
      )
      expect(retried).toBe('already_exists')
      expect(await run((s) => s.getMatchHistory('p1'))).toHaveLength(1)
    })
    it('getMatch returns the match with its players; null when missing', async () => {
      await seedMatch('m1')
      const m = await run((s) => s.getMatch('m1'))
      expect(m?.id).toBe('m1')
      expect(m?.players).toHaveLength(1)
      expect(m?.players[0]?.player.id).toBe('p1')
      expect(await run((s) => s.getMatch('absent'))).toBeNull()
    })
    it('getMatch never leaks credentials (no email / passwordHash on player)', async () => {
      await seedMatch('m1')
      const m = await run((s) => s.getMatch('m1'))
      const player = m?.players[0]?.player as Record<string, unknown>
      expect(player).toBeDefined()
      expect(player).not.toHaveProperty('email')
      expect(player).not.toHaveProperty('passwordHash')
      expect(player).not.toHaveProperty('providerId')
      // public fields still present
      expect(player.username).toBeDefined()
    })
    it('getMatchHistory returns the player matches, respects limit, empty for none', async () => {
      await seedPlayer()
      for (const id of ['m1', 'm2', 'm3']) {
        await run((s) =>
          s.recordMatch({ id, mode: 'ranked_5v5' } as never, [
            { matchId: id, playerId: 'p1', team: 'chaff', heroId: 'echo' } as never,
          ]),
        )
      }
      const hist = await run((s) => s.getMatchHistory('p1'))
      expect(hist).toHaveLength(3)
      // each entry carries the queried player's team (for Victory/Defeat display)
      expect(hist[0]!.team).toBe('chaff')
      expect(hist[0]!.playerStats).toMatchObject({
        kills: 0,
        finalScrip: 0,
        netWorth: 0,
        lastHits: 0,
        burns: 0,
      })
      expect(await run((s) => s.getMatchHistory('p1', 2))).toHaveLength(2)
      expect(await run((s) => s.getMatchHistory('ghost'))).toHaveLength(0)
    })
    it('round-trips BOTH faction values (R1-06: no row may be stuck on the old ids)', async () => {
      await seedPlayer()
      for (const [id, team, winner] of [
        ['m-chaff', 'chaff', 'chaff'],
        ['m-audit', 'audit', 'audit'],
      ] as const) {
        await run((s) =>
          s.recordMatch({ id, mode: 'ranked_5v5', winner } as never, [
            { matchId: id, playerId: 'p1', team, heroId: 'echo' } as never,
          ]),
        )
      }
      const hist = await run((s) => s.getMatchHistory('p1'))
      expect(hist.map((h) => h.team).sort()).toEqual(['audit', 'chaff'])
      expect(hist.map((h) => h.winner).sort()).toEqual(['audit', 'chaff'])
    })
  })

  describe('saveMatchReplay + getMatchReplay', () => {
    const artifact = {
      matchId: 'replay-1',
      rulesetVersion: 1,
      rngSeed: 424242,
      meta: { players: [{ playerId: 'p1', team: 'chaff', heroId: 'echo', mmr: 1000 }] },
      actions: [{ cycle: 1, playerId: 'p1', command: { type: 'move', zone: 'coldstore' } }],
      finalState: { cycle: 42, winner: 'chaff' },
      finalSummaryHash: 'abc123',
    }

    it('archives and reads back the full reproduction triple', async () => {
      await seedPlayer()
      await run((s) =>
        s.recordMatch({ id: 'replay-1', mode: 'ranked_5v5' } as never, [
          { matchId: 'replay-1', playerId: 'p1', team: 'chaff', heroId: 'echo' } as never,
        ]),
      )
      expect(await run((s) => s.saveMatchReplay(artifact as never))).toBe(true)

      const read = await run((s) => s.getMatchReplay('replay-1'))
      expect(read).not.toBeNull()
      expect(read!.rngSeed).toBe(424242)
      expect(read!.rulesetVersion).toBe(1)
      expect(read!.finalSummaryHash).toBe('abc123')
      expect(read!.actions).toEqual(artifact.actions)
      expect((read!.finalState as { cycle: number }).cycle).toBe(42)
    })

    it('is idempotent — the finalization retry path must not error or churn', async () => {
      await seedPlayer()
      await run((s) =>
        s.recordMatch({ id: 'replay-1', mode: 'ranked_5v5' } as never, [
          { matchId: 'replay-1', playerId: 'p1', team: 'chaff', heroId: 'echo' } as never,
        ]),
      )
      expect(await run((s) => s.saveMatchReplay(artifact as never))).toBe(true)
      // Second write with DIFFERENT content: first write wins, no error.
      expect(
        await run((s) => s.saveMatchReplay({ ...artifact, finalSummaryHash: 'zzz' } as never)),
      ).toBe(true)
      const read = await run((s) => s.getMatchReplay('replay-1'))
      expect(read!.finalSummaryHash).toBe('abc123')
    })

    it('reports false (retry-worthy) instead of throwing when the write cannot land', async () => {
      // No matches row → the FK rejects the insert; the service must fold that
      // into `false` so the finalization intent stays pending and retries.
      expect(await run((s) => s.saveMatchReplay(artifact as never))).toBe(false)
    })

    it('returns null for a match with no archived replay', async () => {
      expect(await run((s) => s.getMatchReplay('never-existed'))).toBeNull()
    })
  })

  describe('applyMatchDerivedStats', () => {
    it('applies ladder/profile stats once inside the match claim', async () => {
      await seedPlayer()
      await run((s) =>
        s.recordMatch({ id: 'derived-1', mode: 'ranked_5v5' } as never, [
          { matchId: 'derived-1', playerId: 'p1', team: 'chaff', heroId: 'echo' } as never,
        ]),
      )

      const stats = {
        playerId: 'p1',
        heroId: 'echo',
        won: true,
        ranked: true,
        mmrChange: 25,
        kills: 3,
        deaths: 1,
        assists: 5,
      }
      expect(await run((s) => s.applyMatchDerivedStats('derived-1', [stats]))).toBe(true)
      expect(await run((s) => s.applyMatchDerivedStats('derived-1', [stats]))).toBe(false)

      const player = await run((s) => s.getPlayer('p1'))
      expect(player).toMatchObject({
        mmr: 1025,
        seasonMmr: 1025,
        gamesPlayed: 1,
        wins: 1,
        seasonGamesPlayed: 1,
        seasonWins: 1,
      })
      expect(await run((s) => s.getHeroStats('p1'))).toMatchObject([
        expect.objectContaining({
          heroId: 'echo',
          gamesPlayed: 1,
          wins: 1,
          totalKills: 3,
          totalDeaths: 1,
          totalAssists: 5,
        }),
      ])
      expect((await run((s) => s.getMatch('derived-1')))?.derivedStatsApplied).toBe(true)
    })

    it('keeps casual games out of both MMR ladders while recording W-L', async () => {
      await seedPlayer()
      await run((s) =>
        s.recordMatch({ id: 'derived-casual', mode: 'casual_5v5' } as never, [
          { matchId: 'derived-casual', playerId: 'p1', team: 'chaff', heroId: 'echo' } as never,
        ]),
      )

      expect(
        await run((s) =>
          s.applyMatchDerivedStats('derived-casual', [
            {
              playerId: 'p1',
              heroId: 'echo',
              won: false,
              ranked: false,
              mmrChange: -25,
              kills: 0,
              deaths: 2,
              assists: 1,
            },
          ]),
        ),
      ).toBe(true)

      expect(await run((s) => s.getPlayer('p1'))).toMatchObject({
        mmr: 1000,
        seasonMmr: 1000,
        gamesPlayed: 1,
        wins: 0,
        seasonGamesPlayed: 0,
        seasonWins: 0,
      })
    })
  })

  describe('getLeaderboard', () => {
    it('returns players ordered by MMR desc and respects the limit', async () => {
      await run((s) => s.createPlayer({ id: 'a', username: 'a', mmr: 1500 } as never))
      await run((s) => s.createPlayer({ id: 'b', username: 'b', mmr: 2000 } as never))
      await run((s) => s.createPlayer({ id: 'c', username: 'c', mmr: 900 } as never))
      const top = await run((s) => s.getLeaderboard())
      expect(top.map((p) => p.id)).toEqual(['b', 'a', 'c'])
      expect(await run((s) => s.getLeaderboard(2))).toHaveLength(2)
    })
  })

  describe('getSeasonLeaderboard', () => {
    // The ladder used to select every row, so it listed everyone who had ever
    // registered — all at the 1000 baseline with 0-0 — and an account that had
    // never played outranked a real player who had lost a match.
    it('lists only players past the placement requirement, by season MMR', async () => {
      await run((s) => s.createPlayer({ id: 'ranked_hi', username: 'hi', mmr: 1000 } as never))
      await run((s) => s.createPlayer({ id: 'ranked_lo', username: 'lo', mmr: 1000 } as never))
      await run((s) => s.createPlayer({ id: 'fresh', username: 'fresh', mmr: 1000 } as never))
      await testDb
        .update(players)
        .set({ seasonMmr: 1400, seasonGamesPlayed: PLACEMENT_GAMES })
        .where(eq(players.id, 'ranked_hi'))
      await testDb
        .update(players)
        .set({ seasonMmr: 900, seasonGamesPlayed: PLACEMENT_GAMES + 5 })
        .where(eq(players.id, 'ranked_lo'))
      // One short of qualifying — the boundary that decides the whole feature.
      await testDb
        .update(players)
        .set({ seasonMmr: 3000, seasonGamesPlayed: PLACEMENT_GAMES - 1 })
        .where(eq(players.id, 'fresh'))

      const board = await run((s) => s.getSeasonLeaderboard())
      expect(board.map((p) => p.id)).toEqual(['ranked_hi', 'ranked_lo'])
    })
  })

  describe('updateHeroStats (upsert — the games_played path)', () => {
    it('creates a new hero_stats row', async () => {
      await seedPlayer()
      await run((s) =>
        s.updateHeroStats('p1', 'echo', { won: true, kills: 3, deaths: 1, assists: 5 }),
      )
      const stats = await run((s) => s.getHeroStats('p1'))
      expect(stats).toHaveLength(1)
      expect(stats[0]).toMatchObject({ heroId: 'echo', gamesPlayed: 1, wins: 1, totalKills: 3 })
    })
    it('increments games/wins/kills on the existing row (no duplicate)', async () => {
      await seedPlayer()
      await run((s) =>
        s.updateHeroStats('p1', 'echo', { won: true, kills: 3, deaths: 1, assists: 5 }),
      )
      await run((s) =>
        s.updateHeroStats('p1', 'echo', { won: false, kills: 2, deaths: 4, assists: 1 }),
      )
      const stats = await run((s) => s.getHeroStats('p1'))
      expect(stats).toHaveLength(1) // upsert, not a second row
      expect(stats[0]).toMatchObject({
        gamesPlayed: 2,
        wins: 1, // only the first was a win
        totalKills: 5,
        totalDeaths: 5,
        totalAssists: 6,
      })
    })
  })

  describe('getHeroStats', () => {
    it('returns an empty array for a player with no stats', async () => {
      await seedPlayer()
      expect(await run((s) => s.getHeroStats('p1'))).toHaveLength(0)
    })
  })

  describe('incrementGamesPlayed / incrementWins', () => {
    it('increments games_played by one', async () => {
      await seedPlayer({ gamesPlayed: 0 })
      await run((s) => s.incrementGamesPlayed('p1'))
      await run((s) => s.incrementGamesPlayed('p1'))
      expect((await run((s) => s.getPlayer('p1')))?.gamesPlayed).toBe(2)
    })
    it('increments wins by one', async () => {
      await seedPlayer({ wins: 0 })
      await run((s) => s.incrementWins('p1'))
      expect((await run((s) => s.getPlayer('p1')))?.wins).toBe(1)
    })
  })

  describe('getPlayerByUsername', () => {
    it('finds by username; null when absent', async () => {
      await seedPlayer({ username: 'abdul' })
      expect((await run((s) => s.getPlayerByUsername('abdul')))?.id).toBe('p1')
      expect(await run((s) => s.getPlayerByUsername('nobody'))).toBeNull()
    })
  })

  describe('createLocalPlayer', () => {
    it('creates a local_-prefixed player with the password hash + local provider', async () => {
      const p = await run((s) => s.createLocalPlayer('newuser', 'hashed_pw'))
      expect(p.id).toMatch(/^local_/)
      expect(p.username).toBe('newuser')
      expect(p.passwordHash).toBe('hashed_pw')
      expect(p.provider).toBe('local')
      expect(p.providerId).toBe(p.id)
    })
  })

  describe('providers: link / unlink / get', () => {
    it('links a provider and returns the row', async () => {
      await seedPlayer()
      const row = await run((s) =>
        s.linkProvider('p1', 'github', 'gh_99', 'ghuser', 'http://a/v.png'),
      )
      expect(row).toMatchObject({ playerId: 'p1', provider: 'github', providerId: 'gh_99' })
    })
    it('getPlayerProviders returns all of a player’s providers', async () => {
      await seedPlayer()
      await run((s) => s.linkProvider('p1', 'github', 'gh_1', null, null))
      await run((s) => s.linkProvider('p1', 'discord', 'dc_1', null, null))
      const provs = await run((s) => s.getPlayerProviders('p1'))
      expect(provs.map((p) => p.provider).sort()).toEqual(['discord', 'github'])
    })
    it('unlinkProvider removes only that provider', async () => {
      await seedPlayer()
      await run((s) => s.linkProvider('p1', 'github', 'gh_1', null, null))
      await run((s) => s.linkProvider('p1', 'discord', 'dc_1', null, null))
      await run((s) => s.unlinkProvider('p1', 'github'))
      const provs = await run((s) => s.getPlayerProviders('p1'))
      expect(provs.map((p) => p.provider)).toEqual(['discord'])
    })
    it('clears matching legacy provider columns so OAuth cannot relink it', async () => {
      await seedPlayer({ provider: 'github', providerId: 'gh_legacy' })
      await run((s) => s.linkProvider('p1', 'github', 'gh_legacy', null, null))
      await run((s) => s.unlinkProvider('p1', 'github'))

      const player = await run((s) => s.getPlayer('p1'))
      expect(player?.provider).toBeNull()
      expect(player?.providerId).toBeNull()
      expect(await run((s) => s.getPlayerByProvider('github', 'gh_legacy'))).toBeNull()
    })
  })

  describe('updatePlayerAvatar / Username / Password', () => {
    it('updates the selected avatar', async () => {
      await seedPlayer()
      await run((s) => s.updatePlayerAvatar('p1', 'echo'))
      expect((await run((s) => s.getPlayer('p1')))?.selectedAvatar).toBe('echo')
    })
    it('updates the username', async () => {
      await seedPlayer()
      await run((s) => s.updatePlayerUsername('p1', 'renamed'))
      expect((await run((s) => s.getPlayer('p1')))?.username).toBe('renamed')
    })
    it('updates the password hash', async () => {
      await seedPlayer()
      await run((s) => s.updatePlayerPassword('p1', 'new_hash'))
      const [row] = await testDb.select().from(players)
      expect(row?.passwordHash).toBe('new_hash')
    })
  })

  describe('setPlayerEmail', () => {
    /**
     * The settings page told a player with no address "Without one, you can't
     * recover a forgotten password" and offered no way to add one — informed and
     * stuck, which is the same failure as a rejection with no reason.
     */
    it('sets an address on an account that had none', async () => {
      await seedPlayer()
      expect((await run((s) => s.getPlayer('p1')))?.email).toBeNull()
      await run((s) => s.setPlayerEmail('p1', 'ops@terminamoba.com'))
      expect((await run((s) => s.getPlayer('p1')))?.email).toBe('ops@terminamoba.com')
    })

    it('clears the verified stamp when the address changes', async () => {
      await seedPlayer()
      await run((s) => s.setPlayerEmail('p1', 'first@example.com'))
      await run((s) => s.setEmailVerified('p1'))
      expect((await run((s) => s.getPlayer('p1')))?.emailVerifiedAt).not.toBeNull()

      // Carrying the ✓ across would mean a password reset could be sent to an
      // address nobody has proved they own.
      await run((s) => s.setPlayerEmail('p1', 'second@example.com'))
      const after = await run((s) => s.getPlayer('p1'))
      expect(after?.email).toBe('second@example.com')
      expect(after?.emailVerifiedAt).toBeNull()
    })

    it('getPlayerByEmail finds the owner, so one address cannot span two accounts', async () => {
      await seedPlayer()
      await run((s) => s.createPlayer({ id: 'p2', username: 'u2', mmr: 1000 } as never))
      await run((s) => s.setPlayerEmail('p1', 'shared@example.com'))

      expect((await run((s) => s.getPlayerByEmail('shared@example.com')))?.id).toBe('p1')
      expect(await run((s) => s.getPlayerByEmail('nobody@example.com'))).toBeNull()
    })
  })
})
