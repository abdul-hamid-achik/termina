import type { GameState, TowerState } from '~~/shared/types/game'
import { TOWER_ATTACK } from '~~/shared/constants/balance'
import { resolvePhysicalHit } from './CombatResolver'
import type { GameEngineEvent } from '~~/server/game/protocol/events'

export interface TowerAction {
  towerZone: string
  targetType: 'hero' | 'creep'
  targetId: string
  damage: number
}

/**
 * Tower targeting priority each tick (MOBA convention — creeps tank towers,
 * heroes draw aggro only by acting aggressively):
 * 1. Enemy hero that attacked an allied hero in the tower zone, or attacked
 *    the tower itself, this tick
 * 2. Enemy creeps in zone
 * 3. Enemy hero presence (only when there are no creeps to shoot)
 *
 * Tower damage: TOWER_ATTACK per tick.
 *
 * `priorEvents` (this tick's damage events from action resolution) is used
 * to detect heroes attacking the tower — hero→tower damage is emitted with
 * targetId `tower_${zone}`.
 */
export function runTowerAI(
  state: GameState,
  heroAttackers?: Map<string, string>, // attackerId -> victimId mapping from this tick's actions
  priorEvents?: readonly GameEngineEvent[],
): TowerAction[] {
  const actions: TowerAction[] = []

  for (const tower of state.towers) {
    if (!tower.alive) continue

    const target = selectTowerTarget(state, tower, heroAttackers, priorEvents)
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
  priorEvents?: readonly GameEngineEvent[],
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

  // Priority 1: Enemy hero that drew aggro this tick — attacked an allied
  // hero in the tower zone, or attacked the tower itself.
  if (enemyHeroes.length > 0) {
    const alliedHeroesInZone = Object.values(state.players).filter(
      (p) => p.zone === zone && p.team === towerTeam && p.alive,
    )
    const alliedIds = new Set(alliedHeroesInZone.map((p) => p.id))

    const towerTargetId = `tower_${zone}`
    const towerAttackerIds = new Set<string>()
    if (priorEvents) {
      for (const event of priorEvents) {
        if (event._tag === 'damage' && event.targetId === towerTargetId) {
          towerAttackerIds.add(event.sourceId)
        }
      }
    }

    for (const hero of enemyHeroes) {
      const victimId = heroAttackers?.get(hero.id)
      if (victimId && alliedIds.has(victimId)) {
        return { type: 'hero', id: hero.id }
      }
      if (towerAttackerIds.has(hero.id)) {
        return { type: 'hero', id: hero.id }
      }
    }
  }

  // Priority 2: Enemy creeps in zone — creeps tank the tower
  if (enemyCreeps.length > 0) {
    return { type: 'creep', id: enemyCreeps[0]!.id }
  }

  // Priority 3: Enemy hero presence, only when no creeps remain
  if (enemyHeroes.length > 0) {
    return { type: 'hero', id: enemyHeroes[0]!.id }
  }

  return null
}

/**
 * Apply tower actions to the game state.
 */
export function applyTowerActions(state: GameState, actions: TowerAction[]): GameState {
  let creeps = state.creeps.map((c) => ({ ...c }))
  let players = { ...state.players }

  for (const action of actions) {
    if (action.targetType === 'hero') {
      const target = players[action.targetId]
      if (target && target.alive) {
        // Route through the shared mitigation chain so item defense, Assault
        // Cuirass aura, thread Yield, Kernel 'hardened', shields, and Echo
        // phaseShift all apply to tower shots — previously towers used raw
        // target.defense and skipped every one of these.
        const hit = resolvePhysicalHit(target, action.damage)
        if (hit.immune || hit.damageDealt === 0) continue
        players = {
          ...players,
          [action.targetId]: hit.player,
        }
      }
    } else {
      const targetId = action.targetId
      const target = creeps.find((c) => c.id === targetId)
      if (target && target.hp > 0) {
        const newHp = Math.max(0, target.hp - action.damage)
        creeps = creeps.map((c) => (c.id === targetId ? { ...c, hp: newHp } : c))
      }
    }
  }

  // Remove dead creeps
  creeps = creeps.filter((c) => c.hp > 0)

  return { ...state, creeps, players }
}
