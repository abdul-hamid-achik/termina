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
import { players } from '~~/server/db/schema'

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
          { matchId, playerId: 'p1', team: 'radiant', heroId: 'echo' } as never,
        ]),
      )
    }

    it('records a match (+ players) and returns the match id', async () => {
      const id = await seedMatch('m1')
      expect(id).toBe('m1')
    })
    it('getMatch returns the match with its players; null when missing', async () => {
      await seedMatch('m1')
      const m = await run((s) => s.getMatch('m1'))
      expect(m?.id).toBe('m1')
      expect(m?.players).toHaveLength(1)
      expect(m?.players[0]?.player.id).toBe('p1')
      expect(await run((s) => s.getMatch('absent'))).toBeNull()
    })
    it('getMatchHistory returns the player matches, respects limit, empty for none', async () => {
      await seedPlayer()
      for (const id of ['m1', 'm2', 'm3']) {
        await run((s) =>
          s.recordMatch({ id, mode: 'ranked_5v5' } as never, [
            { matchId: id, playerId: 'p1', team: 'radiant', heroId: 'echo' } as never,
          ]),
        )
      }
      const hist = await run((s) => s.getMatchHistory('p1'))
      expect(hist).toHaveLength(3)
      // each entry carries the queried player's team (for Victory/Defeat display)
      expect(hist[0]!.team).toBe('radiant')
      expect(await run((s) => s.getMatchHistory('p1', 2))).toHaveLength(2)
      expect(await run((s) => s.getMatchHistory('ghost'))).toHaveLength(0)
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
})
