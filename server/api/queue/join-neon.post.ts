import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { players } from '~~/server/db/schema'
import {
  joinQueue,
  isPlayerInQueue,
  queueSize,
  rosterIncludes,
  type QueueMode,
} from '~~/server/game/matchmaking/queueNeon'
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

  let result: Awaited<ReturnType<typeof joinQueue>>
  try {
    result = await joinQueue({
      playerId,
      username: player?.username ?? (session.user?.username as string | undefined) ?? playerId,
      mmr: player?.mmr ?? 1000,
      mode,
    })
  } catch (err) {
    // The isPlayerInQueue pre-check above is check-then-insert; a concurrent
    // join by the same player loses on the PK unique-violation. That is a
    // client conflict (409), not a server fault.
    if ((err as { statusCode?: number } | null)?.statusCode === 409) {
      throw createError({ statusCode: 409, message: 'Already in queue' })
    }
    throw err
  }

  if (!result.matched) {
    return { success: true, queueSize: result.queueSize }
  }

  // A formed match is ALWAYS started — its queue rows are already deleted, so
  // dropping it would strand every matched player. But it is not necessarily
  // the joiner's match (a straggler fill / MMR window can exclude them): only a
  // joiner who is IN the roster gets its gameId; otherwise they are still queued.
  const joinerInMatch = rosterIncludes(result.match, playerId)

  // startFormedMatch requeues the matched players itself when the start fails
  // (their rows were deleted when the match formed) — here we just surface it.
  let started: Awaited<ReturnType<typeof startFormedMatch>>
  try {
    started = await startFormedMatch(result.match)
  } catch (err) {
    matchLog.error('Live game start failed (from join) — players requeued', {
      mode,
      error: err instanceof Error ? err.message : String(err),
    })
    // Someone else's match failing to start is not the joiner's failure: they
    // are still queued and the failed match's players were requeued.
    if (!joinerInMatch) return { success: true, queueSize: await queueSize(mode) }
    throw createError({
      statusCode: 503,
      message: 'Match found but the game could not be started — you are still in the queue',
    })
  }
  matchLog.info('Live game started for a Neon-formed match (from join)', {
    gameId: started.gameId,
    mode,
    playerCount: result.match.roster.length,
    joinerInMatch,
  })
  if (!joinerInMatch) return { success: true, queueSize: await queueSize(mode) }
  return { success: true, queueSize: 0, gameId: started.gameId }
})
