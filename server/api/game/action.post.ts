import { eq, sql } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { liveGames } from '~~/server/db/schema'
import { checkRateLimit } from '~~/server/utils/RateLimiter'
import type { ActionAckMessage } from '~~/shared/types/protocol'
import { parseWireCommand } from '~~/shared/utils/parseCommand'
import {
  GAME_SESSION_CHANGED,
  GAME_SESSION_CHANGED_MESSAGE,
  isFormerGuestOf,
} from '~~/server/utils/guest'

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
    // The session was a guest when this practice game started and has since
    // signed in (here or in another tab): the game is the guest's, the session
    // is not. Say THAT — a bare 403 read as "order failed to reach the server"
    // and the client looped "retype it" forever (playtest 2, 43-44.png).
    if (isFormerGuestOf(session, row.roster)) {
      throw createError({
        statusCode: 409,
        message: GAME_SESSION_CHANGED_MESSAGE,
        data: { code: GAME_SESSION_CHANGED },
      })
    }
    throw createError({ statusCode: 403, message: 'Not assigned to this game' })
  }

  // An AFK-converted human's slot is bot-controlled for the rest of the match
  // (no-reclaim): the tick's bot driver submits into the same slot AFTER this
  // queue drains, so an order accepted here would be acked and then silently
  // overridden. Refuse it up front — except `surrender`, which the client
  // still allows converted players to vote on.
  const slot = (row.state.players as Record<string, { aiControlled?: boolean }> | undefined)?.[
    playerId
  ]
  if (command.type !== 'surrender' && slot?.aiControlled) {
    throw createError({
      statusCode: 409,
      message: 'Your slot was taken over by AI after inactivity; only surrender votes are accepted',
    })
  }

  const seqEcho = body.clientSeq !== undefined ? { clientSeq: body.clientSeq } : {}

  // Mirrors ws.ts's forCycle semantics: an order stamped for a cycle that
  // has already committed ('late') or hasn't opened yet ('future') is
  // refused EXPLICITLY rather than silently rolled into a batch the client
  // didn't aim it at. Unstamped orders (bots, dev tools, older clients)
  // queue for the currently-open cycle unconditionally.
  //
  // This is the SAME rule gameTickCore.applyDrainedActions applies when it
  // drains (late = forCycle < the cycle the tick loaded), but a check done on
  // the row read above and an insert done after it can straddle a tick commit
  // — the order would be acked "accepted" and then dropped as late. So the
  // decision is re-made ATOMICALLY with the insert: one statement that only
  // inserts while the game is still live and still at `forCycle`. (A residual
  // window remains between a tick READING the queue and COMMITTING its cycle,
  // ~one processCycle; an order landing in it is logged and dropped as late by
  // the next tick — closing that needs the tick to hold a lock across the
  // whole cycle.)
  const ack = (accepted: boolean, cycle: number, reason?: 'late' | 'future'): ActionAckMessage => ({
    type: 'action_ack',
    accepted,
    cycle,
    ...(reason ? { reason } : {}),
    ...seqEcho,
  })

  // A finished game takes no more orders (the final state is in flight and the
  // row is about to be finalized+deleted). 'late' is the closest wire reason:
  // the batch this order was aimed at has committed.
  if (row.state.phase === 'ended') {
    return ack(false, row.cycle, 'late')
  }

  if (body.forCycle !== undefined && body.forCycle !== row.cycle) {
    return ack(false, row.cycle, body.forCycle < row.cycle ? 'late' : 'future')
  }

  const stamped = body.forCycle ?? null
  const inserted = await db.execute(sql`
    insert into pending_actions (game_id, player_id, command, for_cycle)
    select ${body.gameId}, ${playerId}, ${JSON.stringify(command)}::jsonb, ${stamped}::integer
    where exists (
      select 1 from live_games
      where game_id = ${body.gameId}
        and coalesce(state->>'phase', '') <> 'ended'
        and (${stamped}::integer is null or cycle = ${stamped}::integer)
    )
    returning id
  `)
  if (inserted.length === 0) {
    // Lost a race with a tick commit (or the game ended / was finalized).
    // Re-read to say honestly why.
    const [now] = await db
      .select({ cycle: liveGames.cycle, state: liveGames.state })
      .from(liveGames)
      .where(eq(liveGames.gameId, body.gameId))
      .limit(1)
    if (!now) throw createError({ statusCode: 404, message: 'Game not found' })
    if (now.state.phase === 'ended') return ack(false, now.cycle, 'late')
    return ack(false, now.cycle, stamped !== null && stamped < now.cycle ? 'late' : 'future')
  }

  return ack(true, row.cycle)
})
