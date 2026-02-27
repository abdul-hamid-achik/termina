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

export type GameEngineEvent =
  | DamageEvent
  | HealEvent
  | KillEvent
  | DeathEvent
  | TowerKillEvent
  | CreepLasthitEvent
  | GoldChangeEvent
  | LevelUpEvent
  | AbilityUsedEvent
  | ItemPurchasedEvent
  | WardPlacedEvent
  | RunePickedEvent
  | RoshanKilledEvent

/** Convert an engine event to the wire GameEvent format. */
export function toGameEvent(event: GameEngineEvent): { tick: number; type: string; payload: Record<string, unknown> } {
  const { _tag, tick, ...payload } = event
  return { tick, type: _tag, payload: payload as Record<string, unknown> }
}
