import { getGameRuntime } from '~~/server/plugins/game-server'

/**
 * Liveness probe (Vercel Functions have no separate load-balancer health
 * check, but this stays for parity with /api/ready and for any external
 * uptime monitor).
 *
 * Returns 200 with a JSON body while the Nitro server is alive. The `runtime`
 * field reports whether the DB service layer is initialized. Use /api/ready
 * for the stricter readiness gate (schema contract included).
 *
 * The per-game cycle-failure loop summary this used to report died with the
 * DO-era in-process game loop fiber (server/game/engine/GameLoopHealth.ts) —
 * Vercel Workflow (server/workflows/gameTick.ts) now drives each tick as its
 * own step with its own retry semantics, so there is no long-lived
 * per-instance loop to report health for.
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
