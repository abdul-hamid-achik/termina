/**
 * AncientSystem — each team's core structure (themed "the Mainframe" in the
 * terminal UI, field name `ancients` in state).
 *
 * Rules:
 * - One Ancient per team, located in the team's base zone.
 * - Invulnerable until at least one of the owning team's T3 ice is down.
 * - Once vulnerable, both heroes and waves can attack it.
 * - Destroying the enemy Ancient wins the game (see checkAncientWin).
 *
 * All functions are pure — no Effect, no I/O — so they can be called from
 * the engine pipeline and from ActionResolver alike.
 */
import type { AncientState, GameState, TeamId } from '~~/shared/types/game'
import { ANCIENT_HP } from '~~/shared/constants/balance'
import type { GameEngineEvent } from '~~/server/game/protocol/events'
import { scaledAncientHp } from './fastGame'

/** The zone each team's Ancient occupies. */
export const ANCIENT_ZONES: Record<TeamId, string> = {
  chaff: 'chaff-base',
  audit: 'audit-base',
}

/** Stable target id for an Ancient, used in damage events and targeting. */
export function ancientTargetId(team: TeamId): string {
  return `ancient_${team}`
}

/** Parse an ancient target id back to a team, or null if it isn't one. */
export function parseAncientTargetId(targetId: string): TeamId | null {
  if (targetId === 'ancient_chaff') return 'chaff'
  if (targetId === 'ancient_audit') return 'audit'
  return null
}

/** Fresh Ancients for game start. */
export function initializeAncients(): { chaff: AncientState; audit: AncientState } {
  // scaledAncientHp is a no-op (returns ANCIENT_HP) unless the dev/test-only
  // TERMINA_TEST_FAST_GAME accelerator is active — see fastGame.ts.
  const hp = scaledAncientHp(ANCIENT_HP)
  return {
    chaff: { team: 'chaff', hp, maxHp: hp, alive: true, vulnerable: false },
    audit: { team: 'audit', hp, maxHp: hp, alive: true, vulnerable: false },
  }
}

/**
 * Backfill `ancients` on states created before the Ancient existed (old
 * snapshots, test fixtures). Returns the same object when nothing changed.
 */
export function ensureAncients(state: GameState): GameState {
  if (state.ancients) return state
  return { ...state, ancients: initializeAncients() }
}

/** A team's Ancient is vulnerable once any of its own T3 ice is dead. */
export function isAncientVulnerable(state: GameState, team: TeamId): boolean {
  return state.ice.some((t) => t.team === team && !t.alive && t.zone.includes('-t3-'))
}

/**
 * Recompute the `vulnerable` flag on both Ancients from current ice state.
 * Vulnerability never reverts (a dead ice stays dead), but recomputing is
 * cheap and self-correcting. Returns the same object when nothing changed.
 */
export function updateAncientVulnerability(state: GameState): GameState {
  const chaffVulnerable = isAncientVulnerable(state, 'chaff')
  const auditVulnerable = isAncientVulnerable(state, 'audit')

  if (
    chaffVulnerable === state.ancients.chaff.vulnerable &&
    auditVulnerable === state.ancients.audit.vulnerable
  ) {
    return state
  }

  return {
    ...state,
    ancients: {
      chaff: { ...state.ancients.chaff, vulnerable: chaffVulnerable },
      audit: { ...state.ancients.audit, vulnerable: auditVulnerable },
    },
  }
}

/**
 * Resolve an attack against the enemy Ancient by a hero (player id) or a
 * wave (wave id). The attacker's team is resolved from state; the target
 * is always the opposing team's Ancient.
 *
 * Returns the (possibly unchanged) state, the events to emit, and an
 * optional `rejected` reason when the attack was invalid — callers can
 * surface it as player feedback.
 *
 * Wiring status (both live):
 * - Wave attacks: via WaveAI (`attack_ancient` action).
 * - Hero attacks: the `attack` command with an ancient target calls this from
 *   ActionResolver.ts (imported at the top, invoked in the attack-resolution
 *   pipeline), so a hero standing in the enemy base can destroy the Ancient.
 */
export function resolveAncientAttack(
  state: GameState,
  attackerId: string,
  damage: number,
): { state: GameState; events: GameEngineEvent[]; rejected?: string } {
  if (!state.ancients) {
    return { state, events: [], rejected: 'No Ancient in this game' }
  }

  const attackerTeam = getAttackerTeam(state, attackerId)
  if (!attackerTeam) {
    return { state, events: [], rejected: 'Unknown attacker' }
  }

  const targetTeam: TeamId = attackerTeam === 'chaff' ? 'audit' : 'chaff'
  const ancient = state.ancients[targetTeam]

  if (!ancient.alive) {
    return { state, events: [], rejected: 'The enemy Mainframe is already destroyed' }
  }
  if (!ancient.vulnerable) {
    return {
      state,
      events: [],
      rejected: 'The enemy Mainframe is firewalled — destroy a T3 ice first',
    }
  }

  const newHp = Math.max(0, ancient.hp - damage)
  const destroyed = newHp === 0

  const events: GameEngineEvent[] = [
    {
      _tag: 'damage',
      tick: state.tick,
      sourceId: attackerId,
      targetId: ancientTargetId(targetTeam),
      amount: damage,
      damageType: 'kinetic',
    },
  ]
  if (destroyed) {
    // Dedicated victory announcement — the Ancient (Core) is not a ice, so it
    // gets its own event instead of reusing the ice_kill shape (which would
    // render a misleading "destroyed <team> ice in <team>-base" line).
    events.push({
      _tag: 'ancient_destroyed',
      tick: state.tick,
      team: targetTeam,
      killerTeam: attackerTeam,
    })
  }

  return {
    state: {
      ...state,
      ancients: {
        ...state.ancients,
        [targetTeam]: { ...ancient, hp: newHp, alive: !destroyed },
      },
    },
    events,
  }
}

/** A team wins when the enemy Ancient is destroyed. */
export function checkAncientWin(state: GameState): TeamId | null {
  if (!state.ancients) return null
  if (!state.ancients.chaff.alive) return 'audit'
  if (!state.ancients.audit.alive) return 'chaff'
  return null
}

function getAttackerTeam(state: GameState, attackerId: string): TeamId | null {
  const player = state.players[attackerId]
  if (player) return player.team
  const wave = state.waves.find((c) => c.id === attackerId)
  return wave?.team ?? null
}
