const PUBLIC_EXACT_PATHS = new Set([
  '/',
  '/login',
  '/api/leaderboard',
  '/api/guild/list',
  '/api/match/active',
  '/api/match/history',
  '/api/health',
  '/api/ready',
  '/__nuxt_error',
  '/favicon.ico',
])

const PUBLIC_PREFIXES = ['/api/auth/', '/api/replay/', '/_nuxt/']

function isPublicPath(path: string): boolean {
  if (PUBLIC_EXACT_PATHS.has(path)) return true
  if (PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix))) return true

  // Public profile/match payloads are addressed by one opaque path segment.
  // Keep `/api/player/me` and every settings endpoint protected.
  if (/^\/api\/player\/[^/]+$/.test(path) && path !== '/api/player/me') return true
  if (/^\/api\/match\/[^/]+$/.test(path)) return true

  return false
}

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname

  // Allow public routes
  if (isPublicPath(path)) {
    return
  }

  // Validate session for WebSocket upgrade and attach to request
  if (path === '/ws' || path.startsWith('/ws')) {
    const session = await getUserSession(event)
    ;(event.node.req as unknown as Record<string, unknown>).__authSession = session ?? null
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
