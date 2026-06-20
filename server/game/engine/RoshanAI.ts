import type { GameState } from '~~/shared/types/game'
import type {
  GameEngineEvent,
  RoshanDamageEvent,
  RoshanRespawnEvent,
  RoshanKilledInternalEvent,
  AegisPickedEvent,
} from '~~/server/game/protocol/events'
import { ROSHAN_ATTACK, ROSHAN_AEGIS_TICKS, ROSHAN_GOLD } from '~~/shared/constants/balance'
import { shouldRoshanRespawn, respawnRoshan } from '~~/server/game/map/spawner'

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
    const target = enemyHeroes.reduce((lowest, hero) => (hero.hp < lowest.hp ? hero : lowest))
    actions.push({
      targetId: target.id,
      damage: ROSHAN_ATTACK,
    })
  }

  return actions
}

/**
 * Process Roshan damage from player attacks and check for death.
 * Returns updated state (with events kept OFF state.events — callers merge the
 * returned events array into the tick's allEvents) plus the events to emit.
 */
export function processRoshanDamage(
  state: GameState,
  damageDealt: Map<string, number>, // playerId -> damage
): { state: GameState; roshanKilled: boolean; aegisDropped: boolean; events: GameEngineEvent[] } {
  let roshan = { ...state.roshan }
  const events: GameEngineEvent[] = []
  let roshanKilled = false
  let aegisDropped = false

  // Only alive Roshan can take damage
  if (!roshan.alive) {
    // Check for respawn
    if (shouldRoshanRespawn(roshan, state.tick)) {
      roshan = respawnRoshan(roshan, state.tick)
      events.push({
        _tag: 'roshan_respawn',
        tick: state.tick,
        hp: roshan.hp,
        maxHp: roshan.maxHp,
      } satisfies RoshanRespawnEvent)
    }
    return {
      state: { ...state, roshan },
      roshanKilled: false,
      aegisDropped: false,
      events,
    }
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
      let remainingGold = ROSHAN_GOLD

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
        state: { ...state, players, roshan, aegis },
        roshanKilled: true,
        aegisDropped: true,
        events,
      }
    }
  }

  return {
    state: { ...state, roshan },
    roshanKilled,
    aegisDropped,
    events,
  }
}

/**
 * Handle aegis pickup by a player. Returns the updated state; the aegis_picked
 * event is returned separately so the caller (ActionResolver) can merge it into
 * the tick's allEvents instead of mutating state.events.
 */
export function pickupAegis(
  state: GameState,
  playerId: string,
): { state: GameState; event: GameEngineEvent | null } {
  const aegis = state.aegis
  if (!aegis) return { state, event: null }

  const player = state.players[playerId]
  if (!player || !player.alive) return { state, event: null }

  // Player must be in roshan-pit to pick up aegis
  if (player.zone !== 'roshan-pit') return { state, event: null }

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

  return {
    state: { ...state, players, aegis: null },
    event: { _tag: 'aegis_picked', tick: state.tick, playerId } satisfies AegisPickedEvent,
  }
}
