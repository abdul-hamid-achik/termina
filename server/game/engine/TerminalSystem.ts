/**
 * TerminalSystem — each team's core structure (player-facing: "the Terminal";
 * field name `terminals` in state — not renamed until the identifier sweep).
 *
 * Rules:
 * - One Terminal per team, located in the team's base zone.
 * - Invulnerable until at least one of the owning team's T3 ice is down.
 * - Once vulnerable, both heroes and waves can attack it.
 * - Destroying the enemy Terminal wins the game (see checkTerminalWin).
 *
 * All functions are pure — no Effect, no I/O — so they can be called from
 * the engine pipeline and from ActionResolver alike.
 */
import type { TerminalState, GameState, TeamId } from '~~/shared/types/game'
import { TERMINAL_HP } from '~~/shared/constants/balance'
import type { GameEngineEvent } from '~~/server/game/protocol/events'
import { scaledTerminalHp } from './fastGame'

/** The zone each team's Terminal occupies. */
export const TERMINAL_ZONES: Record<TeamId, string> = {
  chaff: 'chaff-base',
  audit: 'audit-base',
}

/** Stable target id for a Terminal, used in damage events and targeting. */
export function terminalTargetId(team: TeamId): string {
  return `terminal_${team}`
}

/** Parse a terminal target id back to a team, or null if it isn't one. */
export function parseTerminalTargetId(targetId: string): TeamId | null {
  if (targetId === 'terminal_chaff') return 'chaff'
  if (targetId === 'terminal_audit') return 'audit'
  return null
}

/** Fresh Terminals for game start. */
export function initializeTerminals(): { chaff: TerminalState; audit: TerminalState } {
  // scaledTerminalHp is a no-op (returns TERMINAL_HP) unless the dev/test-only
  // TERMINA_TEST_FAST_GAME accelerator is active — see fastGame.ts.
  const integ = scaledTerminalHp(TERMINAL_HP)
  return {
    chaff: { team: 'chaff', integ, maxInteg: integ, alive: true, vulnerable: false },
    audit: { team: 'audit', integ, maxInteg: integ, alive: true, vulnerable: false },
  }
}

/**
 * Backfill `terminals` on states created before the Terminal existed (old
 * snapshots, test fixtures). Returns the same object when nothing changed.
 */
export function ensureTerminals(state: GameState): GameState {
  if (state.terminals) return state
  return { ...state, terminals: initializeTerminals() }
}

/** A team's Terminal is vulnerable once any of its own T3 ice is dead. */
export function isTerminalVulnerable(state: GameState, team: TeamId): boolean {
  return state.ice.some((t) => t.team === team && !t.alive && t.zone.includes('-t3-'))
}

/**
 * Recompute the `vulnerable` flag on both Terminals from current ice state.
 * Vulnerability never reverts (a dead ice stays dead), but recomputing is
 * cheap and self-correcting. Returns the same object when nothing changed.
 */
export function updateTerminalVulnerability(state: GameState): GameState {
  const chaffVulnerable = isTerminalVulnerable(state, 'chaff')
  const auditVulnerable = isTerminalVulnerable(state, 'audit')

  if (
    chaffVulnerable === state.terminals.chaff.vulnerable &&
    auditVulnerable === state.terminals.audit.vulnerable
  ) {
    return state
  }

  return {
    ...state,
    terminals: {
      chaff: { ...state.terminals.chaff, vulnerable: chaffVulnerable },
      audit: { ...state.terminals.audit, vulnerable: auditVulnerable },
    },
  }
}

/**
 * Resolve an attack against the enemy Terminal by a hero (player id) or a
 * wave (wave id). The attacker's team is resolved from state; the target
 * is always the opposing team's Terminal.
 *
 * Returns the (possibly unchanged) state, the events to emit, and an
 * optional `rejected` reason when the attack was invalid — callers can
 * surface it as player feedback.
 *
 * Wiring status (both live):
 * - Wave attacks: via WaveAI (`attack_terminal` action).
 * - Hero attacks: the `attack` command with a terminal target calls this from
 *   ActionResolver.ts (imported at the top, invoked in the attack-resolution
 *   pipeline), so a hero standing in the enemy base can destroy the Terminal.
 */
export function resolveTerminalAttack(
  state: GameState,
  attackerId: string,
  damage: number,
): { state: GameState; events: GameEngineEvent[]; rejected?: string } {
  if (!state.terminals) {
    return { state, events: [], rejected: 'No Terminal in this game' }
  }

  const attackerTeam = getAttackerTeam(state, attackerId)
  if (!attackerTeam) {
    return { state, events: [], rejected: 'Unknown attacker' }
  }

  const targetTeam: TeamId = attackerTeam === 'chaff' ? 'audit' : 'chaff'
  const terminal = state.terminals[targetTeam]

  if (!terminal.alive) {
    return { state, events: [], rejected: 'The enemy Terminal is already destroyed' }
  }
  if (!terminal.vulnerable) {
    return {
      state,
      events: [],
      rejected: 'The enemy Terminal is firewalled — destroy a T3 ice first',
    }
  }

  const newInteg = Math.max(0, terminal.integ - damage)
  const destroyed = newInteg === 0

  const events: GameEngineEvent[] = [
    {
      _tag: 'damage',
      cycle: state.cycle,
      sourceId: attackerId,
      targetId: terminalTargetId(targetTeam),
      amount: damage,
      damageType: 'kinetic',
    },
  ]
  if (destroyed) {
    // Dedicated victory announcement — the Terminal is not an ICE structure, so it
    // gets its own event instead of reusing the ice_kill shape (which would
    // render a misleading "destroyed <team> ice in <team>-base" line).
    events.push({
      _tag: 'terminal_destroyed',
      cycle: state.cycle,
      team: targetTeam,
      killerTeam: attackerTeam,
    })
  }

  return {
    state: {
      ...state,
      terminals: {
        ...state.terminals,
        [targetTeam]: { ...terminal, integ: newInteg, alive: !destroyed },
      },
    },
    events,
  }
}

/** A team wins when the enemy Terminal is destroyed. */
export function checkTerminalWin(state: GameState): TeamId | null {
  if (!state.terminals) return null
  if (!state.terminals.chaff.alive) return 'audit'
  if (!state.terminals.audit.alive) return 'chaff'
  return null
}

function getAttackerTeam(state: GameState, attackerId: string): TeamId | null {
  const player = state.players[attackerId]
  if (player) return player.team
  const wave = state.waves.find((c) => c.id === attackerId)
  return wave?.team ?? null
}
