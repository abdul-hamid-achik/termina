import { leaveQueue } from '~~/server/game/matchmaking/queueNeon'

/**
 * All-Vercel replacement for /api/queue/leave. Simpler than the legacy
 * route: queueNeon's `queue_entries.player_id` is the table's PRIMARY KEY,
 * so a player holds at most one row across all modes — no `mode` needed to
 * target the right key (unlike the Redis per-mode sorted sets).
 */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  const playerId = session?.user?.id as string | undefined
  if (!playerId) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }

  await leaveQueue(playerId)

  return { success: true }
})
