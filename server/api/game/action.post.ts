import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { liveGames, pendingActions } from '~~/server/db/schema'
import { checkRateLimit } from '~~/server/utils/RateLimiter'
import type { ActionAckMessage } from '~~/shared/types/protocol'
import { parseWireCommand } from '~~/shared/utils/parseCommand'

interface ActionRequestBody {
  gameId: string
  command: unknown
  forCycle?: number
  clientSeq?: number
}

/**
 * Action ingress for a workflow-driven game (spike/workflow-tick migration).
 * There is no long-lived WS connection backing a Vercel workflow tick, so an
 * order lands here instead of the deleted DO-era ws.ts's `action` message —
 * written to `pending_actions`, then drained by the next gameTickStep (see
 * server/workflows/gameTick.ts). The response shape is the same
 * ActionAckMessage the old WS path echoed, so the client's ack handling
 * doesn't need to branch on transport.
 *
 * `body.command` is checked by parseWireCommand before it reaches
 * pending_actions (Trap #9 — the wire Command union). validateAction remains
 * the engine's semantic gate (range, BW, alive).
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
  if (!body?.gameId || body.command === undefined) {
    throw createError({ statusCode: 400, message: 'gameId and command are required' })
  }

  const parsed = parseWireCommand(body.command)
  if (!parsed.ok) {
    throw createError({ statusCode: 400, message: parsed.reason })
  }
  const command = parsed.command

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
    command,
    forCycle: body.forCycle ?? null,
  })

  return {
    type: 'action_ack',
    accepted: true,
    cycle: row.cycle,
    ...seqEcho,
  }
})
