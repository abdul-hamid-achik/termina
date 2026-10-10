import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { queueEntries } from '~~/server/db/schema'
import { checkQueueStatusNeon } from '~~/server/game/matchmaking/queueNeon'
import { startFormedMatch } from '~~/server/game/matchmaking/matchStart'
import { findLiveGameForPlayer } from '~~/server/game/liveGame'
import { matchLog } from '~~/server/utils/log'

// Mirrors queueNeon.ts's private BOT_FILL_WAIT_MS (10s) — kept as a literal
// copy, not imported, since it's module-private there (same "mirror, don't
// import" convention queueNeon.ts's own header uses for queue.ts's
// MATCH_SIZE_BY_MODE/MMR_RANGES/BOT_FILL_WAIT_MS).
const BOT_FILL_WAIT_MS = 10_000

export type StatusNeonResponse =
  | { status: 'idle' }
  | { status: 'searching'; queueSize: number; botFillDue: boolean }
  | { status: 'found'; gameId: string }

/**
 * All-Vercel replacement for /api/queue/status. Polled every ~2s by
 * useQueuePolling.ts instead of relying on WS pushes.
 *
 * Checked in this order:
 *  1. live_games first — a game may already be running for this player
 *     (started either by THEIR OWN join-neon call completing the roster,
 *     or by another player's join/poll). Once a live_games row exists, the
 *     player's queue_entries row is long gone (deleted atomically when the
 *     match formed), so checking the queue table first would incorrectly
 *     report 'idle'.
 *  2. checkQueueStatusNeon — reports 'searching' (with an opportunistic
 *     bot-backfill retry baked in), 'matched' (the poller is in the match
 *     that just formed) or 'formed_other' (a match formed during this poll
 *     but the poller is not in it — e.g. a straggler fill or MMR window that
 *     excludes them). EVERY formed match is started here: its queue rows are
 *     already deleted, so skipping the start would strand its players with no
 *     game and no queue row. The poller gets `found` only for its own match;
 *     otherwise it keeps `searching`.
 */
export default defineEventHandler(async (event): Promise<StatusNeonResponse> => {
  const session = await getUserSession(event)
  const playerId = session?.user?.id as string | undefined
  if (!playerId) return { status: 'idle' }

  const activeGameId = await findLiveGameForPlayer(playerId)
  if (activeGameId) return { status: 'found', gameId: activeGameId }

  const status = await checkQueueStatusNeon(playerId)

  if (status.status === 'matched' || status.status === 'formed_other') {
    // On a failed start, startFormedMatch has already put the matched players
    // back in the queue.
    let started: Awaited<ReturnType<typeof startFormedMatch>>
    try {
      started = await startFormedMatch(status.match)
    } catch (err) {
      matchLog.error('Live game start failed (from status poll) — players requeued', {
        error: err instanceof Error ? err.message : String(err),
      })
      // Surface a 503 to a poller whose OWN match failed; a poller outside the
      // match is still legitimately searching.
      if (status.status === 'matched') {
        throw createError({
          statusCode: 503,
          message: 'Match found but the game could not be started — you are still in the queue',
        })
      }
      return searchingResponse(playerId, status.queueSize)
    }
    if (status.status === 'matched') return { status: 'found', gameId: started.gameId }
    return searchingResponse(playerId, status.queueSize)
  }

  if (status.status === 'searching') return searchingResponse(playerId, status.queueSize)

  return { status: 'idle' }
})

async function searchingResponse(playerId: string, queueSize: number): Promise<StatusNeonResponse> {
  const db = useDb()
  const [row] = await db
    .select({ joinedAt: queueEntries.joinedAt })
    .from(queueEntries)
    .where(eq(queueEntries.playerId, playerId))
    .limit(1)
  const botFillDue = row ? Date.now() - row.joinedAt.getTime() >= BOT_FILL_WAIT_MS : false
  return { status: 'searching', queueSize, botFillDue }
}
