import { checkScopedRateLimit } from '~~/server/utils/RateLimiter'
import { mintAblyTokenRequest } from '~~/server/utils/ablyToken'

/**
 * Mints a scoped Ably TokenRequest for the client SDK's authCallback.
 * Guests are allowed (they can play practice-vs-bots and need realtime
 * transport same as anyone) — this is unlike /api/queue/join, which rejects
 * guests because ranked/casual persists MMR + match history a guest has
 * none of. Minting a subscribe-only realtime credential has no such
 * dependency.
 */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user?.id) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }
  const playerId = session.user.id as string

  if (!checkScopedRateLimit('ablyAuth', playerId)) {
    throw createError({ statusCode: 429, message: 'Too many token requests — slow down' })
  }

  const apiKey = process.env.ABLY_API_KEY
  if (!apiKey) {
    throw createError({ statusCode: 503, message: 'Realtime transport not configured' })
  }

  try {
    return await mintAblyTokenRequest({ apiKey, playerId })
  } catch (err) {
    throw createError({
      statusCode: 502,
      message: `Failed to mint realtime token: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
})
