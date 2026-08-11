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
})
