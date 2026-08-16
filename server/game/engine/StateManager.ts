import { Effect } from 'effect'
import type { GameState, GameMode, PlayerState, TeamId } from '~~/shared/types/game'
import { STARTING_SCRIP } from '~~/shared/constants/balance'
import { HEROES } from '~~/shared/constants/heroes'
import { initializeZoneStates, initializeIce } from '~~/server/game/map/zones'
import { initializeTenant } from '~~/server/game/map/spawner'
import { initializeTerminals } from './TerminalSystem'
import { zonesForMap, DEFAULT_MAP_ID } from '~~/shared/constants/maps'

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
  guildTag?: string
}

// ── Service interface ──────────────────────────────────────────

/** Creation-time options for a game (map + mode). Both default sensibly:
 *  full 5v5 map, normal mode. */
export interface GameOptions {
  mapId?: string
  mode?: GameMode
}

export interface StateManagerApi {
  readonly createGame: (
    gameId: string,
    players: PlayerSetup[],
    options?: GameOptions,
  ) => Effect.Effect<GameState, GameAlreadyExistsError>

  /**
   * Load an existing GameState directly (e.g. from a snapshot). Overwrites
   * any existing state for the same gameId. Used by the resume path on boot.
   */
  readonly loadGame: (gameId: string, state: GameState) => Effect.Effect<GameState>

  readonly getState: (gameId: string) => Effect.Effect<GameState, GameNotFoundError>

  readonly updateState: (
    gameId: string,
    fn: (s: GameState) => GameState,
  ) => Effect.Effect<GameState, GameNotFoundError>

  readonly deleteGame: (gameId: string) => Effect.Effect<void>

  readonly listGames: () => Effect.Effect<string[]>
}

/** Create initial player state from setup. */
function createPlayerState(setup: PlayerSetup): PlayerState {
  const hero = setup.heroId ? HEROES[setup.heroId] : null
  const baseHp = hero?.baseStats.integ ?? 0
  const baseMp = hero?.baseStats.bw ?? 0

  return {
    id: setup.id,
    name: setup.name,
    guildTag: setup.guildTag,
    team: setup.team,
    heroId: setup.heroId,
    zone: setup.team === 'chaff' ? 'rookery-anchor' : 'landing-anchor',
    integ: baseHp,
    maxInteg: baseHp,
    bw: baseMp,
    maxBw: baseMp,
    level: 1,
    xp: 0,
    scrip: STARTING_SCRIP,
    items: [null, null, null, null, null, null],
    plate: hero?.baseStats.plate ?? 0,
    ice: hero?.baseStats.ice ?? 0,
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnCycle: null,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    iceDamageDealt: 0,
    killStreak: 0,
    lastHits: 0,
    burns: 0,
    buybackCost: 0, // Will be calculated on death
    buybackCooldown: undefined,
    talents: {
      tier10: null,
      tier15: null,
      tier20: null,
      tier25: null,
    },
  }
}

/** Create a fresh game state. */
function createInitialGameState(
  gameId: string,
  players: PlayerSetup[],
  mapId: string = DEFAULT_MAP_ID,
  mode: GameMode = 'normal',
): GameState {
  const playerStates: Record<string, PlayerState> = {}
  for (const setup of players) {
    playerStates[setup.id] = createPlayerState(setup)
  }

  // A map's zone set drives which zones + ice exist; everything else (ice
  // tiers, wave lanes, win condition) derives from the reused zone IDs.
  const zones = zonesForMap(mapId)

  return {
    cycle: 0,
    phase: 'picking',
    teams: {
      chaff: { id: 'chaff', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
      audit: { id: 'audit', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
    },
    players: playerStates,
    zones: initializeZoneStates(zones),
    waves: [],
    neutrals: [],
    ice: initializeIce(zones),
    terminals: initializeTerminals(),
    caches: [],
    tenant: initializeTenant(),
    backup: null,
    events: [],
    surrenderVotes: { chaff: new Set(), audit: new Set() },
    timeOfDay: 'day',
    dayNightCycle: 0,
    mapId,
    mode,
    // The tutorial starts at step 0 (gating + first hint); normal games omit it.
    tutorialStep: mode === 'tutorial' ? 0 : undefined,
    // Stamp the step-0 deadline clock so a player who can never satisfy step 0
    // still gets moved along (see advanceTutorialAfterTick).
    tutorialStepSince: mode === 'tutorial' ? 0 : undefined,
    // Set ONCE here — never mutated again. Rides in the state so snapshots and
    // resume carry it automatically; GameLoop's processCycle derives each
    // tick's deterministic rng from it (see server/game/engine/rng.ts). This is
    // the one allowlisted Math.random call in the resolution path: it's the
    // seed itself, not a resolution outcome.
    rngSeed: Math.floor(Math.random() * 2 ** 31),
  }
}

/** Create a standalone in-memory StateManager. */
export function createInMemoryStateManager(): StateManagerApi {
  const localGames = new Map<string, GameState>()

  return {
    createGame: (gameId, players, options) =>
      Effect.gen(function* () {
        if (localGames.has(gameId)) {
          return yield* Effect.fail(new GameAlreadyExistsError(gameId))
        }
        const state = createInitialGameState(gameId, players, options?.mapId, options?.mode)
        localGames.set(gameId, state)
        return state
      }),

    loadGame: (gameId, state) =>
      Effect.sync(() => {
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
