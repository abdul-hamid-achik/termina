import type { CreepState, GameState, TeamId, TowerState, PlayerState } from '~~/shared/types/game'
import {
  MELEE_CREEP_ATTACK,
  RANGED_CREEP_ATTACK,
  SIEGE_CREEP_ATTACK,
  CREEP_BASE_IDLE_DESPAWN_TICKS,
  MAX_CREEPS_PER_ZONE_PER_TEAM,
} from '~~/shared/constants/balance'
import { calculatePhysicalDamage, isDamageImmune } from './DamageCalculator'
import { resolveAncientAttack } from './AncientSystem'
import type { GameEngineEvent } from '~~/server/game/protocol/events'

/** The enemy base zone for a creep team — the end of every lane route. */
const ENEMY_BASE: Record<TeamId, string> = {
  radiant: 'dire-base',
  dire: 'radiant-base',
}

/** Lane routes: ordered zone sequences from each base toward the enemy base. */
const LANE_ROUTES: Record<string, { radiant: string[]; dire: string[] }> = {
  top: {
    radiant: [
      'top-t3-rad',
      'top-t2-rad',
      'top-t1-rad',
      'top-river',
      'top-t1-dire',
      'top-t2-dire',
      'top-t3-dire',
      'dire-base',
    ],
    dire: [
      'top-t3-dire',
      'top-t2-dire',
      'top-t1-dire',
      'top-river',
      'top-t1-rad',
      'top-t2-rad',
      'top-t3-rad',
      'radiant-base',
    ],
  },
  mid: {
    radiant: [
      'mid-t3-rad',
      'mid-t2-rad',
      'mid-t1-rad',
      'mid-river',
      'mid-t1-dire',
      'mid-t2-dire',
      'mid-t3-dire',
      'dire-base',
    ],
    dire: [
      'mid-t3-dire',
      'mid-t2-dire',
      'mid-t1-dire',
      'mid-river',
      'mid-t1-rad',
      'mid-t2-rad',
      'mid-t3-rad',
      'radiant-base',
    ],
  },
  bot: {
    radiant: [
      'bot-t3-rad',
      'bot-t2-rad',
      'bot-t1-rad',
      'bot-river',
      'bot-t1-dire',
      'bot-t2-dire',
      'bot-t3-dire',
      'dire-base',
    ],
    dire: [
      'bot-t3-dire',
      'bot-t2-dire',
      'bot-t1-dire',
      'bot-river',
      'bot-t1-rad',
      'bot-t2-rad',
      'bot-t3-rad',
      'radiant-base',
    ],
  },
}

/** Get the attack damage for a creep type. */
function getCreepAttack(type: CreepState['type']): number {
  switch (type) {
    case 'melee':
      return MELEE_CREEP_ATTACK
    case 'ranged':
      return RANGED_CREEP_ATTACK
    case 'siege':
      return SIEGE_CREEP_ATTACK
  }
}

/** Determine which lane a creep is on based on its zone. */
function getCreepLane(zone: string): string | null {
  if (zone === 'radiant-base' || zone === 'dire-base' || zone.includes('fountain')) return null
  if (zone.startsWith('top-')) return 'top'
  if (zone.startsWith('mid-')) return 'mid'
  if (zone.startsWith('bot-')) return 'bot'
  return null
}

/** Get the next zone for a creep along its lane route. */
function getNextZone(creep: CreepState): string | null {
  const lane = getCreepLane(creep.zone)
  if (!lane) return null

  const route = LANE_ROUTES[lane]?.[creep.team]
  if (!route) return null

  const currentIndex = route.indexOf(creep.zone)
  if (currentIndex === -1 || currentIndex >= route.length - 1) return null

  return route[currentIndex + 1]!
}

/** Find enemy creeps in the same zone. */
function getEnemyCreepsInZone(creeps: CreepState[], creep: CreepState): CreepState[] {
  return creeps.filter((c) => c.zone === creep.zone && c.team !== creep.team && c.hp > 0)
}

/** Find enemy heroes in the same zone. */
function getEnemyHeroesInZone(
  players: Record<string, PlayerState>,
  zone: string,
  team: CreepState['team'],
): PlayerState[] {
  return Object.values(players).filter((p) => p.zone === zone && p.team !== team && p.alive)
}

/** Find enemy tower in the same zone. */
function getEnemyTowerInZone(
  towers: TowerState[],
  zone: string,
  team: CreepState['team'],
): TowerState | undefined {
  return towers.find((t) => t.zone === zone && t.team !== team && t.alive)
}

export interface CreepAction {
  creepId: string
  action:
    | 'move'
    | 'attack_creep'
    | 'attack_hero'
    | 'attack_tower'
    | 'attack_ancient'
    | 'wait_in_base'
    | 'despawn'
  targetId?: string
  targetZone?: string
  damage?: number
}

/**
 * Run creep AI for all creeps. Returns a list of actions to apply.
 *
 * Creep behavior:
 * - If enemy creeps in same zone: attack
 * - In the enemy base with a vulnerable Ancient: siege the Ancient
 *   (above heroes — the wave commits to the objective, which also keeps
 *   base creeps from grinding down every respawning hero)
 * - If enemy heroes in same zone: attack
 * - If enemy tower in zone: attack tower
 * - Otherwise: move toward enemy base along lane (1 zone per tick)
 * - Stuck in the enemy base with an invulnerable Ancient and nothing to
 *   attack: idle, then get garbage collected after
 *   CREEP_BASE_IDLE_DESPAWN_TICKS idle ticks
 */
export function runCreepAI(state: GameState): CreepAction[] {
  const actions: CreepAction[] = []

  for (const creep of state.creeps) {
    if (creep.hp <= 0) continue

    const damage = getCreepAttack(creep.type)
    const inEnemyBase = creep.zone === ENEMY_BASE[creep.team]
    const enemyAncient = creep.team === 'radiant' ? state.ancients?.dire : state.ancients?.radiant

    // Priority 1: attack enemy creeps in same zone
    const enemyCreeps = getEnemyCreepsInZone(state.creeps, creep)
    if (enemyCreeps.length > 0) {
      actions.push({
        creepId: creep.id,
        action: 'attack_creep',
        targetId: enemyCreeps[0]!.id,
        damage,
      })
      continue
    }

    // Priority 2 (enemy base only): siege the Ancient when it's vulnerable
    if (inEnemyBase && enemyAncient && enemyAncient.alive && enemyAncient.vulnerable) {
      actions.push({
        creepId: creep.id,
        action: 'attack_ancient',
        damage,
      })
      continue
    }

    // Priority 3: attack enemy heroes in same zone
    const enemyHeroes = getEnemyHeroesInZone(state.players, creep.zone, creep.team)
    if (enemyHeroes.length > 0) {
      actions.push({
        creepId: creep.id,
        action: 'attack_hero',
        targetId: enemyHeroes[0]!.id,
        damage,
      })
      continue
    }

    // Priority 4: attack enemy tower in same zone
    const enemyTower = getEnemyTowerInZone(state.towers, creep.zone, creep.team)
    if (enemyTower) {
      actions.push({
        creepId: creep.id,
        action: 'attack_tower',
        targetZone: enemyTower.zone,
        damage,
      })
      continue
    }

    // Priority 5: move forward along lane
    const nextZone = getNextZone(creep)
    if (nextZone) {
      actions.push({
        creepId: creep.id,
        action: 'move',
        targetZone: nextZone,
      })
      continue
    }

    // No move possible — creep is parked in a base zone with nothing to do.
    // Idle for a few ticks, then despawn ("garbage collected") so creeps
    // never pile up unboundedly in base.
    if (creep.zone === ENEMY_BASE[creep.team] || creep.zone === ENEMY_BASE[enemyTeam(creep.team)]) {
      if ((creep.baseIdleTicks ?? 0) + 1 >= CREEP_BASE_IDLE_DESPAWN_TICKS) {
        actions.push({ creepId: creep.id, action: 'despawn' })
      } else {
        actions.push({ creepId: creep.id, action: 'wait_in_base' })
      }
    }
  }

  return actions
}

function enemyTeam(team: TeamId): TeamId {
  return team === 'radiant' ? 'dire' : 'radiant'
}

/**
 * Apply creep actions to the game state. Returns updated state plus any
 * events to emit (Ancient damage / destruction).
 */
export function applyCreepActions(
  state: GameState,
  actions: CreepAction[],
): { state: GameState; events: GameEngineEvent[] } {
  let creeps = state.creeps.map((c) => ({ ...c }))
  let towers = state.towers.map((t) => ({ ...t }))
  let players = { ...state.players }
  let ancients = state.ancients
  const events: GameEngineEvent[] = []

  for (const action of actions) {
    const creep = creeps.find((c) => c.id === action.creepId)
    if (!creep || creep.hp <= 0) continue

    switch (action.action) {
      case 'move': {
        if (action.targetZone) {
          creeps = creeps.map((c) =>
            c.id === action.creepId ? { ...c, zone: action.targetZone! } : c,
          )
        }
        break
      }
      case 'attack_creep': {
        const target = creeps.find((c) => c.id === action.targetId)
        if (target && target.hp > 0) {
          const newHp = Math.max(0, target.hp - (action.damage ?? 0))
          creeps = creeps.map((c) => (c.id === action.targetId ? { ...c, hp: newHp } : c))
        }
        break
      }
      case 'attack_hero': {
        if (
          action.targetId &&
          players[action.targetId] &&
          !isDamageImmune(players[action.targetId]!, 'physical')
        ) {
          const target = players[action.targetId]!
          const rawDamage = action.damage ?? 0
          const damage = calculatePhysicalDamage(rawDamage, target.defense)
          const newHp = Math.max(0, target.hp - damage)
          players = {
            ...players,
            [action.targetId]: {
              ...target,
              hp: newHp,
              alive: newHp > 0,
            },
          }
        }
        break
      }
      case 'attack_tower': {
        const towerIdx = towers.findIndex((t) => t.zone === action.targetZone && t.alive)
        if (towerIdx >= 0) {
          const tower = towers[towerIdx]!
          const newHp = Math.max(0, tower.hp - (action.damage ?? 0))
          towers = towers.map((t, i) =>
            i === towerIdx ? { ...t, hp: newHp, alive: newHp > 0 } : t,
          )
        }
        break
      }
      case 'attack_ancient': {
        // Route through the shared helper so creep and hero attacks follow
        // identical vulnerability/destruction rules.
        const result = resolveAncientAttack(
          { ...state, creeps, ancients },
          action.creepId,
          action.damage ?? 0,
        )
        ancients = result.state.ancients
        events.push(...result.events)
        break
      }
      case 'wait_in_base': {
        creeps = creeps.map((c) =>
          c.id === action.creepId ? { ...c, baseIdleTicks: (c.baseIdleTicks ?? 0) + 1 } : c,
        )
        break
      }
      case 'despawn': {
        creeps = creeps.filter((c) => c.id !== action.creepId)
        break
      }
    }
  }

  // Remove dead creeps
  creeps = creeps.filter((c) => c.hp > 0)

  return { state: { ...state, creeps, towers, players, ancients }, events }
}

/**
 * Defensive guard: cap lane creeps at MAX_CREEPS_PER_ZONE_PER_TEAM per team
 * per zone, despawning the oldest first (creeps are appended in spawn order,
 * so earliest in the array = oldest). Returns the same object when no zone
 * is over the cap.
 */
export function enforceCreepZoneCap(state: GameState): GameState {
  const counts = new Map<string, number>()
  for (const creep of state.creeps) {
    const key = `${creep.team}:${creep.zone}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  let overCap = false
  for (const count of counts.values()) {
    if (count > MAX_CREEPS_PER_ZONE_PER_TEAM) {
      overCap = true
      break
    }
  }
  if (!overCap) return state

  // Walk newest → oldest keeping up to the cap per team+zone, then restore
  // original (spawn) order.
  const kept: CreepState[] = []
  const keptCounts = new Map<string, number>()
  for (let i = state.creeps.length - 1; i >= 0; i--) {
    const creep = state.creeps[i]!
    const key = `${creep.team}:${creep.zone}`
    const keptSoFar = keptCounts.get(key) ?? 0
    if (keptSoFar < MAX_CREEPS_PER_ZONE_PER_TEAM) {
      kept.push(creep)
      keptCounts.set(key, keptSoFar + 1)
    }
  }
  kept.reverse()

  return { ...state, creeps: kept }
}
