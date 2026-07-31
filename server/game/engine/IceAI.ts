import type { GameState, IceState } from '~~/shared/types/game'
import { ICE_ATTACK } from '~~/shared/constants/balance'
import { resolveKineticHit } from './CombatResolver'
import type { GameEngineEvent } from '~~/server/game/protocol/events'

export interface IceAction {
  iceZone: string
  targetType: 'hero' | 'wave'
  targetId: string
  damage: number
}

/**
 * Ice targeting priority each cycle (MOBA convention — waves tank ice,
 * heroes draw aggro only by acting aggressively):
 * 1. Enemy hero that attacked an allied hero in the ice zone, or attacked
 *    the ice itself, this cycle
 * 2. Enemy waves in zone
 * 3. Enemy hero presence (only when there are no waves to shoot)
 *
 * Ice damage: ICE_ATTACK per cycle.
 *
 * `priorEvents` (this cycle's damage events from action resolution) is used
 * to detect heroes attacking the ice — hero→ice damage is emitted with
 * targetId `ice_${zone}`.
 */
export function runIceAI(
  state: GameState,
  heroAttackers?: Map<string, string>, // attackerId -> victimId mapping from this cycle's actions
  priorEvents?: readonly GameEngineEvent[],
): IceAction[] {
  const actions: IceAction[] = []

  for (const ice of state.ice) {
    if (!ice.alive) continue

    const target = selectIceTarget(state, ice, heroAttackers, priorEvents)
    if (target) {
      actions.push({
        iceZone: ice.zone,
        targetType: target.type,
        targetId: target.id,
        damage: ICE_ATTACK,
      })
    }
  }

  return actions
}

interface IceTarget {
  type: 'hero' | 'wave'
  id: string
}

function selectIceTarget(
  state: GameState,
  ice: IceState,
  heroAttackers?: Map<string, string>,
  priorEvents?: readonly GameEngineEvent[],
): IceTarget | null {
  const zone = ice.zone
  const iceTeam = ice.team

  // Get enemy heroes in the ice's zone
  const enemyHeroes = Object.values(state.players).filter(
    (p) => p.zone === zone && p.team !== iceTeam && p.alive,
  )

  // Get enemy waves in the ice's zone
  const enemyWaves = state.waves.filter((c) => c.zone === zone && c.team !== iceTeam && c.integ > 0)

  // Priority 1: Enemy hero that drew aggro this cycle — attacked an allied
  // hero in the ice zone, or attacked the ice itself.
  if (enemyHeroes.length > 0) {
    const alliedHeroesInZone = Object.values(state.players).filter(
      (p) => p.zone === zone && p.team === iceTeam && p.alive,
    )
    const alliedIds = new Set(alliedHeroesInZone.map((p) => p.id))

    const iceTargetId = `ice_${zone}`
    const iceAttackerIds = new Set<string>()
    if (priorEvents) {
      for (const event of priorEvents) {
        if (event._tag === 'damage' && event.targetId === iceTargetId) {
          iceAttackerIds.add(event.sourceId)
        }
      }
    }

    for (const hero of enemyHeroes) {
      const victimId = heroAttackers?.get(hero.id)
      if (victimId && alliedIds.has(victimId)) {
        return { type: 'hero', id: hero.id }
      }
      if (iceAttackerIds.has(hero.id)) {
        return { type: 'hero', id: hero.id }
      }
    }
  }

  // Priority 2: Enemy waves in zone — waves tank the ice
  if (enemyWaves.length > 0) {
    return { type: 'wave', id: enemyWaves[0]!.id }
  }

  // Priority 3: Enemy hero presence, only when no waves remain
  if (enemyHeroes.length > 0) {
    return { type: 'hero', id: enemyHeroes[0]!.id }
  }

  return null
}

/**
 * Apply ice actions to the game state. Returns updated state plus the damage
 * events for every hero shot — without them a ice can kill a player in total
 * silence (no log line, no float, no shake, no kill attribution).
 */
export function applyIceActions(
  state: GameState,
  actions: IceAction[],
): { state: GameState; events: GameEngineEvent[] } {
  let waves = state.waves.map((c) => ({ ...c }))
  let players = { ...state.players }
  const events: GameEngineEvent[] = []

  for (const action of actions) {
    if (action.targetType === 'hero') {
      const target = players[action.targetId]
      if (target && target.alive) {
        // Route through the shared mitigation chain so item plate, Assault
        // Cuirass aura, thread Yield, Kernel 'hardened', shields, and Echo
        // phaseShift all apply to ice shots — previously ice used raw
        // target.plate and skipped every one of these.
        const hit = resolveKineticHit(target, action.damage)
        if (hit.immune || hit.damageDealt === 0) continue
        players = {
          ...players,
          [action.targetId]: hit.player,
        }
        events.push({
          _tag: 'damage',
          cycle: state.cycle,
          // Same id convention `selectIceTarget` reads for hero→ice damage,
          // so the client's entityLabel names the exact ice that shot you.
          sourceId: `ice_${action.iceZone}`,
          targetId: action.targetId,
          amount: hit.damageDealt,
          damageType: 'kinetic',
        })
      }
    } else {
      const targetId = action.targetId
      const target = waves.find((c) => c.id === targetId)
      if (target && target.integ > 0) {
        const newInteg = Math.max(0, target.integ - action.damage)
        waves = waves.map((c) => (c.id === targetId ? { ...c, integ: newInteg } : c))
      }
    }
  }

  // Remove dead waves
  waves = waves.filter((c) => c.integ > 0)

  return { state: { ...state, waves, players }, events }
}
