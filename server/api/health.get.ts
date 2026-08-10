import { getGameRuntime } from '~~/server/plugins/game-server'
import { getGameLoopHealthSummary } from '~~/server/game/engine/GameLoopHealth'

/**
 * Liveness probe for the DO App Platform / load balancer.
 *
 * Returns 200 with a JSON body while the Nitro server is alive. The `runtime`
 * field reports whether Redis + DB + WS services are initialized. Use
 * `/api/ready` for load-balancer readiness. The loop summary makes repeated
 * cycle failures observable without exposing the underlying error.
 */
export default defineEventHandler((event) => {
  const runtime = getGameRuntime()
  const loop = getGameLoopHealthSummary()
  setHeader(event, 'content-type', 'application/json')
  return {
    status: 'ok',
    runtime: runtime ? 'ready' : 'starting',
    loop,
    timestamp: Date.now(),
  }
})
