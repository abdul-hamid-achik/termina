import { Context, Effect, Layer } from 'effect'
import type { GameState, PlayerState, TeamId } from '~~/shared/types/game'
import { STARTING_GOLD } from '~~/shared/constants/balance'
import { HEROES } from '~~/shared/constants/heroes'
import { initializeZoneStates, initializeTowers } from '../map/zones'

// ── Error types ────────────────────────────────────────────────

export class GameNotFoundError {
  readonly _tag = 'GameNotFoundError'
  constructor(readonly gameId: string) {}
}

export class GameAlreadyExistsError {
  readonly _tag = 'GameAlreadyExistsError'
  constructor(readonly gameId: string) {}
}

// ── Player setup input ─────────────────────────────────────────

export interface PlayerSetup {
  id: string
  name: string
  team: TeamId
  heroId: string | null
}

// ── Service interface ──────────────────────────────────────────

export interface StateManagerApi {
  readonly createGame: (
    gameId: string,
    players: PlayerSetup[],
  ) => Effect.Effect<GameState, GameAlreadyExistsError>

  readonly getState: (gameId: string) => Effect.Effect<GameState, GameNotFoundError>

  readonly updateState: (
    gameId: string,
    fn: (s: GameState) => GameState,
  ) => Effect.Effect<GameState, GameNotFoundError>

  readonly deleteGame: (gameId: string) => Effect.Effect<void>

  readonly listGames: () => Effect.Effect<string[]>
}

export class StateManager extends Context.Tag('StateManager')<StateManager, StateManagerApi>() {}

// ── In-memory implementation ───────────────────────────────────

const games = new Map<string, GameState>()

/** Create initial player state from setup. */
function createPlayerState(setup: PlayerSetup): PlayerState {
  const hero = setup.heroId ? HEROES[setup.heroId] : null
  const baseHp = hero?.baseStats.hp ?? 0
  const baseMp = hero?.baseStats.mp ?? 0

  return {
    id: setup.id,
    name: setup.name,
    team: setup.team,
    heroId: setup.heroId,
    zone: setup.team === 'radiant' ? 'radiant-fountain' : 'dire-fountain',
    hp: baseHp,
    maxHp: baseHp,
    mp: baseMp,
    maxMp: baseMp,
    level: 1,
    xp: 0,
    gold: STARTING_GOLD,
    items: [null, null, null, null, null, null],
    defense: hero?.baseStats.defense ?? 0,
    magicResist: hero?.baseStats.magicResist ?? 0,
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnTick: null,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    towerDamageDealt: 0,
  }
}

/** Create a fresh game state. */
function createInitialGameState(gameId: string, players: PlayerSetup[]): GameState {
  const playerStates: Record<string, PlayerState> = {}
  for (const setup of players) {
    playerStates[setup.id] = createPlayerState(setup)
  }

  return {
    tick: 0,
    phase: 'picking',
    teams: {
      radiant: { id: 'radiant', kills: 0, towerKills: 0, gold: 0 },
      dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0 },
    },
    players: playerStates,
    zones: initializeZoneStates(),
    creeps: [],
    towers: initializeTowers(),
    events: [],
  }
}

export const StateManagerLive = Layer.succeed(StateManager, {
  createGame: (gameId, players) =>
    Effect.gen(function* () {
      if (games.has(gameId)) {
        return yield* Effect.fail(new GameAlreadyExistsError(gameId))
      }
      const state = createInitialGameState(gameId, players)
      games.set(gameId, state)
      return state
    }),

  getState: (gameId) =>
    Effect.gen(function* () {
      const state = games.get(gameId)
      if (!state) {
        return yield* Effect.fail(new GameNotFoundError(gameId))
      }
      return state
    }),

  updateState: (gameId, fn) =>
    Effect.gen(function* () {
      const current = games.get(gameId)
      if (!current) {
        return yield* Effect.fail(new GameNotFoundError(gameId))
      }
      const updated = fn(current)
      games.set(gameId, updated)
      return updated
    }),

  deleteGame: (gameId) =>
    Effect.sync(() => {
      games.delete(gameId)
    }),

  listGames: () =>
    Effect.sync(() => {
      return [...games.keys()]
    }),
})

/** Create a standalone in-memory StateManager (no Effect Layer needed). */
export function createInMemoryStateManager(): StateManagerApi {
  const localGames = new Map<string, GameState>()

  return {
    createGame: (gameId, players) =>
      Effect.gen(function* () {
        if (localGames.has(gameId)) {
          return yield* Effect.fail(new GameAlreadyExistsError(gameId))
        }
        const state = createInitialGameState(gameId, players)
        localGames.set(gameId, state)
        return state
      }),

    getState: (gameId) =>
      Effect.gen(function* () {
        const state = localGames.get(gameId)
        if (!state) {
          return yield* Effect.fail(new GameNotFoundError(gameId))
        }
        return state
      }),

    updateState: (gameId, fn) =>
      Effect.gen(function* () {
        const current = localGames.get(gameId)
        if (!current) {
          return yield* Effect.fail(new GameNotFoundError(gameId))
        }
        const updated = fn(current)
        localGames.set(gameId, updated)
        return updated
      }),

    deleteGame: (gameId) =>
      Effect.sync(() => {
        localGames.delete(gameId)
      }),

    listGames: () =>
      Effect.sync(() => {
        return [...localGames.keys()]
      }),
  }
}

/** Clear all games. Useful for tests. */
export function clearAllGames(): void {
  games.clear()
}
