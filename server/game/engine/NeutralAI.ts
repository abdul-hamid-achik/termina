import type { GameState, NeutralCreepState } from '~~/shared/types/game'
import {
  NEUTRAL_CREEPS,
  NEUTRAL_CREEPS_INTERVAL_TICKS,
  MAX_NEUTRALS_PER_CAMP,
  type NeutralCreepType,
} from '~~/shared/constants/balance'
import { resolvePhysicalHit } from './CombatResolver'

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

/** Spawn neutral creeps in jungle camps. `hasZone` skips camps a subset map
 *  doesn't have (one-lane has no jungle). `existingNeutrals` is used to enforce
 *  MAX_NEUTRALS_PER_CAMP — camps at cap are skipped (no new spawns). */
export function spawnNeutralCreeps(
  tick: number,
  hasZone?: (zoneId: string) => boolean,
  existingNeutrals: NeutralCreepState[] = [],
): NeutralCreepState[] {
  // Spawn at tick 60, then every 60 ticks
  if (tick === 0 || tick % NEUTRAL_CREEPS_INTERVAL_TICKS !== 0) return []

  // Count live neutrals per zone to enforce the cap
  const liveCountByZone = new Map<string, number>()
  for (const n of existingNeutrals) {
    if (n.alive) liveCountByZone.set(n.zone, (liveCountByZone.get(n.zone) ?? 0) + 1)
  }

  const neutrals: NeutralCreepState[] = []

  for (const zone of JUNGLE_ZONES) {
    if (hasZone && !hasZone(zone)) continue
    // Skip camps already at cap — prevents unbounded accumulation
    const currentCount = liveCountByZone.get(zone) ?? 0
    if (currentCount >= MAX_NEUTRALS_PER_CAMP) continue

    // Each camp gets 1-2 random neutrals, but respect the cap
    const campSize = Math.min(Math.random() < 0.5 ? 1 : 2, MAX_NEUTRALS_PER_CAMP - currentCount)
    if (campSize <= 0) continue

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

    // Route through resolvePhysicalHit for the full mitigation chain — same as
    // towers, creeps, and Roshan. Previously this did raw `hp - damage` with only
    // an immunity check, bypassing armor items, shields, hardened reduction,
    // vulnerability amplifiers, and phase shift dodge.
    const hit = resolvePhysicalHit(target, action.damage)
    if (hit.immune || hit.dodged) continue

    players[action.targetId] = hit.player
  }

  return { ...state, players }
}

/**
 * Handle neutral creep deaths from hero attacks
 */
// (Removed `handleNeutralDeaths` — it was never called: it hardcoded an empty
// playerId and the real neutral-kill bounty is awarded inline in
// ActionResolver's neutral-attack path.)
