import type { Command, TargetRef } from '~~/shared/types/commands'
import { CLIENT_ONLY_COMMAND_TYPES } from '~~/shared/constants/commands'

/**
 * Runtime check for a wire `Command`. The DO-era zod schema died with ws.ts;
 * POST /api/game/action used to cast `body.command` unchecked. This is the
 * replacement — same union, no extra dependency.
 *
 * Client-only verbs (help/status/map/scan/who/net/look) are rejected here:
 * they never belong in pending_actions.
 */

const ABILITIES = new Set(['q', 'w', 'e', 'r'])
const TALENT_TIERS = new Set([10, 15, 20, 25])
const CHAT_CHANNELS = new Set(['team', 'all'])
const SURRENDER_VOTES = new Set(['yes', 'no'])
const CLIENT_ONLY = new Set<string>(CLIENT_ONLY_COMMAND_TYPES)

export type ParseCommandResult = { ok: true; command: Command } | { ok: false; reason: string }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function asInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) ? v : null
}

function parseTargetRef(raw: unknown): TargetRef | null {
  if (!isRecord(raw) || typeof raw.kind !== 'string') return null
  switch (raw.kind) {
    case 'hero': {
      const name = asNonEmptyString(raw.name)
      return name ? { kind: 'hero', name } : null
    }
    case 'wave': {
      const index = asInt(raw.index)
      return index !== null && index >= 0 ? { kind: 'wave', index } : null
    }
    case 'neutral': {
      const index = asInt(raw.index)
      return index !== null && index >= 0 ? { kind: 'neutral', index } : null
    }
    case 'ice': {
      const zone = asNonEmptyString(raw.zone)
      return zone ? { kind: 'ice', zone } : null
    }
    case 'tenant':
      return { kind: 'tenant' }
    case 'terminal':
      return { kind: 'terminal' }
    case 'zone': {
      const zone = asNonEmptyString(raw.zone)
      return zone ? { kind: 'zone', zone } : null
    }
    case 'self':
      return { kind: 'self' }
    default:
      return null
  }
}

/** `use` accepts a TargetRef or a leftover string target. */
function parseUseTarget(raw: unknown): TargetRef | string | undefined | false {
  if (raw === undefined) return undefined
  if (typeof raw === 'string') return raw.length > 0 ? raw : false
  const ref = parseTargetRef(raw)
  return ref ?? false
}

export function parseWireCommand(raw: unknown): ParseCommandResult {
  if (!isRecord(raw) || typeof raw.type !== 'string') {
    return { ok: false, reason: 'command must be an object with a type' }
  }
  if (CLIENT_ONLY.has(raw.type)) {
    return { ok: false, reason: `"${raw.type}" is a local readout, not a game action` }
  }

  switch (raw.type) {
    case 'move': {
      const zone = asNonEmptyString(raw.zone)
      if (!zone) return { ok: false, reason: 'move requires a zone' }
      return { ok: true, command: { type: 'move', zone } }
    }
    case 'attack': {
      const target = parseTargetRef(raw.target)
      if (!target) return { ok: false, reason: 'attack requires a valid target' }
      return { ok: true, command: { type: 'attack', target } }
    }
    case 'cast': {
      if (typeof raw.ability !== 'string' || !ABILITIES.has(raw.ability)) {
        return { ok: false, reason: 'cast requires ability q|w|e|r' }
      }
      const ability = raw.ability as 'q' | 'w' | 'e' | 'r'
      if (raw.target === undefined) return { ok: true, command: { type: 'cast', ability } }
      const target = parseTargetRef(raw.target)
      if (!target) return { ok: false, reason: 'cast target is invalid' }
      return { ok: true, command: { type: 'cast', ability, target } }
    }
    case 'use': {
      const item = asNonEmptyString(raw.item)
      if (!item) return { ok: false, reason: 'use requires an item' }
      const target = parseUseTarget(raw.target)
      if (target === false) return { ok: false, reason: 'use target is invalid' }
      return { ok: true, command: { type: 'use', item, target } }
    }
    case 'buy': {
      const item = asNonEmptyString(raw.item)
      if (!item) return { ok: false, reason: 'buy requires an item' }
      return { ok: true, command: { type: 'buy', item } }
    }
    case 'sell': {
      const item = asNonEmptyString(raw.item)
      if (!item) return { ok: false, reason: 'sell requires an item' }
      return { ok: true, command: { type: 'sell', item } }
    }
    case 'tap': {
      const zone = asNonEmptyString(raw.zone)
      if (!zone) return { ok: false, reason: 'tap requires a zone' }
      return { ok: true, command: { type: 'tap', zone } }
    }
    case 'backup':
      return { ok: true, command: { type: 'backup' } }
    case 'grab':
      return { ok: true, command: { type: 'grab' } }
    case 'chat': {
      if (typeof raw.channel !== 'string' || !CHAT_CHANNELS.has(raw.channel)) {
        return { ok: false, reason: 'chat requires channel team|all' }
      }
      if (typeof raw.message !== 'string' || raw.message.length === 0) {
        return { ok: false, reason: 'chat requires a message' }
      }
      if (raw.message.length > 200) {
        return { ok: false, reason: 'chat message too long' }
      }
      return {
        ok: true,
        command: { type: 'chat', channel: raw.channel as 'team' | 'all', message: raw.message },
      }
    }
    case 'ping': {
      const zone = asNonEmptyString(raw.zone)
      if (!zone) return { ok: false, reason: 'ping requires a zone' }
      return { ok: true, command: { type: 'ping', zone } }
    }
    case 'buyback':
      return { ok: true, command: { type: 'buyback' } }
    case 'surrender': {
      if (typeof raw.vote !== 'string' || !SURRENDER_VOTES.has(raw.vote)) {
        return { ok: false, reason: 'surrender requires vote yes|no' }
      }
      return { ok: true, command: { type: 'surrender', vote: raw.vote as 'yes' | 'no' } }
    }
    case 'missing': {
      const enemyId = asNonEmptyString(raw.enemyId)
      if (!enemyId) return { ok: false, reason: 'missing requires an enemyId' }
      return { ok: true, command: { type: 'missing', enemyId } }
    }
    case 'burn': {
      const target = parseTargetRef(raw.target)
      if (!target || target.kind !== 'wave') {
        return { ok: false, reason: 'burn requires a wave target' }
      }
      return { ok: true, command: { type: 'burn', target } }
    }
    case 'select_talent': {
      const tier = asInt(raw.tier)
      const talentId = asNonEmptyString(raw.talentId)
      if (tier === null || !TALENT_TIERS.has(tier) || !talentId) {
        return { ok: false, reason: 'select_talent requires tier 10|15|20|25 and a talentId' }
      }
      return {
        ok: true,
        command: { type: 'select_talent', tier: tier as 10 | 15 | 20 | 25, talentId },
      }
    }
    case 'harden':
      return { ok: true, command: { type: 'harden' } }
    case 'breach': {
      const target = parseTargetRef(raw.target)
      if (!target) return { ok: false, reason: 'breach requires a valid target' }
      return { ok: true, command: { type: 'breach', target } }
    }
    default:
      return { ok: false, reason: `unknown command type "${raw.type}"` }
  }
}
