import type { IceState, TeamId, TeamState, TerminalState } from '~~/shared/types/game'
import type { TargetRef } from '~~/shared/types/commands'
import { ZONES, ZONE_MAP } from '~~/shared/constants/zones'
import { HARDEN_DURATION_CYCLES } from '~~/shared/constants/balance'

/**
 * The structure-attack rules the engine enforces and the prompt mirrors. ONE
 * module so the client pre-flight (app/composables/useCommands validateCommand)
 * and the server (ActionResolver approachStructure + attack phase,
 * TerminalSystem) can never disagree on a rule or on the text that explains it.
 * ICE and Terminals are broadcast unfogged, so the client judges these with the
 * same inputs the server does.
 */

/** The zone each team's Terminal occupies. */
export const TERMINAL_ZONES: Record<TeamId, string> = {
  chaff: 'rookery-terminal',
  audit: 'landing-terminal',
}

/** Why a structure attack can never land — the exact texts the player reads. */
export const STRUCTURE_REFUSAL = {
  noIce: (zone: string) => `No standing ice in ${zone}`,
  ownIce: 'That is your own ICE',
  hardened: 'That ice is Hardened — attacks do nothing until it expires',
  protectedIce: 'That ice is protected — destroy the one in front of it first',
  noTerminal: 'No Terminal in this game',
  terminalDestroyed: 'The enemy Terminal is already destroyed',
  firewalled: 'The enemy Terminal is firewalled — destroy a T3 ice first',
} as const

/** Check if a ice at a zone can be attacked (preceding ice must be destroyed). */
export function canAttackIce(ice: readonly IceState[], zoneId: string): boolean {
  const target = ice.find((t) => t.zone === zoneId && t.alive)
  if (!target) return false

  const zone = ZONE_MAP[zoneId]
  const tier = zone?.tier ?? 0
  if (tier <= 1) return true // T1 can always be attacked

  // Route and team come from the zone RECORD, and the preceding zone is looked
  // up by its fields rather than assembled from them. The old code parsed the id
  // (`startsWith('top-')`) and then rebuilt one (`${lane}-t${tier}-${team}`),
  // which silently encoded the id scheme into the ICE-exposure rule: any rename
  // would have made every T2/T3 permanently attackable — no type error, no
  // failing test, just a game that no longer has a tower order.
  const lane = zone?.lane
  const team = target.team
  const precedingTier = tier - 1
  const precedingZone = ZONES.find(
    (z) => z.lane === lane && z.tier === precedingTier && z.team === team,
  )
  if (!lane || !precedingZone) return true

  const precedingIce = ice.find((t) => t.zone === precedingZone.id)
  return !precedingIce || !precedingIce.alive
}

/** A team's Terminal is open once any of its own T3 ice is dead. Tier comes
 *  from the zone record — matching '-t3-' inside the id made the win condition
 *  itself depend on how zones happen to be named. */
export function terminalExposed(ice: readonly IceState[], team: TeamId): boolean {
  return ice.some((t) => t.team === team && !t.alive && ZONE_MAP[t.zone]?.tier === 3)
}

/** The zone a structure target stands in, for an attacker on `team`; null for
 *  any other target. */
export function structureZone(team: TeamId, target: TargetRef): string | null {
  if (target.kind === 'ice') return target.zone
  if (target.kind === 'terminal') return TERMINAL_ZONES[team === 'chaff' ? 'audit' : 'chaff']
  return null
}

/**
 * Why an attack on a structure can never land, or null when it can (or when it
 * is no structure attack). The engine refuses a walk toward a structure the
 * attack could never hurt on arrival.
 *
 * `fromRange`: the order is a walk there (approachStructure). Harden is the one
 * TEMPORARY refusal — it may well have expired by arrival, and the held order
 * waits it out at the ICE (the attack phase keeps a standing order alive
 * through it) — so from range it does not refuse; see hardenedWalkNote.
 */
export function structureRefusal(
  ice: readonly IceState[],
  terminals: { chaff: TerminalState; audit: TerminalState } | null | undefined,
  team: TeamId,
  target: TargetRef,
  opts: { fromRange?: boolean } = {},
): string | null {
  if (target.kind === 'ice') {
    const standing = ice.find((t) => t.zone === target.zone && t.alive)
    if (!standing) return STRUCTURE_REFUSAL.noIce(target.zone)
    if (standing.team === team) return STRUCTURE_REFUSAL.ownIce
    if (standing.invulnerable && !opts.fromRange) return STRUCTURE_REFUSAL.hardened
    if (!canAttackIce(ice, target.zone)) return STRUCTURE_REFUSAL.protectedIce
    return null
  }
  if (target.kind === 'terminal') {
    const enemy: TeamId = team === 'chaff' ? 'audit' : 'chaff'
    const terminal = terminals?.[enemy]
    if (!terminal) return STRUCTURE_REFUSAL.noTerminal
    if (!terminal.alive) return STRUCTURE_REFUSAL.terminalDestroyed
    if (!terminal.vulnerable && !terminalExposed(ice, enemy)) return STRUCTURE_REFUSAL.firewalled
    return null
  }
  return null
}

/**
 * Cycles a team's Harden still holds its ICE, counted from the cycle an order
 * RESOLVES in: the attack phase of every cycle up to hardenUsedCycle +
 * HARDEN_DURATION_CYCLES still sees it (GameLoop expireGlyph runs after
 * resolution). The server passes the cycle it is resolving; the client passes
 * its open cycle + 1 — the cycle a fresh order lands in. 0 when not Hardened.
 */
export function hardenCyclesLeft(
  teams: Partial<Record<TeamId, Pick<TeamState, 'hardenUsedCycle'>>> | null | undefined,
  iceTeam: TeamId,
  resolveCycle: number,
): number {
  const used = teams?.[iceTeam]?.hardenUsedCycle
  if (used == null) return 0
  return Math.max(0, used + HARDEN_DURATION_CYCLES + 1 - resolveCycle)
}

/** The reply to an ICE order from range whose ICE is Hardened right now: the
 *  walk goes ahead, and the held attack swings once the Harden expires. */
export function hardenedWalkNote(cyclesLeft: number): string {
  const left = cyclesLeft > 0 ? ` for ${cyclesLeft} more cycle${cyclesLeft === 1 ? '' : 's'}` : ''
  return `That ice is Hardened${left} — walking there anyway; the attack lands once it expires`
}

/**
 * The note for an attack on `target` ordered from range, or null when there is
 * nothing to say (not ICE, not Hardened, or refused outright). One builder for
 * the server's reply (GameLoop) and the prompt's preview (CommandInput).
 */
export function structureWalkNote(
  ice: readonly IceState[],
  teams: Partial<Record<TeamId, Pick<TeamState, 'hardenUsedCycle'>>> | null | undefined,
  target: TargetRef,
  resolveCycle: number,
): string | null {
  if (target.kind !== 'ice') return null
  const standing = ice.find((t) => t.zone === target.zone && t.alive)
  if (!standing?.invulnerable) return null
  return hardenedWalkNote(hardenCyclesLeft(teams, standing.team, resolveCycle))
}
