import { getGameRuntime } from '~~/server/plugins/game-server'

/**
 * Readiness probe for the DO App Platform / load balancer.
 *
 * Liveness must stay 200 while Nitro is starting; readiness must not receive
 * traffic until the managed Redis/DB/WebSocket runtime and game-ready
 * subscription have been initialized.
 */
export default defineEventHandler((event) => {
  const runtime = getGameRuntime()
  const ready = runtime != null

  setHeader(event, 'content-type', 'application/json')
  setResponseStatus(event, ready ? 200 : 503)

  return {
    status: ready ? 'ready' : 'starting',
    runtime: ready ? 'ready' : 'starting',
    timestamp: Date.now(),
  }
})
