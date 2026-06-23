import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { Effect } from 'effect'
import {
  RedisService,
  makeRedisServiceLive,
  type RedisServiceApi,
} from '../../server/services/RedisService'
import { joinQueue, leaveQueue, type QueueEntry } from '../../server/game/matchmaking/queue'

/**
 * Real-Redis verification of the mode-agnostic queue dedup sentinel — the unit
 * tests mock redis.eval, so only a live Redis proves the Lua actually rejects a
 * second join and that leaving releases the guard. Uses the test Redis (db1).
 */
const REDIS_URL = process.env.NUXT_REDIS_URL ?? 'redis://localhost:6380/1'
const layer = makeRedisServiceLive(REDIS_URL)
const run = <A>(f: (r: RedisServiceApi) => Effect.Effect<A>): Promise<A> =>
  Effect.runPromise(Effect.flatMap(RedisService, f).pipe(Effect.provide(layer)))

const PID = 'itest_dedup_player'
const entry = (mode: QueueEntry['mode']): QueueEntry => ({
  playerId: PID,
  username: 'dedup_user',
  mmr: 1000,
  joinedAt: 1,
  mode,
})

async function cleanup() {
  await run((r) => leaveQueue(r, PID, 'ranked_5v5'))
  await run((r) => leaveQueue(r, PID, '1v1'))
  await run((r) => r.del(`matchmaking:queued:${PID}`))
}

describe('queue dedup sentinel (real Redis)', () => {
  beforeEach(cleanup)
  afterAll(async () => {
    await cleanup()
    await run((r) => r.shutdown())
  })

  it('blocks a same-player join into a DIFFERENT-mode queue, and releases on leave', async () => {
    // First join succeeds.
    await expect(run((r) => joinQueue(r, entry('ranked_5v5')))).resolves.toBeUndefined()

    // Second join for another mode is rejected by the mode-agnostic sentinel —
    // this is the concurrent-double-queue bug, made deterministic.
    await expect(run((r) => joinQueue(r, entry('1v1')))).rejects.toThrow(/already in queue/)

    // Leaving the first queue releases the sentinel → the player can queue again.
    await run((r) => leaveQueue(r, PID, 'ranked_5v5'))
    await expect(run((r) => joinQueue(r, entry('1v1')))).resolves.toBeUndefined()
  })

  it('also blocks a duplicate join into the SAME mode', async () => {
    await expect(run((r) => joinQueue(r, entry('ranked_5v5')))).resolves.toBeUndefined()
    await expect(run((r) => joinQueue(r, entry('ranked_5v5')))).rejects.toThrow(/already in queue/)
  })
})
