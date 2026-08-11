import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { players } from '~~/server/db/schema'
import { joinQueue, isPlayerInQueue, type QueueMode } from '~~/server/game/matchmaking/queueNeon'
import { startFormedMatch } from '~~/server/game/matchmaking/matchStart'
import { findLiveGameForPlayer } from '~~/server/game/liveGame'
import { checkScopedRateLimit } from '~~/server/utils/RateLimiter'
import { isGuestId } from '~~/server/utils/guest'
import { matchLog } from '~~/server/utils/log'

/**
 * All-Vercel replacement for /api/queue/join — same auth/guest-403/
 * validation as the legacy WS-era route, but wraps server/game/
 * matchmaking/queueNeon.ts (Neon-backed queue, no Redis, no
 * startMatchmakingLoop sweep) instead of the Redis queue.
 *
 * When this join completes (or bot-backfills) a roster, joinQueue returns
 * the FormedMatch directly — start the live game right here rather than
 * making the client wait for a status poll to notice. The response then
 * carries `gameId` so a caller that wants to skip straight to /play can
 * (see useQueuePolling.ts, which still polls status-neon as the fallback
 * path for the OTHER players in the match, none of whom made this call).
 */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  const playerId = session?.user?.id as string | undefined
  if (!playerId) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }

  // Ranked/casual matchmaking persists MMR, match history and hero stats —
  // none of which exist for a guest. Practice vs bots is the only mode a
  // guest can play; send them to sign in for everything else. Checked here
  // (not left to joinQueue's own guest rejection) so it's a clean 403 rather
  // than a generic thrown Error.
  if (isGuestId(playerId)) {
    throw createError({
      statusCode: 403,
      message: 'Sign in to queue for a match — guest sessions can only play practice vs bots',
    })
  }

  if (!checkScopedRateLimit('queue', playerId)) {
    throw createError({ statusCode: 429, message: 'Too many queue requests — slow down' })
  }

  const body = await readBody(event).catch(() => ({}))
  const mode = (body?.mode ?? 'ranked_5v5') as QueueMode

  if (!['ranked_5v5', 'quick_3v3', '1v1'].includes(mode)) {
    throw createError({ statusCode: 400, message: 'Invalid game mode' })
  }

  const activeGameId = await findLiveGameForPlayer(playerId)
  if (activeGameId) {
    throw createError({ statusCode: 409, message: 'Already in an active game' })
  }

  if (await isPlayerInQueue(playerId)) {
    throw createError({ statusCode: 409, message: 'Already in queue' })
  }

  const db = useDb()
  const [player] = await db
    .select({ username: players.username, mmr: players.mmr })
    .from(players)
    .where(eq(players.id, playerId))
    .limit(1)

  const result = await joinQueue({
    playerId,
    username: player?.username ?? (session.user?.username as string | undefined) ?? playerId,
    mmr: player?.mmr ?? 1000,
    mode,
  })

  if (!result.matched) {
    return { success: true, queueSize: result.queueSize }
  }

  const started = await startFormedMatch(result.match)
  matchLog.info('Live game started for a Neon-formed match (from join)', {
    gameId: started.gameId,
    mode,
    playerCount: result.match.roster.length,
  })
  return { success: true, queueSize: 0, gameId: started.gameId }
})
