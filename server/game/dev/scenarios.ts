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
    case 'tenant_dead':
      // Tenant slain at the current tick → the objective ticker shows a respawn
      // countdown (deathCycle + TENANT_RESPAWN_CYCLES).
      return {
        ...state,
        tenant: { ...state.tenant, alive: false, integ: 0, deathCycle: state.cycle },
      }

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
          [humanId]: { ...human, alive: false, integ: 0, respawnCycle: state.cycle + 30 },
        },
      }
    }

    case 'core_vulnerable':
      // As if a Audit T3 fell — the enemy Ancient is now attackable; the macro
      // strip should flag it urgent.
      return {
        ...state,
        terminals: {
          ...state.terminals,
          audit: { ...state.terminals.audit, vulnerable: true },
        },
      }

    case 'night':
      return { ...state, timeOfDay: 'night' }

    case 'laning_combat': {
      // Co-locate the human and one enemy hero mid-lane so attack / offensive
      // cast specs have a legal target in-zone. Both are levelled up and topped
      // off so abilities are unlocked and castable. Pair with manualTick so the
      // spec drives resolution deterministically.
      const humanId = opts?.humanId
      const human = humanId ? state.players[humanId] : undefined
      if (!humanId || !human) return state
      const enemy = Object.values(state.players).find((p) => p.team !== human.team)
      const laneZone = 'mid-river'
      const players = {
        ...state.players,
        [humanId]: { ...human, zone: laneZone, level: 6, bw: human.maxBw, integ: human.maxInteg },
      }
      if (enemy) {
        players[enemy.id] = {
          ...enemy,
          zone: laneZone,
          level: 6,
          integ: enemy.maxInteg,
          bw: enemy.maxBw,
        }
      }
      return { ...state, players }
    }

    case 'talent_ready': {
      // The human is level 10 with no talents chosen → the TalentPicker prompt
      // appears so the talent-selection spec can pick one. manualTick keeps the
      // level stable (no XP drift) while the spec drives it.
      const humanId = opts?.humanId
      const human = humanId ? state.players[humanId] : undefined
      if (!humanId || !human) return state
      return {
        ...state,
        players: {
          ...state.players,
          [humanId]: {
            ...human,
            level: 10,
            bw: human.maxBw,
            integ: human.maxInteg,
            talents: { tier10: null, tier15: null, tier20: null, tier25: null },
          },
        },
      }
    }

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
  'laning_combat',
  'tenant_dead',
  'core_vulnerable',
  'night',
  'self_dead',
  'talent_ready',
] as const
