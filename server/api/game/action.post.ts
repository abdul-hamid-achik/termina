import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { liveGames, pendingActions } from '~~/server/db/schema'
import { checkRateLimit } from '~~/server/utils/RateLimiter'
import type { ActionAckMessage } from '~~/shared/types/protocol'
import type { Command } from '~~/shared/types/commands'

interface ActionRequestBody {
  gameId: string
  command: Command
  forCycle?: number
  clientSeq?: number
}

/**
 * Action ingress for a workflow-driven game (spike/workflow-tick migration).
 * There is no long-lived WS connection backing a Vercel workflow tick, so an
 * order lands here instead of ws.ts's `action` message — written to
 * `pending_actions`, then drained by the next gameTickStep (see
 * server/workflows/gameTick.ts). The response shape is the same
 * ActionAckMessage the WS path echoes, so the client's ack handling doesn't
 * need to branch on transport.
 *
 * Body: { gameId, command, forCycle?, clientSeq? }
 */
export default defineEventHandler(async (event): Promise<ActionAckMessage> => {
  const session = await getUserSession(event)
  const playerId = session?.user?.id as string | undefined
  if (!playerId) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }

  if (!checkRateLimit(playerId)) {
    throw createError({ statusCode: 429, message: 'Action rate limited. Please slow down.' })
  }

  const body = await readBody<ActionRequestBody>(event)
  if (!body?.gameId || !body?.command) {
    throw createError({ statusCode: 400, message: 'gameId and command are required' })
  }

  const db = useDb()
  const rows = await db.select().from(liveGames).where(eq(liveGames.gameId, body.gameId)).limit(1)
  const row = rows[0]
  if (!row) {
    throw createError({ statusCode: 404, message: 'Game not found' })
  }

  const assigned = row.roster.players.some((p) => p.playerId === playerId)
  if (!assigned) {
    throw createError({ statusCode: 403, message: 'Not assigned to this game' })
  }

  const seqEcho = body.clientSeq !== undefined ? { clientSeq: body.clientSeq } : {}

  // Mirrors ws.ts's forCycle semantics: an order stamped for a cycle that
  // has already committed ('late') or hasn't opened yet ('future') is
  // refused EXPLICITLY rather than silently rolled into a batch the client
  // didn't aim it at. Unstamped orders (bots, dev tools, older clients)
  // queue for the currently-open cycle unconditionally.
  if (body.forCycle !== undefined && body.forCycle !== row.cycle) {
    return {
      type: 'action_ack',
      accepted: false,
      cycle: row.cycle,
      reason: body.forCycle < row.cycle ? 'late' : 'future',
      ...seqEcho,
    }
  }

  await db.insert(pendingActions).values({
    gameId: body.gameId,
    playerId,
    command: body.command,
    forCycle: body.forCycle ?? null,
  })

  return {
    type: 'action_ack',
    accepted: true,
    cycle: row.cycle,
    ...seqEcho,
  }
})
