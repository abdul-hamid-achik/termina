import { requireAdmin } from '~~/server/utils/admin'
import { useDb } from '~~/server/db'
import { queueEntries } from '~~/server/db/schema'
import { matchLog } from '~~/server/utils/log'

/** Operator flush of the matchmaking queue — every waiting player's next
 *  status poll reports idle and their client stops searching. */
export default defineEventHandler(async (event) => {
  const adminId = await requireAdmin(event)
  const removed = await useDb().delete(queueEntries).returning({ playerId: queueEntries.playerId })
  matchLog.info('Admin flushed the matchmaking queue', { adminId, removed: removed.length })
  return { removed: removed.length }
})
