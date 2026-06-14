import type { GameState } from '~~/shared/types/game'

/**
 * Dev/test-only deterministic scenario transforms, applied to a freshly-created
 * game right after createGame (see createDevGame in server/plugins/game-server.ts).
 * Pure functions over GameState — unit-testable in isolation, no engine coupling.
 *
 * Add scenarios here as specs need them; keep each a minimal, legal mutation of
 * a real GameState (never an impossible state).
 */
interface ScenarioOptions {
  seed?: number
  /** The human player's id (players[humanId]) — needed by player-targeting scenarios. */
  humanId?: string
}

export function applyScenario(
  state: GameState,
  scenario: string,
  opts?: ScenarioOptions,
): GameState {
  switch (scenario) {
    case 'roshan_dead':
      // Roshan slain at the current tick → the objective ticker shows a respawn
      // countdown (deathTick + ROSHAN_RESPAWN_TICKS).
      return { ...state, roshan: { ...state.roshan, alive: false, hp: 0, deathTick: state.tick } }

    case 'self_dead': {
      // The human player is dead with a pending respawn → GameScreen renders the
      // death overlay (v-if="!gameStore.isAlive && gameStore.player"). Seed with
      // manualTick: true so the respawn handler never revives them.
      const humanId = opts?.humanId
      const human = humanId ? state.players[humanId] : undefined
      if (!humanId || !human) return state
      return {
        ...state,
        players: {
          ...state.players,
          [humanId]: { ...human, alive: false, hp: 0, respawnTick: state.tick + 30 },
        },
      }
    }

    case 'core_vulnerable':
      // As if a Dire T3 fell — the enemy Ancient is now attackable; the macro
      // strip should flag it urgent.
      return {
        ...state,
        ancients: {
          ...state.ancients,
          dire: { ...state.ancients.dire, vulnerable: true },
        },
      }

    case 'night':
      return { ...state, timeOfDay: 'night' }

    case 'fresh':
    case 'laning':
    default:
      // No shaping yet — a fresh playing game (laning shaping is a fast-follow).
      return state
  }
}

/** The scenarios applyScenario knows how to shape (for docs/validation). */
export const KNOWN_SCENARIOS = [
  'fresh',
  'laning',
  'roshan_dead',
  'core_vulnerable',
  'night',
  'self_dead',
] as const
