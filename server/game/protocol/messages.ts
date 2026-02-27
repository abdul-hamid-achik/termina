import * as Schema from '@effect/schema/Schema'
import { CommandSchema } from './commands'

// ── Client → Server message schemas ────────────────────────────

const ActionMessage = Schema.Struct({
  type: Schema.Literal('action'),
  command: CommandSchema,
})

const ChatMessage = Schema.Struct({
  type: Schema.Literal('chat'),
  channel: Schema.Union(Schema.Literal('team'), Schema.Literal('all')),
  message: Schema.String,
})

const PingMapMessage = Schema.Struct({
  type: Schema.Literal('ping_map'),
  zone: Schema.String,
})

const HeartbeatMessage = Schema.Struct({
  type: Schema.Literal('heartbeat'),
})

const ReconnectMessage = Schema.Struct({
  type: Schema.Literal('reconnect'),
  gameId: Schema.String,
  playerId: Schema.String,
})

export const ClientMessageSchema = Schema.Union(
  ActionMessage,
  ChatMessage,
  PingMapMessage,
  HeartbeatMessage,
  ReconnectMessage,
)

/** Decode an unknown value into a validated ClientMessage. */
export const parseClientMessage = Schema.decodeUnknownSync(ClientMessageSchema)

/** Safe decode that returns an Either. */
export const parseClientMessageEither = Schema.decodeUnknownEither(ClientMessageSchema)

// ── Server → Client message schemas ────────────────────────────

const GameEventSchema = Schema.Struct({
  tick: Schema.Number,
  type: Schema.String,
  payload: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
})

const PlayerEndStatsSchema = Schema.Struct({
  kills: Schema.Number,
  deaths: Schema.Number,
  assists: Schema.Number,
  gold: Schema.Number,
  items: Schema.Array(Schema.Union(Schema.String, Schema.Null)),
  heroDamage: Schema.Number,
  towerDamage: Schema.Number,
})

const TickStateSchema = Schema.Struct({
  type: Schema.Literal('tick_state'),
  tick: Schema.Number,
  state: Schema.Unknown, // GameState is complex; validated structurally at boundaries
})

const EventsSchema = Schema.Struct({
  type: Schema.Literal('events'),
  tick: Schema.Number,
  events: Schema.Array(GameEventSchema),
})

const AnnouncementSchema = Schema.Struct({
  type: Schema.Literal('announcement'),
  message: Schema.String,
  level: Schema.Union(
    Schema.Literal('info'),
    Schema.Literal('warning'),
    Schema.Literal('kill'),
    Schema.Literal('objective'),
  ),
})

const GameOverSchema = Schema.Struct({
  type: Schema.Literal('game_over'),
  winner: Schema.Union(Schema.Literal('radiant'), Schema.Literal('dire')),
  stats: Schema.Record({ key: Schema.String, value: PlayerEndStatsSchema }),
})

const ErrorSchema = Schema.Struct({
  type: Schema.Literal('error'),
  code: Schema.String,
  message: Schema.String,
})

const QueueUpdateSchema = Schema.Struct({
  type: Schema.Literal('queue_update'),
  playersInQueue: Schema.Number,
  estimatedWaitSeconds: Schema.Number,
})

const HeroPickSchema = Schema.Struct({
  type: Schema.Literal('hero_pick'),
  playerId: Schema.String,
  heroId: Schema.String,
})

export const ServerMessageSchema = Schema.Union(
  TickStateSchema,
  EventsSchema,
  AnnouncementSchema,
  GameOverSchema,
  ErrorSchema,
  QueueUpdateSchema,
  HeroPickSchema,
)

/** Encode a ServerMessage to a plain object. */
export const encodeServerMessage = Schema.encodeSync(ServerMessageSchema)
