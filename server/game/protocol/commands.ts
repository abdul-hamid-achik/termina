import * as Schema from '@effect/schema/Schema'

// ── TargetRef schemas ────────────────────────────────────────────

const HeroTarget = Schema.Struct({
  kind: Schema.Literal('hero'),
  name: Schema.String,
})

const CreepTarget = Schema.Struct({
  kind: Schema.Literal('creep'),
  index: Schema.Number,
})

const TowerTarget = Schema.Struct({
  kind: Schema.Literal('tower'),
  zone: Schema.String,
})

const SelfTarget = Schema.Struct({
  kind: Schema.Literal('self'),
})

export const TargetRefSchema = Schema.Union(HeroTarget, CreepTarget, TowerTarget, SelfTarget)

// ── Command schemas ─────────────────────────────────────────────

const MoveCommand = Schema.Struct({
  type: Schema.Literal('move'),
  zone: Schema.String,
})

const AttackCommand = Schema.Struct({
  type: Schema.Literal('attack'),
  target: TargetRefSchema,
})

const CastCommand = Schema.Struct({
  type: Schema.Literal('cast'),
  ability: Schema.Union(
    Schema.Literal('q'),
    Schema.Literal('w'),
    Schema.Literal('e'),
    Schema.Literal('r'),
  ),
  target: Schema.optional(TargetRefSchema),
})

const UseCommand = Schema.Struct({
  type: Schema.Literal('use'),
  item: Schema.String,
  target: Schema.optional(Schema.Union(TargetRefSchema, Schema.String)),
})

const BuyCommand = Schema.Struct({
  type: Schema.Literal('buy'),
  item: Schema.String,
})

const SellCommand = Schema.Struct({
  type: Schema.Literal('sell'),
  item: Schema.String,
})

const WardCommand = Schema.Struct({
  type: Schema.Literal('ward'),
  zone: Schema.String,
})

const ScanCommand = Schema.Struct({
  type: Schema.Literal('scan'),
})

const StatusCommand = Schema.Struct({
  type: Schema.Literal('status'),
})

const MapCommand = Schema.Struct({
  type: Schema.Literal('map'),
})

const ChatCommand = Schema.Struct({
  type: Schema.Literal('chat'),
  channel: Schema.Union(Schema.Literal('team'), Schema.Literal('all')),
  message: Schema.String,
})

const PingCommand = Schema.Struct({
  type: Schema.Literal('ping'),
  zone: Schema.String,
})

export const CommandSchema = Schema.Union(
  MoveCommand,
  AttackCommand,
  CastCommand,
  UseCommand,
  BuyCommand,
  SellCommand,
  WardCommand,
  ScanCommand,
  StatusCommand,
  MapCommand,
  ChatCommand,
  PingCommand,
)

/** Decode an unknown value into a validated Command. */
export const parseCommand = Schema.decodeUnknownSync(CommandSchema)

/** Safe decode that returns an Either. */
export const parseCommandEither = Schema.decodeUnknownEither(CommandSchema)
