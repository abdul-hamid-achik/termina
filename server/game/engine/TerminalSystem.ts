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
import { STRUCTURE_REFUSAL, terminalExposed } from '~~/shared/utils/structureRules'
import type { GameEngineEvent } from '~~/server/game/protocol/events'
import { scaledTerminalHp } from './fastGame'

/** The zone each team's Terminal occupies (shared: the prompt mirrors it). */
export { TERMINAL_ZONES } from '~~/shared/utils/structureRules'

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

/** A team's Terminal is vulnerable once any of its own T3 ice is dead.
 *  Tier comes from the zone record — matching '-t3-' inside the id made the
 *  win condition itself depend on how zones happen to be named. */
export function isTerminalVulnerable(state: GameState, team: TeamId): boolean {
  return terminalExposed(state.ice, team)
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
    return { state, events: [], rejected: STRUCTURE_REFUSAL.noTerminal }
  }

  const attackerTeam = getAttackerTeam(state, attackerId)
  if (!attackerTeam) {
    return { state, events: [], rejected: 'Unknown attacker' }
  }

  const targetTeam: TeamId = attackerTeam === 'chaff' ? 'audit' : 'chaff'
  const terminal = state.terminals[targetTeam]

  if (!terminal.alive) {
    return { state, events: [], rejected: STRUCTURE_REFUSAL.terminalDestroyed }
  }
  // Derived from the ICE as it stands NOW, not from the stored flag: the flag is
  // only recomputed at GameLoop step 5.7, after hero actions, so reading it would
  // bounce a swing made in the very cycle the last T3 fell.
  if (!terminal.vulnerable && !isTerminalVulnerable(state, targetTeam)) {
    return {
      state,
      events: [],
      rejected: STRUCTURE_REFUSAL.firewalled,
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

/**
 * A team wins when the enemy Terminal is destroyed.
 *
 * Both Terminals can fall in the same cycle (the batch clock lands every swing
 * together). The match has no draw — game_over, MMR and the matches row all
 * need a winner — so the tie is broken fairly instead of by which `if` came
 * first (it used to be audit, always):
 *   1. the Terminal that held more INTEG when the cycle opened (it was the one
 *      further from falling);
 *   2. else the team with more of its own ICE INTEG standing at cycle end;
 *   3. else a coin from the game's deterministic seed — same replay, same call.
 * `cycleStart` defaults to `state` (direct callers without a pre-cycle state).
 */
export function checkTerminalWin(
  state: GameState,
  cycleStart: GameState = state,
  coinSeed = 0,
): TeamId | null {
  if (!state.terminals) return null
  const chaffDown = !state.terminals.chaff.alive
  const auditDown = !state.terminals.audit.alive
  if (chaffDown && auditDown) return sameCycleTerminalTieBreak(state, cycleStart, coinSeed)
  if (chaffDown) return 'audit'
  if (auditDown) return 'chaff'
  return null
}

function sameCycleTerminalTieBreak(
  state: GameState,
  cycleStart: GameState,
  coinSeed: number,
): TeamId {
  const opening = (t: TeamId) => cycleStart.terminals?.[t]?.integ ?? 0
  if (opening('chaff') !== opening('audit')) {
    return opening('chaff') > opening('audit') ? 'chaff' : 'audit'
  }
  const iceStanding = (t: TeamId) =>
    (state.ice ?? []).reduce((sum, i) => (i.team === t && i.alive ? sum + i.integ : sum), 0)
  if (iceStanding('chaff') !== iceStanding('audit')) {
    return iceStanding('chaff') > iceStanding('audit') ? 'chaff' : 'audit'
  }
  return (coinSeed & 1) === 0 ? 'chaff' : 'audit'
}

function getAttackerTeam(state: GameState, attackerId: string): TeamId | null {
  const player = state.players[attackerId]
  if (player) return player.team
  const wave = state.waves.find((c) => c.id === attackerId)
  return wave?.team ?? null
}
