import type { TeamId } from '~~/shared/types/game'
import type { DamageType } from '~~/shared/types/hero'

// ── Tagged game event types ─────────────────────────────────────

export interface DamageEvent {
  readonly _tag: 'damage'
  readonly tick: number
  readonly sourceId: string
  readonly targetId: string
  readonly amount: number
  readonly damageType: DamageType
}

export interface HealEvent {
  readonly _tag: 'heal'
  readonly tick: number
  readonly sourceId: string
  readonly targetId: string
  readonly amount: number
}

export interface KillEvent {
  readonly _tag: 'kill'
  readonly tick: number
  readonly killerId: string
  readonly victimId: string
  readonly assisters: string[]
}

export interface DeathEvent {
  readonly _tag: 'death'
  readonly tick: number
  readonly playerId: string
  readonly respawnTick: number
}

export interface TowerKillEvent {
  readonly _tag: 'tower_kill'
  readonly tick: number
  readonly zone: string
  readonly team: TeamId
  readonly killerTeam: TeamId
}

export interface CreepLasthitEvent {
  readonly _tag: 'creep_lasthit'
  readonly tick: number
  readonly playerId: string
  readonly creepId: string
  readonly creepType: 'melee' | 'ranged' | 'siege'
  readonly goldAwarded: number
}

export interface CreepDenyEvent {
  readonly _tag: 'creep_deny'
  readonly tick: number
  readonly playerId: string
  readonly creepId: string
  readonly creepType: 'melee' | 'ranged' | 'siege'
  readonly goldAwarded: number
}

export interface GoldChangeEvent {
  readonly _tag: 'gold_change'
  readonly tick: number
  readonly playerId: string
  readonly amount: number
  readonly reason: string
}

export interface LevelUpEvent {
  readonly _tag: 'level_up'
  readonly tick: number
  readonly playerId: string
  readonly newLevel: number
}

export interface AbilityUsedEvent {
  readonly _tag: 'ability_used'
  readonly tick: number
  readonly playerId: string
  readonly abilityId: string
  readonly targetId?: string
  readonly cooldown?: number
}

export interface CooldownEvent {
  readonly _tag: 'cooldown_used'
  readonly tick: number
  readonly playerId: string
  readonly abilityId: string
  readonly cooldownTicks: number
  readonly readyAtTick: number
}

export interface PowerSpikeEvent {
  readonly _tag: 'power_spike'
  readonly tick: number
  readonly playerId: string
  readonly spikeType: 'level_6' | 'level_12' | 'level_18' | 'core_item'
  readonly itemId?: string
  readonly message: string
}

export interface EnemyMissingEvent {
  readonly _tag: 'enemy_missing'
  readonly tick: number
  readonly playerId: string
  readonly lastSeenZone: string
  readonly lastSeenTick: number
  readonly reportedBy: string
}

export interface ContestLasthitEvent {
  readonly _tag: 'contest_lasthit'
  readonly tick: number
  readonly farmerId: string
  readonly harasserId: string
  readonly damageDealt: number
  readonly success: boolean
}

export interface ItemPurchasedEvent {
  readonly _tag: 'item_purchased'
  readonly tick: number
  readonly playerId: string
  readonly itemId: string
  readonly cost: number
}

export interface WardPlacedEvent {
  readonly _tag: 'ward_placed'
  readonly tick: number
  readonly playerId: string
  readonly zone: string
  readonly team: TeamId
  readonly wardType: 'observer' | 'sentry'
}

export interface RunePickedEvent {
  readonly _tag: 'rune_picked'
  readonly tick: number
  readonly playerId: string
  readonly zone: string
  readonly runeType: string
}

export interface RoshanKilledEvent {
  readonly _tag: 'roshan_killed'
  readonly tick: number
  readonly killerTeam: TeamId
  readonly goldAwarded: number
}

export interface NeutralKilledEvent {
  readonly _tag: 'neutral_killed'
  readonly tick: number
  readonly playerId: string
  readonly neutralId: string
  readonly neutralType: string
  readonly zone: string
}

export interface RoshanDamageEvent {
  readonly _tag: 'roshan_damage'
  readonly tick: number
  readonly damage: number
  readonly hp: number
  readonly maxHp: number
}

export interface RoshanRespawnEvent {
  readonly _tag: 'roshan_respawn'
  readonly tick: number
  readonly hp: number
  readonly maxHp: number
}

export interface RoshanKilledInternalEvent {
  readonly _tag: 'roshan_killed'
  readonly tick: number
}

export interface AegisPickedEvent {
  readonly _tag: 'aegis_picked'
  readonly tick: number
  readonly playerId: string
}

export interface AegisUsedEvent {
  readonly _tag: 'aegis_used'
  readonly tick: number
  readonly playerId: string
}

export interface TalentSelectedEvent {
  readonly _tag: 'talent_selected'
  readonly tick: number
  readonly playerId: string
  readonly talentId: string
  readonly tier: number
  readonly talentName: string
}

export interface TeleportCompleteEvent {
  readonly _tag: 'teleport_complete'
  readonly tick: number
  readonly playerId: string
  readonly destination: string
}

export interface TeleportCancelledEvent {
  readonly _tag: 'teleport_cancelled'
  readonly tick: number
  readonly playerId: string
  readonly reason: 'movement' | 'damage'
}

export interface NightFallsEvent {
  readonly _tag: 'night_falls'
  readonly tick: number
}

export interface DayBreaksEvent {
  readonly _tag: 'day_breaks'
  readonly tick: number
}

export interface GlyphUsedEvent {
  readonly _tag: 'glyph_used'
  readonly tick: number
  readonly team: TeamId
}

export interface GlyphOnCooldownEvent {
  readonly _tag: 'glyph_on_cooldown'
  readonly tick: number
  readonly playerId: string
  readonly remainingTicks: number
}

export interface TowerInvulnerableEvent {
  readonly _tag: 'tower_invulnerable'
  readonly tick: number
  readonly zone: string
}

export type GameEngineEvent =
  | DamageEvent
  | HealEvent
  | KillEvent
  | DeathEvent
  | TowerKillEvent
  | CreepLasthitEvent
  | CreepDenyEvent
  | GoldChangeEvent
  | LevelUpEvent
  | AbilityUsedEvent
  | CooldownEvent
  | PowerSpikeEvent
  | EnemyMissingEvent
  | ContestLasthitEvent
  | ItemPurchasedEvent
  | WardPlacedEvent
  | RunePickedEvent
  | RoshanKilledEvent
  | NeutralKilledEvent
  | RoshanDamageEvent
  | RoshanRespawnEvent
  | RoshanKilledInternalEvent
  | AegisPickedEvent
  | AegisUsedEvent
  | TalentSelectedEvent
  | TeleportCompleteEvent
  | TeleportCancelledEvent
  | NightFallsEvent
  | DayBreaksEvent
  | GlyphUsedEvent
  | GlyphOnCooldownEvent
  | TowerInvulnerableEvent

/** Convert an engine event to the wire GameEvent format. */
export function toGameEvent(event: GameEngineEvent): {
  tick: number
  type: string
  payload: Record<string, unknown>
} {
  const { _tag, tick, ...payload } = event
  return { tick, type: _tag, payload: payload as Record<string, unknown> }
}
