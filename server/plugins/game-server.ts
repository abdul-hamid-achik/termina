import { Effect, Layer } from 'effect'
import { RedisService, makeRedisServiceLive, type RedisServiceApi } from '../services/RedisService'
import { DatabaseService, DatabaseServiceLive, type DatabaseServiceApi } from '../services/DatabaseService'
import { WebSocketService, WebSocketServiceLive, type WebSocketServiceApi } from '../services/WebSocketService'

interface GameRuntime {
  redisService: RedisServiceApi
  wsService: WebSocketServiceApi
  dbService: DatabaseServiceApi
  matchmakingInterval: ReturnType<typeof setInterval> | null
}

let _runtime: GameRuntime | null = null

export function getGameRuntime(): GameRuntime | null {
  return _runtime
}

export default defineNitroPlugin(async (nitroApp) => {
  const config = useRuntimeConfig()
  const redisUrl = config.redis.url as string

  // Build Effect layers
  const redisLayer = makeRedisServiceLive(redisUrl)
  const mainLayer = Layer.mergeAll(redisLayer, DatabaseServiceLive, WebSocketServiceLive)

  // Extract service implementations by running a simple Effect
  const services = Effect.gen(function* () {
    const redis = yield* RedisService
    const db = yield* DatabaseService
    const ws = yield* WebSocketService
    return { redis, db, ws }
  })

  const { redis, db, ws } = await Effect.runPromise(
    Effect.provide(services, mainLayer),
  )

  // Start matchmaking loop
  const { startMatchmakingLoop } = await import('../game/matchmaking/queue')
  const matchmakingInterval = startMatchmakingLoop(redis, ws, db)

  _runtime = {
    redisService: redis,
    wsService: ws,
    dbService: db,
    matchmakingInterval,
  }

  console.log('[TERMINA] Game server initialized')

  // Cleanup on shutdown
  nitroApp.hooks.hook('close', async () => {
    if (_runtime?.matchmakingInterval) {
      clearInterval(_runtime.matchmakingInterval)
    }
    await Effect.runPromise(redis.shutdown())
    _runtime = null
    console.log('[TERMINA] Game server shut down')
  })
})
