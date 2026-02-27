import type { CreepState, GameState, TowerState, PlayerState } from '~~/shared/types/game'
import {
  MELEE_CREEP_ATTACK,
  RANGED_CREEP_ATTACK,
  SIEGE_CREEP_ATTACK,
} from '~~/shared/constants/balance'

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
  action: 'move' | 'attack_creep' | 'attack_hero' | 'attack_tower'
  targetId?: string
  targetZone?: string
  damage?: number
}

/**
 * Run creep AI for all creeps. Returns a list of actions to apply.
 *
 * Creep behavior:
 * - If enemy creeps/heroes in same zone: attack (target closest)
 * - If enemy tower in zone: attack tower
 * - Otherwise: move toward enemy base along lane (1 zone per tick)
 */
export function runCreepAI(state: GameState): CreepAction[] {
  const actions: CreepAction[] = []

  for (const creep of state.creeps) {
    if (creep.hp <= 0) continue

    const damage = getCreepAttack(creep.type)

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

    // Priority 2: attack enemy heroes in same zone
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

    // Priority 3: attack enemy tower in same zone
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

    // Priority 4: move forward along lane
    const nextZone = getNextZone(creep)
    if (nextZone) {
      actions.push({
        creepId: creep.id,
        action: 'move',
        targetZone: nextZone,
      })
    }
  }

  return actions
}

/**
 * Apply creep actions to the game state. Returns updated state.
 */
export function applyCreepActions(state: GameState, actions: CreepAction[]): GameState {
  let creeps = [...state.creeps.map((c) => ({ ...c }))]
  const towers = [...state.towers.map((t) => ({ ...t }))]
  let players = { ...state.players }

  for (const action of actions) {
    const creep = creeps.find((c) => c.id === action.creepId)
    if (!creep || creep.hp <= 0) continue

    switch (action.action) {
      case 'move': {
        if (action.targetZone) {
          creep.zone = action.targetZone
        }
        break
      }
      case 'attack_creep': {
        const target = creeps.find((c) => c.id === action.targetId)
        if (target && target.hp > 0) {
          target.hp = Math.max(0, target.hp - (action.damage ?? 0))
        }
        break
      }
      case 'attack_hero': {
        if (action.targetId && players[action.targetId]) {
          const target = players[action.targetId]!
          const newHp = Math.max(0, target.hp - (action.damage ?? 0))
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
        const tower = towers.find((t) => t.zone === action.targetZone && t.alive)
        if (tower) {
          tower.hp = Math.max(0, tower.hp - (action.damage ?? 0))
          if (tower.hp === 0) {
            tower.alive = false
          }
        }
        break
      }
    }
  }

  // Remove dead creeps
  creeps = creeps.filter((c) => c.hp > 0)

  return { ...state, creeps, towers, players }
}
