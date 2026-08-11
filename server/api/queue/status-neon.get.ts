import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { queueEntries } from '~~/server/db/schema'
import { checkQueueStatusNeon } from '~~/server/game/matchmaking/queueNeon'
import { startFormedMatch } from '~~/server/game/matchmaking/matchStart'
import { findLiveGameForPlayer } from '~~/server/game/liveGame'

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
 *     bot-backfill retry baked in) or 'matched'. On 'matched', THIS call
 *     starts the live game (mirrors join-neon.post.ts) — the natural place
 *     for it, since checkQueueStatusNeon is what tripped the match into
 *     existing just now.
 *
 * KNOWN GAP (inherited from queueNeon.ts, not introduced here): the
 * MMR-range-widening branch of tryFormMatchNeon picks a sliding window over
 * the queue and can, when the queue holds MORE than one match's worth of
 * players, form a match that excludes the very player whose poll triggered
 * it. That player's own call then reports 'searching' with no idea a match
 * formed elsewhere — but every player who WAS matched still gets picked up
 * correctly by their own next poll's live_games check above (step 1), so
 * nobody is left holding a phantom match. Only the excluded caller polls
 * once "for nothing". A real fix belongs in queueNeon.ts's window search
 * (always include the specific playerId's row in whichever window is
 * chosen), out of scope for this wiring pass.
 */
export default defineEventHandler(async (event): Promise<StatusNeonResponse> => {
  const session = await getUserSession(event)
  const playerId = session?.user?.id as string | undefined
  if (!playerId) return { status: 'idle' }

  const activeGameId = await findLiveGameForPlayer(playerId)
  if (activeGameId) return { status: 'found', gameId: activeGameId }

  const status = await checkQueueStatusNeon(playerId)

  if (status.status === 'matched') {
    const started = await startFormedMatch(status.match)
    return { status: 'found', gameId: started.gameId }
  }

  if (status.status === 'searching') {
    const db = useDb()
    const [row] = await db
      .select({ joinedAt: queueEntries.joinedAt })
      .from(queueEntries)
      .where(eq(queueEntries.playerId, playerId))
      .limit(1)
    const botFillDue = row ? Date.now() - row.joinedAt.getTime() >= BOT_FILL_WAIT_MS : false
    return { status: 'searching', queueSize: status.queueSize, botFillDue }
  }

  return { status: 'idle' }
})
