import { Context, Effect, Layer, Queue, Ref, Schedule, Fiber } from 'effect'
import type { GameState, PlayerState, TeamId } from '~~/shared/types/game'
import type { Command } from '~~/shared/types/commands'
import {
  TICK_DURATION_MS,
  RESPAWN_BASE_TICKS,
  RESPAWN_PER_LEVEL_TICKS,
  FOUNTAIN_HEAL_PER_TICK_PERCENT,
  FOUNTAIN_MANA_PER_TICK_PERCENT,
  XP_PER_LEVEL,
  MAX_LEVEL,
} from '~~/shared/constants/balance'
import { StateManager, type StateManagerApi } from './StateManager'
import { resolveActions, validateAction, type PlayerAction } from './ActionResolver'
import { distributePassiveGold } from './GoldDistributor'
import { runCreepAI, applyCreepActions } from './CreepAI'
import { runTowerAI, applyTowerActions } from './TowerAI'
import { spawnCreepWaves, spawnRunes } from '../map/spawner'
import { removeExpiredWards } from '../map/zones'
import { calculateVision, filterStateForPlayer } from './VisionCalculator'
import { toGameEvent, type GameEngineEvent } from '../protocol/events'

// ── Action queue per game ──────────────────────────────────────

/** Pending actions collected during the action window. */
const gameActionQueues = new Map<string, PlayerAction[]>()

/** Submit an action for the current tick. */
export function submitAction(gameId: string, playerId: string, command: Command): void {
  let queue = gameActionQueues.get(gameId)
  if (!queue) {
    queue = []
    gameActionQueues.set(gameId, queue)
  }
  // Only one action per player per tick
  const existing = queue.findIndex((a) => a.playerId === playerId)
  if (existing >= 0) {
    queue[existing] = { playerId, command }
  } else {
    queue.push({ playerId, command })
  }
}

/** Drain all queued actions for a game. */
function drainActions(gameId: string): PlayerAction[] {
  const queue = gameActionQueues.get(gameId) ?? []
  gameActionQueues.set(gameId, [])
  return queue
}

// ── Tick processing ────────────────────────────────────────────

/**
 * Process a single game tick.
 * This is the core of the game loop extracted as a pure function for testability.
 */
export function processTick(
  gameId: string,
  state: GameState,
): Effect.Effect<{ state: GameState; events: GameEngineEvent[] }> {
  return Effect.gen(function* () {
    let currentState = { ...state, tick: state.tick + 1, events: [] }
    const allEvents: GameEngineEvent[] = []

    // 1. Collect all player actions from queue
    const actions = drainActions(gameId)

    // 2. Validate actions against current state
    const validActions = actions.filter((a) => validateAction(currentState, a) === null)

    // 3. Resolve actions via ActionResolver
    const resolved = yield* resolveActions(currentState, validActions)
    currentState = resolved.state
    allEvents.push(...resolved.events)

    // 4. Run CreepAI
    const creepActions = runCreepAI(currentState)
    currentState = applyCreepActions(currentState, creepActions)

    // 5. Run TowerAI
    const towerActions = runTowerAI(currentState, resolved.heroAttackers)
    currentState = applyTowerActions(currentState, towerActions)

    // 6. Spawn creep waves
    const newCreeps = spawnCreepWaves(currentState.tick)
    if (newCreeps.length > 0) {
      currentState = { ...currentState, creeps: [...currentState.creeps, ...newCreeps] }
    }

    // 7. Remove expired wards
    removeExpiredWards(currentState.zones, currentState.tick)

    // 8. Distribute passive gold
    currentState = distributePassiveGold(currentState)

    // 9. Handle respawns
    currentState = handleRespawns(currentState)

    // 10. Fountain healing
    currentState = applyFountainHealing(currentState)

    // 11. Handle deaths — check for newly dead players
    currentState = handleDeaths(currentState, allEvents)

    // 12. Check level ups
    currentState = checkLevelUps(currentState, allEvents)

    // 13. Check win condition
    const winner = checkWinCondition(currentState)
    if (winner) {
      currentState = { ...currentState, phase: 'ended' }
      allEvents.push({
        _tag: 'gold_change',
        tick: currentState.tick,
        playerId: '',
        amount: 0,
        reason: `game_over:${winner}`,
      })
    }

    // 14. Store events on state
    currentState = {
      ...currentState,
      events: allEvents.map(toGameEvent),
    }

    return { state: currentState, events: allEvents }
  })
}

// ── Game lifecycle ─────────────────────────────────────────────

export interface GameCallbacks {
  onTickState: (gameId: string, playerId: string, state: ReturnType<typeof filterStateForPlayer>) => void
  onEvents: (gameId: string, events: GameEngineEvent[]) => void
  onGameOver: (gameId: string, winner: TeamId) => void
}

/** Active game fibers, keyed by gameId. */
const activeGames = new Map<string, Fiber.RuntimeFiber<void, never>>()

/**
 * Start the game loop for a given game.
 * Returns an Effect that runs the tick loop as a fiber.
 */
export function startGameLoop(
  gameId: string,
  stateManager: StateManagerApi,
  callbacks: GameCallbacks,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const state = yield* stateManager.getState(gameId)
    if (state.phase === 'ended') return

    // Set phase to playing
    yield* stateManager.updateState(gameId, (s) => ({ ...s, phase: 'playing' as const }))

    // Run the tick loop
    const tickLoop = Effect.gen(function* () {
      const currentState = yield* stateManager.getState(gameId)
      if (currentState.phase === 'ended') return

      const { state: newState, events } = yield* processTick(gameId, currentState)
      yield* stateManager.updateState(gameId, () => newState)

      // Broadcast filtered state to each player
      for (const playerId of Object.keys(newState.players)) {
        const visibleState = filterStateForPlayer(newState, playerId)
        callbacks.onTickState(gameId, playerId, visibleState)
      }

      if (events.length > 0) {
        callbacks.onEvents(gameId, events)
      }

      // Check win
      const winner = checkWinCondition(newState)
      if (winner) {
        callbacks.onGameOver(gameId, winner)
      }
    })

    // Repeat on fixed schedule
    const repeated = Effect.repeat(
      tickLoop,
      Schedule.fixed(`${TICK_DURATION_MS} millis`),
    )

    yield* Effect.catchAll(repeated, (error) =>
      Effect.sync(() => {
        console.error(`[GameLoop] Error in game ${gameId}:`, error)
      }),
    )
  })
}

/** Stop a running game loop. */
export function stopGameLoop(gameId: string): Effect.Effect<void> {
  return Effect.sync(() => {
    const fiber = activeGames.get(gameId)
    if (fiber) {
      activeGames.delete(gameId)
    }
  })
}

// ── Helper functions ───────────────────────────────────────────

/** Handle player respawns: set alive if respawnTick has been reached. */
function handleRespawns(state: GameState): GameState {
  const players = { ...state.players }
  let changed = false

  for (const [pid, player] of Object.entries(players)) {
    if (!player.alive && player.respawnTick !== null && state.tick >= player.respawnTick) {
      const spawnZone = player.team === 'radiant' ? 'radiant-fountain' : 'dire-fountain'
      players[pid] = {
        ...player,
        alive: true,
        hp: player.maxHp,
        mp: player.maxMp,
        zone: spawnZone,
        respawnTick: null,
      }
      changed = true
    }
  }

  return changed ? { ...state, players } : state
}

/** Apply fountain healing to heroes standing in their fountain. */
function applyFountainHealing(state: GameState): GameState {
  const players = { ...state.players }
  let changed = false

  for (const [pid, player] of Object.entries(players)) {
    if (!player.alive) continue

    const isInFountain =
      (player.team === 'radiant' && player.zone === 'radiant-fountain') ||
      (player.team === 'dire' && player.zone === 'dire-fountain')

    if (isInFountain) {
      const hpHeal = Math.floor(player.maxHp * FOUNTAIN_HEAL_PER_TICK_PERCENT / 100)
      const mpHeal = Math.floor(player.maxMp * FOUNTAIN_MANA_PER_TICK_PERCENT / 100)
      players[pid] = {
        ...player,
        hp: Math.min(player.maxHp, player.hp + hpHeal),
        mp: Math.min(player.maxMp, player.mp + mpHeal),
      }
      changed = true
    }
  }

  return changed ? { ...state, players } : state
}

/** Handle newly dead players — set respawn timers. */
function handleDeaths(state: GameState, events: GameEngineEvent[]): GameState {
  const players = { ...state.players }
  let changed = false

  for (const [pid, player] of Object.entries(players)) {
    if (!player.alive && player.respawnTick === null) {
      const respawnTicks = RESPAWN_BASE_TICKS + RESPAWN_PER_LEVEL_TICKS * player.level
      players[pid] = {
        ...player,
        respawnTick: state.tick + respawnTicks,
        deaths: player.deaths + 1,
      }
      events.push({
        _tag: 'death',
        tick: state.tick,
        playerId: pid,
        respawnTick: state.tick + respawnTicks,
      })
      changed = true
    }
  }

  return changed ? { ...state, players } : state
}

/** Check XP thresholds and level up players. */
function checkLevelUps(state: GameState, events: GameEngineEvent[]): GameState {
  const players = { ...state.players }
  let changed = false

  for (const [pid, player] of Object.entries(players)) {
    if (player.level >= MAX_LEVEL) continue

    const nextLevelXp = XP_PER_LEVEL[player.level + 1]
    if (nextLevelXp !== undefined && player.xp >= nextLevelXp) {
      players[pid] = {
        ...player,
        level: player.level + 1,
      }
      events.push({
        _tag: 'level_up',
        tick: state.tick,
        playerId: pid,
        newLevel: player.level + 1,
      })
      changed = true
    }
  }

  return changed ? { ...state, players } : state
}

/**
 * Check if either team's base is destroyed (all 3 T3 towers + base under attack).
 * Simplified: a team wins when all 9 enemy towers are destroyed.
 */
function checkWinCondition(state: GameState): TeamId | null {
  const radiantTowersAlive = state.towers.filter((t) => t.team === 'radiant' && t.alive).length
  const direTowersAlive = state.towers.filter((t) => t.team === 'dire' && t.alive).length

  if (radiantTowersAlive === 0) return 'dire'
  if (direTowersAlive === 0) return 'radiant'

  return null
}
