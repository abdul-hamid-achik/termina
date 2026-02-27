const PUBLIC_PATHS = [
  '/',
  '/login',
  '/api/leaderboard',
  '/api/auth/',
  '/_nuxt/',
  '/__nuxt_error',
  '/favicon.ico',
]

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname

  // Allow public routes
  if (PUBLIC_PATHS.some((p) => path === p || path.startsWith(p))) {
    return
  }

  // Allow WebSocket upgrade
  if (path === '/ws' || path.startsWith('/ws')) {
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
