import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { liveGames } from '~~/server/db/schema'
import { checkScopedRateLimit } from '~~/server/utils/RateLimiter'
import { ablyPublishBatch, type AblyBatchSpec } from '~~/server/utils/ablyRest'
import { isBot } from '~~/server/game/ai/BotManager'
import { ZONE_MAP } from '~~/shared/constants/zones'

interface SignalRequestBody {
  gameId: string
  signal:
    | { type: 'chat'; channel: 'team' | 'all'; message: string }
    | { type: 'ping_map'; zone: string }
}

const MAX_CHAT_LENGTH = 200

/**
 * Ingress for the non-action player signals — team/all chat and map pings
 * (the `missing` callout is chat with a preset line). The WS transport
 * carried these as top-level messages; on the Ably+HTTP path they land here
 * and are re-broadcast to the recipients' per-player channels with the same
 * `chat` / `ping_map` message shapes the client's GameScreen already
 * renders. The sender is included in the broadcast — seeing your own line
 * come back is the delivery confirmation.
 */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  const playerId = session?.user?.id as string | undefined
  if (!playerId) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }

  if (!checkScopedRateLimit('chat', playerId)) {
    throw createError({ statusCode: 429, message: 'Too many messages — slow down' })
  }

  const body = await readBody<SignalRequestBody>(event).catch(() => null)
  const signal = body?.signal
  if (!body?.gameId || !signal || (signal.type !== 'chat' && signal.type !== 'ping_map')) {
    throw createError({ statusCode: 400, message: 'gameId and a chat/ping_map signal required' })
  }

  if (signal.type === 'chat') {
    const message = signal.message?.trim()
    if (!message) throw createError({ statusCode: 400, message: 'Empty chat message' })
    if (message.length > MAX_CHAT_LENGTH) {
      throw createError({ statusCode: 400, message: `Chat message over ${MAX_CHAT_LENGTH} chars` })
    }
    if (signal.channel !== 'team' && signal.channel !== 'all') {
      throw createError({ statusCode: 400, message: 'Invalid chat channel' })
    }
  } else if (!ZONE_MAP[signal.zone]) {
    throw createError({ statusCode: 400, message: 'Unknown zone' })
  }

  const db = useDb()
  const [row] = await db
    .select({ roster: liveGames.roster })
    .from(liveGames)
    .where(eq(liveGames.gameId, body.gameId))
    .limit(1)
  if (!row) throw createError({ statusCode: 404, message: 'Game not found' })

  const sender = row.roster.players.find((p) => p.playerId === playerId)
  if (!sender) throw createError({ statusCode: 403, message: 'Not a player in this game' })

  // Pings are team-scoped by nature; chat honors its channel.
  const teamOnly = signal.type === 'ping_map' || signal.channel === 'team'
  const recipients = row.roster.players.filter(
    (p) => !isBot(p.playerId) && (!teamOnly || p.team === sender.team),
  )

  const data =
    signal.type === 'chat'
      ? { playerId, channel: signal.channel, message: signal.message.trim() }
      : { playerId, zone: signal.zone }

  const specs: AblyBatchSpec[] = recipients.map((p) => ({
    channel: `game:${body.gameId}:p:${p.playerId}`,
    name: signal.type,
    data,
  }))
  await ablyPublishBatch(specs)

  return { delivered: recipients.length }
})
