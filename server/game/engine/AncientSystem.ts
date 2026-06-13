/**
 * AncientSystem — each team's core structure (themed "the Mainframe" in the
 * terminal UI, field name `ancients` in state).
 *
 * Rules:
 * - One Ancient per team, located in the team's base zone.
 * - Invulnerable until at least one of the owning team's T3 towers is down.
 * - Once vulnerable, both heroes and creeps can attack it.
 * - Destroying the enemy Ancient wins the game (see checkAncientWin).
 *
 * All functions are pure — no Effect, no I/O — so they can be called from
 * the engine pipeline and from ActionResolver alike.
 */
import type { AncientState, GameState, TeamId } from '~~/shared/types/game'
import { ANCIENT_HP } from '~~/shared/constants/balance'
import type { GameEngineEvent } from '../protocol/events'
import { scaledAncientHp } from './fastGame'

/** The zone each team's Ancient occupies. */
export const ANCIENT_ZONES: Record<TeamId, string> = {
  radiant: 'radiant-base',
  dire: 'dire-base',
}

/** Stable target id for an Ancient, used in damage events and targeting. */
export function ancientTargetId(team: TeamId): string {
  return `ancient_${team}`
}

/** Parse an ancient target id back to a team, or null if it isn't one. */
export function parseAncientTargetId(targetId: string): TeamId | null {
  if (targetId === 'ancient_radiant') return 'radiant'
  if (targetId === 'ancient_dire') return 'dire'
  return null
}

/** Fresh Ancients for game start. */
export function initializeAncients(): { radiant: AncientState; dire: AncientState } {
  // scaledAncientHp is a no-op (returns ANCIENT_HP) unless the dev/test-only
  // TERMINA_TEST_FAST_GAME accelerator is active — see fastGame.ts.
  const hp = scaledAncientHp(ANCIENT_HP)
  return {
    radiant: { team: 'radiant', hp, maxHp: hp, alive: true, vulnerable: false },
    dire: { team: 'dire', hp, maxHp: hp, alive: true, vulnerable: false },
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

/** A team's Ancient is vulnerable once any of its own T3 towers is dead. */
export function isAncientVulnerable(state: GameState, team: TeamId): boolean {
  return state.towers.some((t) => t.team === team && !t.alive && t.zone.includes('-t3-'))
}

/**
 * Recompute the `vulnerable` flag on both Ancients from current tower state.
 * Vulnerability never reverts (a dead tower stays dead), but recomputing is
 * cheap and self-correcting. Returns the same object when nothing changed.
 */
export function updateAncientVulnerability(state: GameState): GameState {
  const radiantVulnerable = isAncientVulnerable(state, 'radiant')
  const direVulnerable = isAncientVulnerable(state, 'dire')

  if (
    radiantVulnerable === state.ancients.radiant.vulnerable &&
    direVulnerable === state.ancients.dire.vulnerable
  ) {
    return state
  }

  return {
    ...state,
    ancients: {
      radiant: { ...state.ancients.radiant, vulnerable: radiantVulnerable },
      dire: { ...state.ancients.dire, vulnerable: direVulnerable },
    },
  }
}

/**
 * Resolve an attack against the enemy Ancient by a hero (player id) or a
 * creep (creep id). The attacker's team is resolved from state; the target
 * is always the opposing team's Ancient.
 *
 * Returns the (possibly unchanged) state, the events to emit, and an
 * optional `rejected` reason when the attack was invalid — callers can
 * surface it as player feedback.
 *
 * Wiring status:
 * - Creep attacks: wired via CreepAI (`attack_ancient` action).
 * - Hero attacks: TODO(items/bots agent) — wire the `attack` command with an
 *   ancient target into ActionResolver.ts by importing this helper and
 *   calling `resolveAncientAttack(state, action.playerId, attackDamage)`,
 *   merging the returned state + events into the resolution pipeline.
 *   ActionResolver is owned by the items/bots agent and is intentionally
 *   not modified here.
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

  const targetTeam: TeamId = attackerTeam === 'radiant' ? 'dire' : 'radiant'
  const ancient = state.ancients[targetTeam]

  if (!ancient.alive) {
    return { state, events: [], rejected: 'The enemy Mainframe is already destroyed' }
  }
  if (!ancient.vulnerable) {
    return {
      state,
      events: [],
      rejected: 'The enemy Mainframe is firewalled — destroy a T3 tower first',
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
      damageType: 'physical',
    },
  ]
  if (destroyed) {
    // Reuse the tower_kill shape for the structure-destroyed announcement —
    // the Ancient is effectively the final tower, in the base zone.
    events.push({
      _tag: 'tower_kill',
      tick: state.tick,
      zone: ANCIENT_ZONES[targetTeam],
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
  if (!state.ancients.radiant.alive) return 'dire'
  if (!state.ancients.dire.alive) return 'radiant'
  return null
}

function getAttackerTeam(state: GameState, attackerId: string): TeamId | null {
  const player = state.players[attackerId]
  if (player) return player.team
  const creep = state.creeps.find((c) => c.id === attackerId)
  return creep?.team ?? null
}
