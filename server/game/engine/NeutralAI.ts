import type { GameState, NeutralCreepState } from '~~/shared/types/game'
import {
  NEUTRAL_CREEPS,
  NEUTRAL_CREEPS_INTERVAL_TICKS,
  type NeutralCreepType,
} from '~~/shared/constants/balance'

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
export function handleNeutralDeaths(
  state: GameState,
  damageTracker: Map<string, number>, // neutralId -> damage
): {
  state: GameState
  events: GameState['events']
  rewards: Array<{ playerId: string; gold: number; xp: number }>
} {
  const events = [...state.events]
  const rewards: Array<{ playerId: string; gold: number; xp: number }> = []

  let neutrals = [...state.neutrals]

  for (const [neutralId, damage] of damageTracker) {
    const neutralIdx = neutrals.findIndex((n) => n.id === neutralId)
    if (neutralIdx === -1) continue

    const neutral = neutrals[neutralIdx]!
    const stats = NEUTRAL_CREEPS[neutral.type as NeutralCreepType]
    if (!stats) continue

    // Check if neutral died
    if (neutral.hp <= damage) {
      // Neutral died - award gold and XP to damaging player
      // Find the player who dealt the most damage
      const _killerDamage = damage // Simplified - full damage dealt to killer

      // Award to all players who damaged (simplified: just one reward for now)
      // In a full impl, distribute by damage share
      rewards.push({
        playerId: '', // Will be determined by caller
        gold: stats.gold,
        xp: stats.xp,
      })

      // Remove neutral
      neutrals = neutrals.filter((_, i) => i !== neutralIdx)
    } else {
      // Update HP
      neutrals[neutralIdx] = { ...neutral, hp: neutral.hp - damage }
    }
  }

  return { state: { ...state, neutrals }, events, rewards }
}
