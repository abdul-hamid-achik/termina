import { getGameRuntime } from '~~/server/plugins/game-server'

/**
 * Liveness/readiness probe for the DO App Platform / load balancer.
 *
 * Returns 200 with a JSON body once the Nitro server is up and the managed
 * runtime (Redis + DB + WS services) is initialized. The `runtime` field
 * reports whether `getGameRuntime()` is ready (game loop subscriptions live).
 */
export default defineEventHandler((event) => {
  const runtime = getGameRuntime()
  setHeader(event, 'content-type', 'application/json')
  return {
    status: 'ok',
    runtime: runtime ? 'ready' : 'starting',
    timestamp: Date.now(),
  }
})
