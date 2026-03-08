import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import { RedisService, makeRedisServiceLive } from '../../../server/services/RedisService'

const mockRedisUrl = 'redis://localhost:6379'

describe('RedisService', () => {
  describe('API interface', () => {
    it('should expose unsubscribe method', async () => {
      const layer = makeRedisServiceLive(mockRedisUrl)
      const program = Effect.gen(function* () {
        const redis = yield* RedisService
        expect(typeof redis.unsubscribe).toBe('function')
      })
      await Effect.runPromise(program.pipe(Effect.provide(layer)))
    })

    it('should expose subscribe method', async () => {
      const layer = makeRedisServiceLive(mockRedisUrl)
      const program = Effect.gen(function* () {
        const redis = yield* RedisService
        expect(typeof redis.subscribe).toBe('function')
      })
      await Effect.runPromise(program.pipe(Effect.provide(layer)))
    })

    it('should expose shutdown method', async () => {
      const layer = makeRedisServiceLive(mockRedisUrl)
      const program = Effect.gen(function* () {
        const redis = yield* RedisService
        expect(typeof redis.shutdown).toBe('function')
      })
      await Effect.runPromise(program.pipe(Effect.provide(layer)))
    })
  })
})
