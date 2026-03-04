import type { GameState } from '~~/shared/types/game'
import type { GameEngineEvent, RoshanDamageEvent, RoshanRespawnEvent, RoshanKilledInternalEvent, AegisPickedEvent } from '../protocol/events'
import {
  ROSHAN_ATTACK,
  ROSHAN_AEGIS_TICKS,
} from '~~/shared/constants/balance'
import { shouldRoshanRespawn, respawnRoshan } from '../map/spawner'

export interface RoshanAction {
  targetId: string
  damage: number
}

/**
 * Roshan AI: attacks heroes in roshan-pit, handles death/respawn.
 */
export function runRoshanAI(state: GameState): RoshanAction[] {
  const actions: RoshanAction[] = []
  const roshan = state.roshan

  // Roshan does nothing if dead or doesn't exist
  if (!roshan || !roshan.alive) return actions

  // Find enemy heroes in roshan-pit (same zone)
  const enemyHeroes = Object.values(state.players).filter(
    (p) => p && p.zone === 'roshan-pit' && p.alive,
  )

  // Attack the lowest HP enemy hero in range
  if (enemyHeroes.length > 0) {
    const target = enemyHeroes.reduce((lowest, hero) =>
      hero.hp < lowest.hp ? hero : lowest,
    )
    actions.push({
      targetId: target.id,
      damage: ROSHAN_ATTACK,
    })
  }

  return actions
}

/**
 * Apply Roshan attack actions to game state.
 */
export function applyRoshanActions(
  state: GameState,
  actions: RoshanAction[],
): { state: GameState; roshanKilled: boolean; aegisDropped: boolean } {
  const roshanKilled = false
  const aegisDropped = false
  const roshan = { ...state.roshan }

  const players = { ...state.players }

  for (const action of actions) {
    const target = players[action.targetId]
    if (!target || !target.alive) continue

    const newHp = Math.max(0, target.hp - action.damage)
    players[action.targetId] = {
      ...target,
      hp: newHp,
      alive: newHp > 0,
    }
  }

  // Check for Roshan death from hero attacks this tick
  // We need to check if Roshan took damage from events
  const _roshanDamageEvents = state.events.filter(
    (e) => e.type === 'roshan_damage' || (e.payload && e.payload['targetId'] === 'roshan'),
  )

  // Apply Roshan HP changes - we'll track this via events in the game loop
  // For now, we'll handle Roshan death separately in the game loop

  return {
    state: { ...state, players, roshan },
    roshanKilled,
    aegisDropped,
  }
}

/**
 * Process Roshan damage from player attacks and check for death.
 * Returns updated state with Roshan death handling if applicable.
 */
export function processRoshanDamage(
  state: GameState,
  damageDealt: Map<string, number>, // playerId -> damage
): { state: GameState; roshanKilled: boolean; aegisDropped: boolean; events: GameEngineEvent[] } {
  let roshan = { ...state.roshan }
  const events: GameEngineEvent[] = state.events.map(e => e as unknown as GameEngineEvent)
  let roshanKilled = false
  let aegisDropped = false

  // Only alive Roshan can take damage
  if (!roshan.alive) {
    // Check for respawn
    if (shouldRoshanRespawn(roshan, state.tick)) {
      roshan = respawnRoshan(roshan)
      events.push({
        _tag: 'roshan_respawn',
        tick: state.tick,
        hp: roshan.hp,
        maxHp: roshan.maxHp,
      } satisfies RoshanRespawnEvent)
    }
    return { state: { ...state, roshan, events: [...events] as unknown as GameEvent[] }, roshanKilled: false, aegisDropped: false, events }
  }

  // Calculate total damage to Roshan this tick
  let totalDamage = 0
  for (const [, damage] of damageDealt) {
    totalDamage += damage
  }

  if (totalDamage > 0) {
    const newHp = Math.max(0, roshan.hp - totalDamage)
    roshan = { ...roshan, hp: newHp }

    events.push({
      _tag: 'roshan_damage',
      tick: state.tick,
      damage: totalDamage,
      hp: newHp,
      maxHp: roshan.maxHp,
    } satisfies RoshanDamageEvent)

    // Roshan died
    if (newHp <= 0) {
      roshanKilled = true
      aegisDropped = true

      // Update Roshan state to dead
      roshan = {
        alive: false,
        hp: 0,
        maxHp: roshan.maxHp,
        deathTick: state.tick,
      }

      // Drop aegis in roshan-pit
      const aegis = {
        zone: 'roshan-pit',
        tick: state.tick,
        holderId: null as string | null,
      }

      // Award gold to damaging players (distributed by damage dealt)
      const totalDmg = Array.from(damageDealt.values()).reduce((a, b) => a + b, 0)
      const players = { ...state.players }
      let remainingGold = 600 // ROSHAN_GOLD

      for (const [playerId, damage] of damageDealt) {
        const share = Math.floor((damage / totalDmg) * remainingGold)
        const player = players[playerId]
        if (player) {
          players[playerId] = { ...player, gold: player.gold + share }
          remainingGold -= share
        }
      }

      // Give remaining gold to lowest HP damage dealer
      if (remainingGold > 0) {
        let lowestDmgDealer = ''
        let lowestHp = Infinity
        for (const [playerId, damage] of damageDealt) {
          if (damage > 0) {
            const player = players[playerId]
            if (player && player.hp < lowestHp) {
              lowestHp = player.hp
              lowestDmgDealer = playerId
            }
          }
        }
        if (lowestDmgDealer) {
          const player = players[lowestDmgDealer]!
          players[lowestDmgDealer] = { ...player, gold: player.gold + remainingGold }
        }
      }

      events.push({
        _tag: 'roshan_killed',
        tick: state.tick,
      } satisfies RoshanKilledInternalEvent)

      return {
        state: { ...state, players, roshan, aegis, events: events as unknown as GameEvent[] },
        roshanKilled: true,
        aegisDropped: true,
        events,
      }
    }
  }

  return { state: { ...state, roshan, events: events as unknown as GameEvent[] }, roshanKilled, aegisDropped, events }
}

/**
 * Handle aegis pickup by a player.
 */
export function pickupAegis(state: GameState, playerId: string): GameState {
  const aegis = state.aegis
  if (!aegis) return state

  const player = state.players[playerId]
  if (!player || !player.alive) return state

  // Player must be in roshan-pit to pick up aegis
  if (player.zone !== 'roshan-pit') return state

  // Add aegis buff to player (respawn speed)
  const aegisBuff = {
    id: 'aegis',
    stacks: ROSHAN_AEGIS_TICKS,
    ticksRemaining: ROSHAN_AEGIS_TICKS,
    source: 'roshan',
  }

  const players = {
    ...state.players,
    [playerId]: {
      ...player,
      buffs: [...player.buffs, aegisBuff],
    },
  }

  // Remove aegis from the ground
  const newAegis = null

  const events = [...state.events.map(e => e as unknown as GameEngineEvent), {
    _tag: 'aegis_picked',
    tick: state.tick,
    playerId,
  } satisfies AegisPickedEvent]

  return { ...state, players, aegis: newAegis, events: events as unknown as typeof state.events }
}
