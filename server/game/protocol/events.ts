import type { GameState, TeamId } from '~~/shared/types/game'
import { ZONE_MAP, ZONES } from '~~/shared/constants/zones'
import type { DamageType } from '~~/shared/types/hero'

// ── Tagged game event types ─────────────────────────────────────

export interface DamageEvent {
  readonly _tag: 'damage'
  readonly cycle: number
  readonly sourceId: string
  readonly targetId: string
  readonly amount: number
  readonly damageType: DamageType
  /** Where the effect LANDED — stamped by `stampEventZones`, never by hand.
   *  The per-player fog filter's location test (see LOCATED_EVENT_TAGS). */
  readonly zone?: string
}

/**
 * A hero's damaging hit that landed NOTHING on its target: fully absorbed by a
 * shield, dodged (Echo's phaseShift), or met immunity (AIRGAP / Proxy R /
 * ethereal for kinetic). Without it a cast that did 0 printed no line at all —
 * the player saw BW and a cooldown spent and no reason why.
 *
 * Emitted for hero ability casts and hero basic attacks. Never a `damage`
 * event: damage feeds assists, kill credit, in-combat state and the tutorial's
 * objectives, and a blocked hit must not.
 *
 * What co-occurs (the client should merge, not double-print):
 *  - cast (abilityId set): nothing else for that target — the cast's damage is
 *    read off the INTEG diff, which was 0.
 *  - basic attack, reason 'dodge': nothing else for that swing.
 *  - basic attack, reason 'immune': a `damage` event with amount 0 for the
 *    same source→target (kept for kill-credit/aggro bookkeeping).
 *  - basic attack, reason 'shield': a `damage` event with the PRE-shield
 *    amount (the basic-attack contract); this event says none of it got
 *    through. Only when the whole volley on that target was absorbed.
 */
export interface DamageBlockedEvent {
  readonly _tag: 'damage_blocked'
  readonly cycle: number
  readonly sourceId: string
  readonly targetId: string
  readonly reason: 'shield' | 'dodge' | 'immune'
  /** INTEG the hit would have cost, when the engine measured it: the shield
   *  INTEG consumed ('shield'), the swing's mitigated damage (basic-attack
   *  'dodge' / 'immune'). Omitted for a dodged / immune cast — the resolver
   *  never computed a number for a hit that did not land. */
  readonly amount?: number
  readonly damageType: DamageType
  /** The cast's ability id (as on ability_used, e.g. 'echo-q'); absent for a
   *  basic attack. */
  readonly abilityId?: string
  /** Where the hit was blocked — stamped by `stampEventZones`, never by hand.
   *  The per-player fog filter's location test (see LOCATED_EVENT_TAGS). */
  readonly zone?: string
}

export interface HealEvent {
  readonly _tag: 'heal'
  readonly cycle: number
  readonly sourceId: string
  readonly targetId: string
  readonly amount: number
  /** Where the effect LANDED — stamped by `stampEventZones`, never by hand.
   *  The per-player fog filter's location test (see LOCATED_EVENT_TAGS). */
  readonly zone?: string
}

export interface KillEvent {
  readonly _tag: 'kill'
  readonly cycle: number
  readonly killerId: string
  readonly victimId: string
  readonly assisters: string[]
  /** The victim's kill streak BEFORE dying — drives the SHUTDOWN callout. */
  readonly victimStreak?: number
  /** The killer's kill streak AFTER this kill — drives the spree callout. */
  readonly killerStreak?: number
  /** Where the effect LANDED — stamped by `stampEventZones`, never by hand.
   *  The per-player fog filter's location test (see LOCATED_EVENT_TAGS). */
  readonly zone?: string
}

export interface DeathEvent {
  readonly _tag: 'death'
  readonly cycle: number
  readonly playerId: string
  readonly respawnCycle: number
  /** Where the effect LANDED — stamped by `stampEventZones`, never by hand.
   *  The per-player fog filter's location test (see LOCATED_EVENT_TAGS). */
  readonly zone?: string
}

export interface IceKillEvent {
  readonly _tag: 'ice_kill'
  readonly cycle: number
  readonly zone: string
  readonly team: TeamId
  readonly killerTeam: TeamId
}

export interface TerminalDestroyedEvent {
  readonly _tag: 'terminal_destroyed'
  readonly cycle: number
  /** The team whose Terminal fell. */
  readonly team: TeamId
  /** The team that destroyed it (the winner). */
  readonly killerTeam: TeamId
}

export interface WaveStripEvent {
  readonly _tag: 'wave_strip'
  readonly cycle: number
  readonly playerId: string
  readonly waveId: string
  readonly waveType: 'line' | 'sweep' | 'breach'
  readonly scripAwarded: number
}

export interface WaveBurnEvent {
  readonly _tag: 'wave_burn'
  readonly cycle: number
  readonly playerId: string
  readonly waveId: string
  readonly waveType: 'line' | 'sweep' | 'breach'
  readonly scripAwarded: number
}

export interface ScripChangeEvent {
  readonly _tag: 'scrip_change'
  readonly cycle: number
  readonly playerId: string
  readonly amount: number
  readonly reason: string
}

/** A level that brings a power spike (POWER_SPIKE_LEVELS — an ultimate rank:
 *  6 brings it online, 12 / 18 ranks 2 / 3). */
export type LevelSpike = 'level_6' | 'level_12' | 'level_18'

export interface LevelUpEvent {
  readonly _tag: 'level_up'
  readonly cycle: number
  readonly playerId: string
  readonly newLevel: number
  /** Set when `newLevel` is a power-spike level (POWER_SPIKE_LEVELS): the client
   *  adds the ultimate's rank to the line ("ultimate online" at 6, "ultimate
   *  rank 2/3" at 12/18). There is no separate power_spike event
   *  for a level — one level-up is one event. */
  readonly spike?: LevelSpike
}

export interface AbilityUsedEvent {
  readonly _tag: 'ability_used'
  readonly cycle: number
  readonly playerId: string
  readonly abilityId: string
  readonly targetId?: string
  /** The caster's resulting cooldown — private: VisionCalculator strips it for
   *  viewers off the caster's team. */
  readonly cooldown?: number
  /** Where the CASTER stood — stamped by `stampEventZones`, never by hand.
   *  Lets anyone who can see the caster's zone (an AoE's victims included)
   *  read the cast line (see LOCATED_EVENT_TAGS). */
  readonly zone?: string
}

/**
 * A crowd-control effect landing on a hero. Synthesized by diffing the target's
 * buff list across a cast/item-active rather than read off the resolver's own
 * payload — the resolvers speak a wire `ability_cast` shape the client never
 * sees, and diffing state is what makes AoE secondaries, bashes and item
 * actives narrate identically to a single-target cast.
 */
export interface StatusAppliedEvent {
  readonly _tag: 'status_applied'
  readonly cycle: number
  readonly sourceId: string
  readonly targetId: string
  /** Engine buff id (`stun`, `root`, `silence`, `hex`, …). */
  readonly status: string
  /** The engine's real remaining duration, not the ability's advertised one. */
  readonly cyclesRemaining: number
  /** Where the effect LANDED — stamped by `stampEventZones`, never by hand.
   *  The per-player fog filter's location test (see LOCATED_EVENT_TAGS). */
  readonly zone?: string
}

export interface CooldownEvent {
  readonly _tag: 'cooldown_used'
  readonly cycle: number
  readonly playerId: string
  readonly abilityId: string
  readonly cooldownCycles: number
  readonly readyAtTick: number
}

export interface PowerSpikeEvent {
  readonly _tag: 'power_spike'
  readonly cycle: number
  readonly playerId: string
  /** Item spikes only (buyback); a level spike rides on LevelUpEvent.spike. */
  readonly spikeType: 'core_item'
  readonly itemId?: string
  readonly message: string
}

export interface ItemPurchasedEvent {
  readonly _tag: 'item_purchased'
  readonly cycle: number
  readonly playerId: string
  readonly itemId: string
  readonly cost: number
}

export interface ItemSoldEvent {
  readonly _tag: 'item_sold'
  readonly cycle: number
  readonly playerId: string
  readonly itemId: string
  readonly refund: number
}

export interface WardPlacedEvent {
  readonly _tag: 'ward_placed'
  readonly cycle: number
  readonly playerId: string
  readonly zone: string
  readonly team: TeamId
  readonly wardType: 'camtap' | 'sniffer'
}

export interface CachePickedEvent {
  readonly _tag: 'cache_picked'
  readonly cycle: number
  readonly playerId: string
  readonly zone: string
  readonly cacheType: string
}

export interface TrapTriggeredEvent {
  readonly _tag: 'trap_triggered'
  readonly cycle: number
  readonly owner: string
  readonly team: TeamId
  readonly zone: string
  readonly targetId: string
  readonly damage: number
}

export interface SpellBlockedEvent {
  readonly _tag: 'spell_blocked'
  readonly cycle: number
  readonly casterId: string
  readonly targetId: string
  readonly source: 'intercept_shell' | 'ablative_shell' | 'mirror_shell'
  /** For Lotus Orb: the damage bounced back to the caster (omitted for a pure block). */
  readonly reflected?: number
  /** Where the effect LANDED — stamped by `stampEventZones`, never by hand.
   *  The per-player fog filter's location test (see LOCATED_EVENT_TAGS). */
  readonly zone?: string
}

/**
 * The Tenant fell. ONE event: the engine (TenantAI) emits it with just the
 * cycle; `killerTeam` / `scripAwarded` are optional so a producer that knows
 * the killing crew can name it (combatNarrative renders both shapes).
 */
export interface TenantKilledEvent {
  readonly _tag: 'tenant_killed'
  readonly cycle: number
  readonly killerTeam?: TeamId
  readonly scripAwarded?: number
}

export interface NeutralKilledEvent {
  readonly _tag: 'neutral_killed'
  readonly cycle: number
  readonly playerId: string
  readonly neutralId: string
  readonly neutralType: string
  readonly zone: string
}

export interface TenantDamageEvent {
  readonly _tag: 'tenant_damage'
  readonly cycle: number
  readonly damage: number
  readonly integ: number
  readonly maxInteg: number
  /** Where the effect LANDED — stamped by `stampEventZones`, never by hand.
   *  The per-player fog filter's location test (see LOCATED_EVENT_TAGS). */
  readonly zone?: string
}

export interface TenantRespawnEvent {
  readonly _tag: 'tenant_respawn'
  readonly cycle: number
  readonly integ: number
  readonly maxInteg: number
}

export interface BackupPickedEvent {
  readonly _tag: 'backup_picked'
  readonly cycle: number
  readonly playerId: string
}

export interface BackupUsedEvent {
  readonly _tag: 'backup_used'
  readonly cycle: number
  readonly playerId: string
}

export interface TalentSelectedEvent {
  readonly _tag: 'talent_selected'
  readonly cycle: number
  readonly playerId: string
  readonly talentId: string
  readonly tier: number
  readonly talentName: string
}

export interface TeleportCompleteEvent {
  readonly _tag: 'teleport_complete'
  readonly cycle: number
  readonly playerId: string
  readonly destination: string
  /** Return-shadow variants (Traceroute Next Hop / Lambda Return) so the feed
   *  can narrate the snap-back distinctly from a plain town-portal teleport. */
  readonly source?: 'return' | 'next_hop'
}

export interface TeleportCancelledEvent {
  readonly _tag: 'teleport_cancelled'
  readonly cycle: number
  readonly playerId: string
  readonly reason: 'movement' | 'damage'
}

export interface NightFallsEvent {
  readonly _tag: 'night_falls'
  readonly cycle: number
}

export interface DayBreaksEvent {
  readonly _tag: 'day_breaks'
  readonly cycle: number
}

export interface HardenUsedEvent {
  readonly _tag: 'harden_used'
  readonly cycle: number
  readonly team: TeamId
}

export interface HardenOnCooldownEvent {
  readonly _tag: 'harden_on_cooldown'
  readonly cycle: number
  readonly playerId: string
  readonly remainingTicks: number
}

export interface IceInvulnerableEvent {
  readonly _tag: 'ice_invulnerable'
  readonly cycle: number
  readonly zone: string
  /** The hero whose swing bounced. */
  readonly playerId?: string
  /** True when that hero's typed order was ALSO refused through the rejected
   *  channel — the feed then prints the rejection for them, not this line too
   *  (a standing-order re-swing is not rejected, so this line is its only one). */
  readonly reported?: boolean
}

export interface SurrenderVoteEvent {
  readonly _tag: 'surrender_vote'
  readonly cycle: number
  readonly playerId: string
  readonly team: 'chaff' | 'audit'
  readonly votesFor: number
  readonly votesNeeded: number
}

export interface SurrenderedEvent {
  readonly _tag: 'surrendered'
  readonly cycle: number
  readonly team: 'chaff' | 'audit'
  readonly winner: 'chaff' | 'audit'
}

export interface AfkTakeoverEvent {
  readonly _tag: 'afk_takeover'
  readonly cycle: number
  readonly playerId: string
  readonly heroId: string | null
  readonly team: 'chaff' | 'audit'
  readonly message: string
}

export interface DoubleCastEvent {
  readonly _tag: 'double_cast'
  readonly cycle: number
  readonly playerId: string
  readonly abilityId: string
}

export interface BreachOpenedEvent {
  readonly _tag: 'breach_opened'
  readonly cycle: number
  readonly playerId: string
  readonly targetId: string
  readonly durationCycles: number
  /** Auto-breach: the player ordered this control ability at a CLOSED hero and
   *  the engine breached instead (ActionResolver.convertClosedControlCast).
   *  Absent on a typed `breach`. */
  readonly fromAbility?: 'q' | 'w' | 'e' | 'r'
  readonly fromAbilityName?: string
}

/** Hard control from a resolved cast fizzled on a CLOSED (non-breached) hero —
 *  mostly AoE control, since single-target control at a CLOSED hero is
 *  converted into a breach. One per target+status. `playerId` is the CASTER
 *  (it is also what the per-player vision filter keys team visibility on). */
export interface ControlResistedEvent {
  readonly _tag: 'control_resisted'
  readonly cycle: number
  readonly playerId: string
  readonly targetId: string
  readonly status: string
  readonly ability: 'q' | 'w' | 'e' | 'r'
  readonly abilityName: string
  readonly reason: string
}

export type GameEngineEvent =
  | DamageEvent
  | HealEvent
  | KillEvent
  | DeathEvent
  | IceKillEvent
  | TerminalDestroyedEvent
  | WaveStripEvent
  | WaveBurnEvent
  | ScripChangeEvent
  | LevelUpEvent
  | AbilityUsedEvent
  | StatusAppliedEvent
  | CooldownEvent
  | PowerSpikeEvent
  | ItemPurchasedEvent
  | ItemSoldEvent
  | WardPlacedEvent
  | CachePickedEvent
  | TrapTriggeredEvent
  | SpellBlockedEvent
  | DamageBlockedEvent
  | TenantKilledEvent
  | NeutralKilledEvent
  | TenantDamageEvent
  | TenantRespawnEvent
  | BackupPickedEvent
  | BackupUsedEvent
  | TalentSelectedEvent
  | TeleportCompleteEvent
  | TeleportCancelledEvent
  | NightFallsEvent
  | DayBreaksEvent
  | HardenUsedEvent
  | HardenOnCooldownEvent
  | IceInvulnerableEvent
  | SurrenderVoteEvent
  | SurrenderedEvent
  | AfkTakeoverEvent
  | DoubleCastEvent
  | BreachOpenedEvent
  | ControlResistedEvent

/** Convert an engine event to the wire GameEvent format. */
export function toGameEvent(event: GameEngineEvent): {
  cycle: number
  type: string
  payload: Record<string, unknown>
} {
  const { _tag, cycle, ...payload } = event
  return { cycle, type: _tag, payload: payload as Record<string, unknown> }
}

// ── Event location (fog) ────────────────────────────────────────

/**
 * Tags whose `zone` is a LOCATION STAMP: where the effect landed, written by
 * `stampEventZones` at the end of the phase that emitted the event (so a hero
 * who is hit and then walks away is located where the hit landed, not where
 * they ended the cycle). The per-player fog filter uses it as the event's
 * location — and redacts it for a viewer who can't see that zone, because an
 * event visible only through an allied hero (my DoT ticking on an enemy who
 * walked into fog) must not hand over the enemy's position.
 *
 * Events whose `zone` is SEMANTIC (ward_placed, cache_picked, ice_kill,
 * trap_triggered, neutral_killed, ice_invulnerable) carry it from their
 * producer and are not in this set.
 */
export const LOCATED_EVENT_TAGS: ReadonlySet<string> = new Set([
  'damage',
  'heal',
  'kill',
  'death',
  'status_applied',
  'spell_blocked',
  'damage_blocked',
  'tenant_damage',
  'ability_used',
])

/** The Tenant's pit. TenantAI and BotAI hard-code the same id. */
export const TENANT_ZONE = 'hollow'

const TERMINAL_ZONE: Record<string, string | undefined> = Object.fromEntries(
  ZONES.filter((z) => z.type === 'base' && (z.team === 'chaff' || z.team === 'audit')).map((z) => [
    z.team,
    z.id,
  ]),
)

/** The positional slice of state `stampEventZones` reads (resolveActions
 *  stamps mid-resolution from its own working copies). */
export interface EventZoneLookup {
  readonly players: GameState['players']
  readonly waves: readonly { readonly id: string; readonly zone: string }[]
  readonly neutrals?: readonly { readonly id: string; readonly zone: string }[]
}

/** Zone of any engine entity id: hero, wave, neutral, `ice_<zone>`,
 *  `terminal_<team>`, `tenant`. Undefined when the entity is gone/unknown. */
export function entityZone(id: unknown, s: EventZoneLookup): string | undefined {
  if (typeof id !== 'string' || !id) return undefined
  const player = s.players[id]
  if (player) return player.zone
  if (id === 'tenant') return TENANT_ZONE
  if (id.startsWith('ice_')) {
    const zone = id.slice('ice_'.length)
    return ZONE_MAP[zone] ? zone : undefined
  }
  if (id.startsWith('terminal_')) return TERMINAL_ZONE[id.slice('terminal_'.length)]
  return s.waves.find((w) => w.id === id)?.zone ?? s.neutrals?.find((n) => n.id === id)?.zone
}

/** [subject, fallback] entity ids that locate an event: the effect lands on
 *  the subject; the actor is the fallback for a subject already removed (a
 *  wave stripped by the hit that is being stamped). */
function locatingIds(e: GameEngineEvent): [unknown, unknown] | null {
  switch (e._tag) {
    case 'damage':
    case 'heal':
    case 'status_applied':
      return [e.targetId, e.sourceId]
    case 'spell_blocked':
      return [e.targetId, e.casterId]
    case 'damage_blocked':
      return [e.targetId, e.sourceId]
    case 'kill':
      return [e.victimId, e.killerId]
    case 'death':
      return [e.playerId, null]
    case 'tenant_damage':
      return ['tenant', null]
    case 'ability_used':
      return [e.playerId, null]
    default:
      return null
  }
}

/**
 * Stamp `zone` onto every LOCATED event in `events[from..]` that lacks one,
 * from the positions in `s`. Call it at the end of each phase that emits
 * events (positions only change in the movement phase, on teleports and on
 * respawn), so the stamp is the zone at resolution time. Never overwrites an
 * existing zone — the earliest stamp wins. Mutates the array (not the events).
 */
export function stampEventZones(events: GameEngineEvent[], s: EventZoneLookup, from = 0): void {
  for (let i = from; i < events.length; i++) {
    const e = events[i]!
    if ('zone' in e && e.zone) continue
    const ids = locatingIds(e)
    if (!ids) continue
    const zone = entityZone(ids[0], s) ?? entityZone(ids[1], s)
    if (zone) events[i] = { ...e, zone } as GameEngineEvent
  }
}
