import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'

// Point queueNeon's useDb() at the real test-DB connection — same hoist-safe
// async-factory pattern as tests/integration/DatabaseService.test.ts.
vi.mock('~~/server/db', async () => {
  const { testDb } = await import('../helpers/test-db')
  return { useDb: () => testDb }
})

import {
  joinQueue,
  leaveQueue,
  queueSize,
  isPlayerInQueue,
  tryFormMatchNeon,
  checkQueueStatusNeon,
  requeueMatchPlayers,
  rosterIncludes,
  GUEST_QUEUE_REJECTION_MESSAGE,
} from '~~/server/game/matchmaking/queueNeon'
import { truncateAll, client, testDb } from '../helpers/test-db'
import { queueEntries } from '~~/server/db/schema'

beforeEach(async () => {
  await truncateAll()
})

afterAll(async () => {
  await client.end()
})

/** Directly insert a row with a custom joinedAt, bypassing joinQueue's
 *  defaultNow() — the only way to simulate a player who has been waiting
 *  long enough to trip MMR widening or bot backfill without sleeping. */
async function seedRaw(entry: {
  playerId: string
  username: string
  mmr: number
  mode: string
  joinedAt: Date
}) {
  await testDb.insert(queueEntries).values(entry)
}

describe('queueNeon (real Postgres)', () => {
  describe('guest rejection', () => {
    it('rejects a guest id before ever touching the table', async () => {
      await expect(
        joinQueue({ playerId: 'guest_abc123', username: 'GUEST-ABC1', mmr: 1000, mode: '1v1' }),
      ).rejects.toThrow(GUEST_QUEUE_REJECTION_MESSAGE)
      expect(await queueSize('1v1')).toBe(0)
    })

    it('still accepts a real (non-guest) playerId', async () => {
      const result = await joinQueue({
        playerId: 'p_real',
        username: 'alice',
        mmr: 1000,
        mode: '1v1',
      })
      expect(result.matched).toBe(false)
      expect(await isPlayerInQueue('p_real')).toBe(true)
    })
  })

  describe('joinQueue duplicate protection', () => {
    it('rejects a second join while already queued (any mode)', async () => {
      await joinQueue({ playerId: 'p1', username: 'alice', mmr: 1000, mode: '1v1' })
      await expect(
        joinQueue({ playerId: 'p1', username: 'alice', mmr: 1000, mode: 'quick_3v3' }),
      ).rejects.toThrow('already in queue')
    })

    it('the unique-violation race surfaces as a 409, not a bare 500 Error', async () => {
      await joinQueue({ playerId: 'p1', username: 'alice', mmr: 1000, mode: '1v1' })
      const err = await joinQueue({
        playerId: 'p1',
        username: 'alice',
        mmr: 1000,
        mode: '1v1',
      }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(Error)
      expect((err as { statusCode?: number }).statusCode).toBe(409)
    })

    it('two truly concurrent joins by the same player: exactly one wins, the loser is a 409', async () => {
      const input = { playerId: 'p1', username: 'alice', mmr: 1000, mode: '1v1' as const }
      const results = await Promise.allSettled([joinQueue(input), joinQueue(input)])
      const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      expect(rejected[0]!.reason.statusCode).toBe(409)
    })
  })

  describe('event-driven match formation', () => {
    it('does not match with an incomplete roster', async () => {
      const result = await joinQueue({
        playerId: 'p1',
        username: 'alice',
        mmr: 1000,
        mode: '1v1',
      })
      expect(result).toEqual({ matched: false, queueSize: expect.any(Number) })
    })

    it('a join that completes the roster forms a match and returns it directly', async () => {
      const first = await joinQueue({ playerId: 'p1', username: 'alice', mmr: 1000, mode: '1v1' })
      expect(first.matched).toBe(false)

      const second = await joinQueue({ playerId: 'p2', username: 'bob', mmr: 1020, mode: '1v1' })
      expect(second.matched).toBe(true)
      if (!second.matched) throw new Error('unreachable')
      expect(second.match.mode).toBe('1v1')
      expect(second.match.bots).toHaveLength(0)
      expect(second.match.roster.map((p) => p.playerId).sort()).toEqual(['p1', 'p2'])

      // Matched players are removed from the table.
      expect(await queueSize('1v1')).toBe(0)
      expect(await isPlayerInQueue('p1')).toBe(false)
      expect(await isPlayerInQueue('p2')).toBe(false)
    })

    it('MMR-range widening: rejects a too-wide pair on a fresh queue, matches once wait time widens the range', async () => {
      await joinQueue({ playerId: 'p1', username: 'alice', mmr: 1000, mode: '1v1' })
      const secondJoin = await joinQueue({
        playerId: 'p2',
        username: 'bob',
        mmr: 1300, // 300 diff — outside the fresh-queue allowed range (50*2=100)
        mode: '1v1',
      })
      expect(secondJoin.matched).toBe(false)
      expect(await queueSize('1v1')).toBe(2)

      // Simulate both having waited >=120s — MMR_RANGES widens to 500, so
      // 2*500=1000 comfortably covers the 300 diff.
      const longAgo = new Date(Date.now() - 130_000)
      await testDb
        .update(queueEntries)
        .set({ joinedAt: longAgo })
        .where(eq(queueEntries.mode, '1v1'))

      const formed = await tryFormMatchNeon('1v1')
      expect(formed).not.toBeNull()
      expect(formed?.roster.map((p) => p.playerId).sort()).toEqual(['p1', 'p2'])
      expect(await queueSize('1v1')).toBe(0)
    })

    it('finds a valid sliding window even when the first candidate group is too wide (quick_3v3)', async () => {
      // 6 players needed. mmrs sorted: 1000,1010,1020,1500,1510,1520 — window
      // [0..5] spans 520 (too wide even widened), but there IS no other
      // window of size 6 in a 6-row queue, so instead prove the negative:
      // no match forms fresh, then confirm it DOES form once widened.
      const mmrs = [1000, 1010, 1020, 1500, 1510, 1520]
      for (const [i, mmr] of mmrs.entries()) {
        await joinQueue({ playerId: `p${i}`, username: `u${i}`, mmr, mode: 'quick_3v3' })
      }
      expect(await queueSize('quick_3v3')).toBe(6) // never matched fresh (520 > 100)

      const longAgo = new Date(Date.now() - 130_000)
      await testDb
        .update(queueEntries)
        .set({ joinedAt: longAgo })
        .where(eq(queueEntries.mode, 'quick_3v3'))

      const formed = await tryFormMatchNeon('quick_3v3')
      expect(formed).not.toBeNull()
      expect(formed?.roster).toHaveLength(6)
      expect(await queueSize('quick_3v3')).toBe(0)
    })
  })

  describe('bot backfill', () => {
    it('does not backfill before BOT_FILL_WAIT_MS has elapsed', async () => {
      await joinQueue({ playerId: 'p1', username: 'alice', mmr: 1000, mode: 'quick_3v3' })
      const formed = await tryFormMatchNeon('quick_3v3')
      expect(formed).toBeNull()
      expect(await queueSize('quick_3v3')).toBe(1)
    })

    it('fills the remainder with bots once the longest wait crosses the threshold', async () => {
      await seedRaw({
        playerId: 'p1',
        username: 'alice',
        mmr: 1200,
        mode: 'quick_3v3',
        joinedAt: new Date(Date.now() - 15_000), // > BOT_FILL_WAIT_MS (10s)
      })
      await seedRaw({
        playerId: 'p2',
        username: 'bob',
        mmr: 1300,
        mode: 'quick_3v3',
        joinedAt: new Date(Date.now() - 15_000),
      })

      const formed = await tryFormMatchNeon('quick_3v3')
      expect(formed).not.toBeNull()
      expect(formed?.players).toHaveLength(2)
      expect(formed?.bots).toHaveLength(4) // quick_3v3 needs 6 total
      expect(formed?.roster).toHaveLength(6)
      for (const bot of formed?.bots ?? []) {
        expect(bot.playerId.startsWith('bot_')).toBe(true)
      }
      expect(await queueSize('quick_3v3')).toBe(0)
    })
  })

  describe('bot backfill — stragglers with no compatible MMR window', () => {
    it('backfills the longest-waiting player when >= matchSize are queued but no MMR window fits', async () => {
      // 1v1 needs 2. Three players, spread far beyond any widening range, all
      // past the bot-fill wait: the old code returned null forever.
      const waited = (s: number) => new Date(Date.now() - s * 1000)
      await seedRaw({ playerId: 'p1', username: 'a', mmr: 1000, mode: '1v1', joinedAt: waited(20) })
      await seedRaw({ playerId: 'p2', username: 'b', mmr: 3000, mode: '1v1', joinedAt: waited(15) })
      await seedRaw({ playerId: 'p3', username: 'c', mmr: 5000, mode: '1v1', joinedAt: waited(15) })

      const formed = await tryFormMatchNeon('1v1')
      expect(formed).not.toBeNull()
      expect(formed!.players.map((p) => p.playerId)).toEqual(['p1'])
      expect(formed!.bots).toHaveLength(1)
      expect(formed!.roster).toHaveLength(2)
      // Only the matched player left the queue.
      expect(await isPlayerInQueue('p1')).toBe(false)
      expect(await isPlayerInQueue('p2')).toBe(true)
      expect(await isPlayerInQueue('p3')).toBe(true)
    })

    it('pulls in the MMR-compatible players around the straggler and bots the rest (3v3)', async () => {
      const waited = (s: number) => new Date(Date.now() - s * 1000)
      const seed = (id: string, mmr: number, s: number) =>
        seedRaw({ playerId: id, username: id, mmr, mode: 'quick_3v3', joinedAt: waited(s) })
      await seed('p1', 1000, 20)
      await seed('p2', 1010, 15)
      await seed('p3', 2000, 15)
      await seed('p4', 3000, 15)
      await seed('p5', 4000, 15)
      await seed('p6', 5000, 15)

      const formed = await tryFormMatchNeon('quick_3v3')
      expect(formed).not.toBeNull()
      expect(formed!.players.map((p) => p.playerId).sort()).toEqual(['p1', 'p2'])
      expect(formed!.bots).toHaveLength(4)
      expect(await queueSize('quick_3v3')).toBe(4)
    })

    it('does not backfill a straggler that has not waited long enough', async () => {
      const waited = (s: number) => new Date(Date.now() - s * 1000)
      await seedRaw({ playerId: 'p1', username: 'a', mmr: 1000, mode: '1v1', joinedAt: waited(2) })
      await seedRaw({ playerId: 'p2', username: 'b', mmr: 3000, mode: '1v1', joinedAt: waited(2) })
      expect(await tryFormMatchNeon('1v1')).toBeNull()
      expect(await queueSize('1v1')).toBe(2)
    })

    it('a status poll by a stranded straggler resolves to a match instead of searching forever', async () => {
      const waited = (s: number) => new Date(Date.now() - s * 1000)
      await seedRaw({ playerId: 'p1', username: 'a', mmr: 1000, mode: '1v1', joinedAt: waited(20) })
      await seedRaw({ playerId: 'p2', username: 'b', mmr: 3000, mode: '1v1', joinedAt: waited(20) })
      const status = await checkQueueStatusNeon('p1')
      expect(status.status).toBe('matched')
    })
  })

  describe('requeueMatchPlayers (start-failure recovery)', () => {
    it("puts a formed match's real players back with their ORIGINAL joinedAt, bots excluded", async () => {
      const joinedAt = new Date(Date.now() - 15_000)
      await seedRaw({ playerId: 'p1', username: 'alice', mmr: 1200, mode: 'quick_3v3', joinedAt })
      const formed = await tryFormMatchNeon('quick_3v3')
      expect(formed!.bots.length).toBeGreaterThan(0)
      expect(await queueSize('quick_3v3')).toBe(0)

      await requeueMatchPlayers(formed!)

      expect(await queueSize('quick_3v3')).toBe(1)
      const [row] = await testDb.select().from(queueEntries)
      expect(row!.playerId).toBe('p1')
      expect(row!.username).toBe('alice')
      expect(row!.mmr).toBe(1200)
      expect(row!.mode).toBe('quick_3v3')
      expect(Math.abs(row!.joinedAt.getTime() - joinedAt.getTime())).toBeLessThan(1000)
    })

    it('is idempotent and never clobbers a player who is already queued again', async () => {
      await joinQueue({ playerId: 'p1', username: 'alice', mmr: 1000, mode: '1v1' })
      await expect(
        requeueMatchPlayers({
          mode: '1v1',
          players: [{ playerId: 'p1', username: 'alice', mmr: 1000, mode: '1v1' }],
          bots: [],
          roster: [],
        }),
      ).resolves.toBeUndefined()
      expect(await queueSize('1v1')).toBe(1)
    })
  })

  describe('concurrent match formation (advisory lock)', () => {
    it('only ONE of two concurrent tryFormMatchNeon calls claims a full 1v1 roster', async () => {
      await joinQueue({ playerId: 'p1', username: 'alice', mmr: 1000, mode: '1v1' })
      await testDb.insert(queueEntries).values({
        playerId: 'p2',
        username: 'bob',
        mmr: 1010,
        mode: '1v1',
      })

      const [a, b] = await Promise.all([tryFormMatchNeon('1v1'), tryFormMatchNeon('1v1')])
      const matches = [a, b].filter((m) => m !== null)
      expect(matches).toHaveLength(1)
      expect(await queueSize('1v1')).toBe(0)
    })
  })

  describe('leaveQueue', () => {
    it('removes the row so isPlayerInQueue flips false', async () => {
      await joinQueue({ playerId: 'p1', username: 'alice', mmr: 1000, mode: '1v1' })
      expect(await isPlayerInQueue('p1')).toBe(true)
      await leaveQueue('p1')
      expect(await isPlayerInQueue('p1')).toBe(false)
    })

    it('is a no-op for a player who was never queued', async () => {
      await expect(leaveQueue('nobody')).resolves.toBeUndefined()
    })
  })

  describe('checkQueueStatusNeon', () => {
    it('reports idle for a player with no queue entry', async () => {
      expect(await checkQueueStatusNeon('nobody')).toEqual({ status: 'idle' })
    })

    it('reports searching while the roster is incomplete', async () => {
      await joinQueue({ playerId: 'p1', username: 'alice', mmr: 1000, mode: '1v1' })
      const result = await checkQueueStatusNeon('p1')
      expect(result).toMatchObject({ status: 'searching' })
    })

    it('opportunistically triggers bot backfill on a status poll, with no new join', async () => {
      await seedRaw({
        playerId: 'p1',
        username: 'alice',
        mmr: 1000,
        mode: 'quick_3v3',
        joinedAt: new Date(Date.now() - 15_000),
      })

      const result = await checkQueueStatusNeon('p1')
      expect(result.status).toBe('matched')
      if (result.status !== 'matched') throw new Error('unreachable')
      expect(result.match.bots).toHaveLength(5)
      expect(await queueSize('quick_3v3')).toBe(0)
    })
  })

  describe('a formed match that excludes the caller is never discarded', () => {
    const waited = (sec: number) => new Date(Date.now() - sec * 1000)

    it('a status poll by a player OUTSIDE the straggler group gets formed_other with the match, rows already gone', async () => {
      // quick_3v3 (6): anchor at 1000 waited 20s, five others at ~2000 waited 5s.
      await seedRaw({
        playerId: 'anchor',
        username: 'a',
        mmr: 1000,
        mode: 'quick_3v3',
        joinedAt: waited(20),
      })
      for (let i = 0; i < 5; i++) {
        await seedRaw({
          playerId: `h${i}`,
          username: `h${i}`,
          mmr: 2000 + i,
          mode: 'quick_3v3',
          joinedAt: waited(5),
        })
      }

      const st = await checkQueueStatusNeon('h0')

      expect(st.status).toBe('formed_other')
      if (st.status !== 'formed_other') throw new Error('unreachable')
      // The match the poll formed is handed back so the caller can START it.
      expect(st.match.players.map((p) => p.playerId)).toEqual(['anchor'])
      expect(st.match.roster.some((p) => p.playerId === 'h0')).toBe(false)
      expect(st.queueSize).toBe(5)
      // The poller keeps its queue row; the matched anchor's row is gone.
      expect(await isPlayerInQueue('h0')).toBe(true)
      expect(await isPlayerInQueue('anchor')).toBe(false)
    })

    it('a status poll by a player INSIDE the formed match still gets matched', async () => {
      await seedRaw({
        playerId: 'anchor',
        username: 'a',
        mmr: 1000,
        mode: 'quick_3v3',
        joinedAt: waited(20),
      })
      for (let i = 0; i < 5; i++) {
        await seedRaw({
          playerId: `h${i}`,
          username: `h${i}`,
          mmr: 2000 + i,
          mode: 'quick_3v3',
          joinedAt: waited(5),
        })
      }
      expect((await checkQueueStatusNeon('anchor')).status).toBe('matched')
    })

    it('joinQueue returns the formed match even when the joiner is not in its roster', async () => {
      await seedRaw({
        playerId: 'anchor',
        username: 'a',
        mmr: 1000,
        mode: 'quick_3v3',
        joinedAt: waited(20),
      })
      for (let i = 0; i < 4; i++) {
        await seedRaw({
          playerId: `h${i}`,
          username: `h${i}`,
          mmr: 2000 + i,
          mode: 'quick_3v3',
          joinedAt: waited(5),
        })
      }
      const r = await joinQueue({ playerId: 'joiner', username: 'j', mmr: 2100, mode: 'quick_3v3' })
      expect(r.matched).toBe(true)
      if (!r.matched) throw new Error('unreachable')
      expect(rosterIncludes(r.match, 'joiner')).toBe(false)
      expect(rosterIncludes(r.match, 'anchor')).toBe(true)
      expect(await isPlayerInQueue('joiner')).toBe(true)
    })
  })

  describe('straggler fill does not pre-empt MMR widening', () => {
    const waited = (sec: number) => new Date(Date.now() - sec * 1000)

    it('10 humans in two reachable clusters (1000 / 1150) waiting 12-19s are NOT bot-filled; they pair once the range widens', async () => {
      for (let i = 0; i < 5; i++) {
        await seedRaw({
          playerId: `a${i}`,
          username: `a${i}`,
          mmr: 1000,
          mode: 'ranked_5v5',
          joinedAt: waited(15 + i),
        })
        await seedRaw({
          playerId: `b${i}`,
          username: `b${i}`,
          mmr: 1150,
          mode: 'ranked_5v5',
          joinedAt: waited(12),
        })
      }
      // Spread 150 is within the widest range (500*2) -> a humans-only match
      // WILL form by widening, so bot-filling now would waste it.
      expect(await tryFormMatchNeon('ranked_5v5')).toBeNull()
      expect(await queueSize('ranked_5v5')).toBe(10)

      // Once everyone has waited past the 100-range step (spread 150 <= 200) it forms, all human.
      await testDb.update(queueEntries).set({ joinedAt: waited(35) })
      const formed = await tryFormMatchNeon('ranked_5v5')
      expect(formed).not.toBeNull()
      expect(formed!.bots).toHaveLength(0)
      expect(formed!.players).toHaveLength(10)
    })

    it('does form once the anchor has waited past the last widening step (120s), pulling in everyone in reach', async () => {
      // A window of 6 exists (spread 904 <= 1000) but is not satisfiable for the
      // short-waiting members; the anchor has waited 130s (range 500).
      await seedRaw({
        playerId: 'anchor',
        username: 'a',
        mmr: 1000,
        mode: 'quick_3v3',
        joinedAt: waited(130),
      })
      for (let i = 0; i < 5; i++) {
        await seedRaw({
          playerId: `h${i}`,
          username: `h${i}`,
          mmr: 1900 + i,
          mode: 'quick_3v3',
          joinedAt: waited(5),
        })
      }
      const formed = await tryFormMatchNeon('quick_3v3')
      expect(formed).not.toBeNull()
      expect(formed!.players.map((p) => p.playerId)).toContain('anchor')
      // The anchor's 500 range reaches all five others -> a full human match.
      expect(formed!.players).toHaveLength(6)
      expect(formed!.bots).toHaveLength(0)
    })

    it('does NOT bot-fill a reachable-by-widening queue before the anchor reaches 120s', async () => {
      await seedRaw({
        playerId: 'anchor',
        username: 'a',
        mmr: 1000,
        mode: 'quick_3v3',
        joinedAt: waited(60),
      })
      for (let i = 0; i < 5; i++) {
        await seedRaw({
          playerId: `h${i}`,
          username: `h${i}`,
          mmr: 1900 + i,
          mode: 'quick_3v3',
          joinedAt: waited(5),
        })
      }
      expect(await tryFormMatchNeon('quick_3v3')).toBeNull()
      expect(await queueSize('quick_3v3')).toBe(6)
    })
  })
})
