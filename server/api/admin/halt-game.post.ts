import { and, eq } from 'drizzle-orm'
import { requireAdmin } from '~~/server/utils/admin'
import { useDb } from '~~/server/db'
import { liveGames } from '~~/server/db/schema'
import { finalizeGame } from '~~/server/workflows/gameTickCore'
import { ablyPublishBatch, type AblyBatchSpec } from '~~/server/utils/ablyRest'
import { isBot } from '~~/server/game/ai/BotManager'
import { matchLog } from '~~/server/utils/log'

/**
 * The operator kill switch: halt one live game (`{gameId}`) or every live
 * game (`{all: true}`).
 *
 * Mechanics: flip the row's jsonb state to phase 'ended' under the same
 * cycle-CAS the tick workflow uses (a mid-tick write can't be clobbered —
 * on a lost race we reload and retry once), tell the human players
 * (announcement + a NOT_ASSIGNED error, which the client already treats as
 * "this match is gone, back to the lobby"), then run the standard
 * finalizeGame — match history persists for non-practice games (winner
 * null: nobody won a halted match) and the live_games/pending_actions rows
 * are deleted, which also makes any in-flight workflow run exit on its next
 * tick.
 */
export default defineEventHandler(async (event) => {
  const adminId = await requireAdmin(event)
  const body = await readBody(event).catch(() => ({}))
  const gameId = typeof body?.gameId === 'string' ? body.gameId : null
  const all = body?.all === true
  if (!gameId && !all) {
    throw createError({ statusCode: 400, message: 'Provide gameId or all: true' })
  }

  const db = useDb()
  const targets = all
    ? (await db.select({ gameId: liveGames.gameId }).from(liveGames)).map((r) => r.gameId)
    : [gameId!]

  const halted: string[] = []
  for (const id of targets) {
    const ok = await haltOne(db, id)
    if (ok) halted.push(id)
  }

  matchLog.info('Admin halted live game(s)', { adminId, halted, requested: targets })
  return { halted }
})

async function haltOne(db: ReturnType<typeof useDb>, gameId: string): Promise<boolean> {
  // Two attempts: the second absorbs losing one cycle-CAS race to an
  // in-flight tick (the workflow advances at most once per 4s window).
  for (let attempt = 0; attempt < 2; attempt++) {
    const [row] = await db.select().from(liveGames).where(eq(liveGames.gameId, gameId)).limit(1)
    if (!row) return false

    const alreadyEnded = (row.state as { phase?: string }).phase === 'ended'
    if (!alreadyEnded) {
      const updated = await db
        .update(liveGames)
        .set({ state: { ...row.state, phase: 'ended' }, updatedAt: new Date() })
        .where(and(eq(liveGames.gameId, gameId), eq(liveGames.cycle, row.cycle)))
        .returning({ gameId: liveGames.gameId })
      if (updated.length === 0) continue // lost the race — reload and retry
    }

    // Tell the humans before the channel goes quiet. NOT_ASSIGNED is the
    // client's established "match no longer active → lobby" signal.
    const specs: AblyBatchSpec[] = row.roster.players
      .filter((p) => !isBot(p.playerId))
      .flatMap((p) => {
        const channel = `game:${gameId}:p:${p.playerId}`
        return [
          {
            channel,
            name: 'announcement',
            data: { message: '[ADMIN] Match halted by the operator', level: 'warning' },
          },
          {
            channel,
            name: 'error',
            data: { code: 'NOT_ASSIGNED', message: 'Match halted by the operator' },
          },
        ]
      })
    try {
      await ablyPublishBatch(specs)
    } catch (err) {
      // Delivery is best-effort — the halt itself must not depend on Ably.
      matchLog.warn('Admin halt: Ably notify failed', { gameId, error: String(err) })
    }

    await finalizeGame(gameId)
    return true
  }
  return false
}
