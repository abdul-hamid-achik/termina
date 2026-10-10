const PUBLIC_EXACT_PATHS = new Set([
  '/',
  '/login',
  '/api/leaderboard',
  '/api/guild/list',
  '/api/match/history',
  '/api/health',
  '/api/ready',
  // This endpoint performs its own x-admin-key check and must reach its
  // handler so the disabled/unconfigured contract can return 403.
  '/api/admin/rotate-season',
  // Internal server-to-server trigger: there is no browser session behind it.
  // The handler fails closed on WORKFLOW_START_KEY (x-workflow-start-key
  // header, timing-safe compare), so it must reach the handler without one.
  '/api/game/start-workflow',
  '/__nuxt_error',
  '/favicon.ico',
])

const PUBLIC_PREFIXES = ['/api/auth/', '/api/replay/', '/_nuxt/']

// One-segment /api/player/* routes that are NOT public profiles (they are
// session-scoped). Everything else matching the single-segment shape is an
// opaque player id.
const PRIVATE_PLAYER_SEGMENTS = new Set([
  'me',
  'stats',
  'email-status',
  'providers',
  'password',
  'settings',
])

function isPublicPath(path: string, method: string): boolean {
  if (PUBLIC_EXACT_PATHS.has(path)) return true
  if (PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix))) return true

  // Public profile/match payloads are addressed by one opaque path segment and
  // are READ-ONLY: a PUT/POST/DELETE on the same shape (e.g. PUT
  // /api/player/password) must never be public at this layer.
  if (method === 'GET' || method === 'HEAD') {
    const playerMatch = /^\/api\/player\/([^/]+)$/.exec(path)
    if (playerMatch && !PRIVATE_PLAYER_SEGMENTS.has(playerMatch[1]!)) return true
    if (/^\/api\/match\/[^/]+$/.test(path)) return true
  }

  return false
}

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname

  // Allow public routes
  if (isPublicPath(path, event.method)) {
    return
  }

  // Allow all non-API routes (Nuxt pages handle their own auth via middleware)
  if (!path.startsWith('/api/')) {
    return
  }

  // Check session for protected API routes
  const session = await getUserSession(event)
  if (!session?.user) {
    throw createError({
      statusCode: 401,
      message: 'Authentication required',
    })
  }
})
