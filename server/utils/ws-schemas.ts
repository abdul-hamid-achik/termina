/**
 * Runtime validation schemas for client → server WebSocket messages.
 * Mirrors ClientMessage / Command / TargetRef in shared/types — any message
 * that fails parsing is rejected before it can touch game or lobby state.
 */
import { z } from 'zod'

const zoneId = z.string().min(1).max(64)
const shortId = z.string().min(1).max(128)

const targetRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('hero'), name: z.string().min(1).max(64) }),
  z.object({ kind: z.literal('creep'), index: z.number().int().min(0).max(10_000) }),
  z.object({ kind: z.literal('neutral'), index: z.number().int().min(0).max(10_000) }),
  z.object({ kind: z.literal('tower'), zone: zoneId }),
  z.object({ kind: z.literal('roshan') }),
  z.object({ kind: z.literal('ancient') }),
  z.object({ kind: z.literal('zone'), zone: zoneId }),
  z.object({ kind: z.literal('self') }),
])

export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), zone: zoneId }),
  z.object({ type: z.literal('attack'), target: targetRefSchema }),
  z.object({
    type: z.literal('cast'),
    ability: z.enum(['q', 'w', 'e', 'r']),
    target: targetRefSchema.optional(),
  }),
  z.object({
    type: z.literal('use'),
    item: shortId,
    target: z.union([targetRefSchema, z.string().max(64)]).optional(),
  }),
  z.object({ type: z.literal('buy'), item: shortId }),
  z.object({ type: z.literal('sell'), item: shortId }),
  z.object({ type: z.literal('ward'), zone: zoneId }),
  z.object({ type: z.literal('aegis') }),
  z.object({ type: z.literal('rune') }),
  z.object({ type: z.literal('scan') }),
  z.object({ type: z.literal('status') }),
  z.object({ type: z.literal('map') }),
  z.object({
    type: z.literal('chat'),
    channel: z.enum(['team', 'all']),
    message: z.string().min(1).max(500),
  }),
  z.object({ type: z.literal('ping'), zone: zoneId }),
  z.object({ type: z.literal('buyback') }),
  z.object({ type: z.literal('surrender'), vote: z.enum(['yes', 'no']) }),
  z.object({ type: z.literal('missing'), enemyId: shortId }),
  z.object({
    type: z.literal('deny'),
    target: z.object({ kind: z.literal('creep'), index: z.number().int().min(0).max(10_000) }),
  }),
  z.object({
    type: z.literal('select_talent'),
    tier: z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(25)]),
    talentId: shortId,
  }),
  z.object({ type: z.literal('glyph') }),
])

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('action'), command: commandSchema }),
  z.object({
    type: z.literal('chat'),
    channel: z.enum(['team', 'all']),
    message: z.string().min(1).max(500),
  }),
  z.object({ type: z.literal('ping_map'), zone: zoneId }),
  z.object({ type: z.literal('heartbeat') }),
  z.object({
    type: z.literal('reconnect'),
    gameId: shortId,
    playerId: shortId,
    lastTick: z.number().int().min(0).optional(),
  }),
  z.object({ type: z.literal('join_game'), gameId: shortId }),
  z.object({ type: z.literal('hero_pick'), lobbyId: shortId, heroId: shortId }),
  z.object({ type: z.literal('request_state') }),
  z.object({ type: z.literal('spectate'), gameId: shortId }),
  z.object({ type: z.literal('unspectate') }),
])
