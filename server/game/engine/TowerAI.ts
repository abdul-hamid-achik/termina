import type { GameState, TowerState, PlayerState, CreepState } from '~~/shared/types/game'
import { TOWER_ATTACK } from '~~/shared/constants/balance'

export interface TowerAction {
  towerZone: string
  targetType: 'hero' | 'creep'
  targetId: string
  damage: number
}

/**
 * Tower targeting priority each tick:
 * 1. Enemy hero attacking an allied hero in tower zone
 * 2. Closest enemy hero in zone
 * 3. Closest enemy creep in zone
 *
 * Tower damage: TOWER_ATTACK per tick.
 */
export function runTowerAI(
  state: GameState,
  heroAttackers?: Map<string, string>, // attackerId -> victimId mapping from this tick's actions
): TowerAction[] {
  const actions: TowerAction[] = []

  for (const tower of state.towers) {
    if (!tower.alive) continue

    const target = selectTowerTarget(state, tower, heroAttackers)
    if (target) {
      actions.push({
        towerZone: tower.zone,
        targetType: target.type,
        targetId: target.id,
        damage: TOWER_ATTACK,
      })
    }
  }

  return actions
}

interface TowerTarget {
  type: 'hero' | 'creep'
  id: string
}

function selectTowerTarget(
  state: GameState,
  tower: TowerState,
  heroAttackers?: Map<string, string>,
): TowerTarget | null {
  const zone = tower.zone
  const towerTeam = tower.team

  // Get enemy heroes in the tower's zone
  const enemyHeroes = Object.values(state.players).filter(
    (p) => p.zone === zone && p.team !== towerTeam && p.alive,
  )

  // Get enemy creeps in the tower's zone
  const enemyCreeps = state.creeps.filter(
    (c) => c.zone === zone && c.team !== towerTeam && c.hp > 0,
  )

  // Priority 1: Enemy hero attacking an allied hero in tower zone
  if (heroAttackers && enemyHeroes.length > 0) {
    const alliedHeroesInZone = Object.values(state.players).filter(
      (p) => p.zone === zone && p.team === towerTeam && p.alive,
    )
    const alliedIds = new Set(alliedHeroesInZone.map((p) => p.id))

    for (const hero of enemyHeroes) {
      const victimId = heroAttackers.get(hero.id)
      if (victimId && alliedIds.has(victimId)) {
        return { type: 'hero', id: hero.id }
      }
    }
  }

  // Priority 2: Closest enemy hero in zone
  if (enemyHeroes.length > 0) {
    return { type: 'hero', id: enemyHeroes[0]!.id }
  }

  // Priority 3: Closest enemy creep in zone
  if (enemyCreeps.length > 0) {
    return { type: 'creep', id: enemyCreeps[0]!.id }
  }

  return null
}

/**
 * Apply tower actions to the game state.
 */
export function applyTowerActions(state: GameState, actions: TowerAction[]): GameState {
  let creeps = [...state.creeps.map((c) => ({ ...c }))]
  let players = { ...state.players }

  for (const action of actions) {
    if (action.targetType === 'hero') {
      const target = players[action.targetId]
      if (target && target.alive) {
        const newHp = Math.max(0, target.hp - action.damage)
        players = {
          ...players,
          [action.targetId]: {
            ...target,
            hp: newHp,
            alive: newHp > 0,
          },
        }
      }
    } else {
      const target = creeps.find((c) => c.id === action.targetId)
      if (target && target.hp > 0) {
        target.hp = Math.max(0, target.hp - action.damage)
      }
    }
  }

  // Remove dead creeps
  creeps = creeps.filter((c) => c.hp > 0)

  return { ...state, creeps, players }
}
