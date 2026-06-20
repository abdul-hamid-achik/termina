/**
 * CORS headers for the Vercel frontend → DigitalOcean API split.
 *
 * When the SPA is on Vercel (e.g. `termina.vercel.app`) and the API/WS server
 * is on DO (e.g. `ws.termina.xyz`), browser fetches from the SPA to the API
 * are cross-origin and need CORS headers. Without them the browser blocks the
 * response.
 *
 * In dev + single-instance DO (same-origin), the Origin header matches the
 * server's own host and these headers are a harmless no-op.
 *
 * Credentials are included (the SPA sends the session cookie), so the origin
 * can't be `*` — we echo the request's Origin back.
 */
export default defineEventHandler((event) => {
  const origin = getHeader(event, 'origin')
  if (!origin) return

  // Only set CORS on /api routes (WS handles its own origin via crossws).
  const path = event.path
  if (!path.startsWith('/api/')) return

  setHeader(event, 'access-control-allow-origin', origin)
  setHeader(event, 'access-control-allow-credentials', 'true')
  setHeader(event, 'access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS')
  setHeader(event, 'access-control-allow-headers', 'Content-Type, Authorization, Cookie')
  setHeader(event, 'access-control-max-age', '86400')

  // Preflight short-circuit.
  if (getMethod(event) === 'OPTIONS') {
    setResponseStatus(event, 204)
    return ''
  }
})
