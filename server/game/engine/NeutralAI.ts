import type { GameState, NeutralCreepState } from '~~/shared/types/game'
import {
  NEUTRAL_CREEPS,
  NEUTRAL_CREEPS_INTERVAL_TICKS,
  type NeutralCreepType,
} from '~~/shared/constants/balance'
import { isDamageImmune } from './DamageCalculator'

let neutralIdCounter = 0
let gameInstanceSuffix = ''

function nextNeutralId(): string {
  return `neutral_${gameInstanceSuffix}_${++neutralIdCounter}`
}

export function resetNeutralIdCounter(gameId?: string): void {
  neutralIdCounter = 0
  gameInstanceSuffix = gameId
    ? gameId.replace(/-/g, '_').slice(0, 8)
    : Math.random().toString(36).slice(2, 10)
}

/** Jungle camp zones */
const JUNGLE_ZONES = [
  'jungle-rad-top',
  'jungle-rad-bot',
  'jungle-dire-top',
  'jungle-dire-bot',
] as const

/** Spawn neutral creeps in jungle camps */
export function spawnNeutralCreeps(tick: number): NeutralCreepState[] {
  // Spawn at tick 60, then every 60 ticks
  if (tick === 0 || tick % NEUTRAL_CREEPS_INTERVAL_TICKS !== 0) return []

  const neutrals: NeutralCreepState[] = []

  for (const zone of JUNGLE_ZONES) {
    // Each camp gets 1-2 random neutrals
    const campSize = Math.random() < 0.5 ? 1 : 2

    for (let i = 0; i < campSize; i++) {
      // Random creep type (weighted towards smaller ones)
      const roll = Math.random()
      let creepType: NeutralCreepType

      if (roll < 0.4) {
        creepType = 'kobold'
      } else if (roll < 0.7) {
        creepType = 'ogre_mage'
      } else if (roll < 0.9) {
        creepType = 'centaur'
      } else if (roll < 0.95) {
        creepType = 'ancient_dragon'
      } else {
        creepType = 'ancient_rock_golem'
      }

      const stats = NEUTRAL_CREEPS[creepType]!

      neutrals.push({
        id: nextNeutralId(),
        zone,
        hp: stats.hp,
        maxHp: stats.hp,
        type: creepType,
        alive: true,
      })
    }
  }

  return neutrals
}

export interface NeutralAction {
  neutralId: string
  targetId: string // player ID
  damage: number
}

/**
 * Neutral creeps defend themselves - attack enemies in their zone
 */
export function runNeutralAI(state: GameState): NeutralAction[] {
  const actions: NeutralAction[] = []

  for (const neutral of state.neutrals ?? []) {
    if (!neutral.alive) continue

    // Find enemies in the same zone
    const enemies = Object.values(state.players).filter(
      (p) => p && p.zone === neutral.zone && p.alive,
    )

    if (enemies.length > 0) {
      // Attack a random enemy in range (always adjacent for neutrals)
      const target = enemies[Math.floor(Math.random() * enemies.length)]!
      const stats = NEUTRAL_CREEPS[neutral.type as NeutralCreepType]
      if (stats) {
        actions.push({
          neutralId: neutral.id,
          targetId: target.id,
          damage: stats.attack,
        })
      }
    }
  }

  return actions
}

/**
 * Apply neutral creep attacks to players
 */
export function applyNeutralActions(state: GameState, actions: NeutralAction[]): GameState {
  const players = { ...state.players }

  for (const action of actions) {
    const neutral = (state.neutrals ?? []).find((n) => n.id === action.neutralId)
    if (!neutral || !neutral.alive) continue

    const target = players[action.targetId]
    if (!target || !target.alive) continue
    // Physical immunity (Ghost/Ethereal/invulnerable) ignores neutral attacks.
    if (isDamageImmune(target, 'physical')) continue

    const newHp = Math.max(0, target.hp - action.damage)
    players[action.targetId] = {
      ...target,
      hp: newHp,
      alive: newHp > 0,
    }
  }

  return { ...state, players }
}

/**
 * Handle neutral creep deaths from hero attacks
 */
// (Removed `handleNeutralDeaths` — it was never called: it hardcoded an empty
// playerId and the real neutral-kill bounty is awarded inline in
// ActionResolver's neutral-attack path.)
