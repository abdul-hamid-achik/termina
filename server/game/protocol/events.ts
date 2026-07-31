import type { TeamId } from '~~/shared/types/game'
import type { DamageType } from '~~/shared/types/hero'

// ── Tagged game event types ─────────────────────────────────────

export interface DamageEvent {
  readonly _tag: 'damage'
  readonly cycle: number
  readonly sourceId: string
  readonly targetId: string
  readonly amount: number
  readonly damageType: DamageType
}

export interface HealEvent {
  readonly _tag: 'heal'
  readonly cycle: number
  readonly sourceId: string
  readonly targetId: string
  readonly amount: number
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
}

export interface DeathEvent {
  readonly _tag: 'death'
  readonly cycle: number
  readonly playerId: string
  readonly respawnCycle: number
}

export interface IceKillEvent {
  readonly _tag: 'ice_kill'
  readonly cycle: number
  readonly zone: string
  readonly team: TeamId
  readonly killerTeam: TeamId
}

export interface AncientDestroyedEvent {
  readonly _tag: 'terminal_destroyed'
  readonly cycle: number
  /** The team whose Ancient (Core) fell. */
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

export interface GoldChangeEvent {
  readonly _tag: 'gold_change'
  readonly cycle: number
  readonly playerId: string
  readonly amount: number
  readonly reason: string
}

export interface LevelUpEvent {
  readonly _tag: 'level_up'
  readonly cycle: number
  readonly playerId: string
  readonly newLevel: number
}

export interface AbilityUsedEvent {
  readonly _tag: 'ability_used'
  readonly cycle: number
  readonly playerId: string
  readonly abilityId: string
  readonly targetId?: string
  readonly cooldown?: number
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
  readonly spikeType: 'level_6' | 'level_12' | 'level_18' | 'core_item'
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
}

export interface TenantKilledEvent {
  readonly _tag: 'tenant_killed'
  readonly cycle: number
  readonly killerTeam: TeamId
  readonly scripAwarded: number
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
}

export interface TenantRespawnEvent {
  readonly _tag: 'tenant_respawn'
  readonly cycle: number
  readonly integ: number
  readonly maxInteg: number
}

export interface TenantKilledInternalEvent {
  readonly _tag: 'tenant_killed'
  readonly cycle: number
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
}

export type GameEngineEvent =
  | DamageEvent
  | HealEvent
  | KillEvent
  | DeathEvent
  | IceKillEvent
  | AncientDestroyedEvent
  | WaveStripEvent
  | WaveBurnEvent
  | GoldChangeEvent
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
  | TenantKilledEvent
  | NeutralKilledEvent
  | TenantDamageEvent
  | TenantRespawnEvent
  | TenantKilledInternalEvent
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

/** Convert an engine event to the wire GameEvent format. */
export function toGameEvent(event: GameEngineEvent): {
  cycle: number
  type: string
  payload: Record<string, unknown>
} {
  const { _tag, cycle, ...payload } = event
  return { cycle, type: _tag, payload: payload as Record<string, unknown> }
}
