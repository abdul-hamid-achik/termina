/**
 * Anti-cheat validation system
 * Detects and prevents common cheating attempts:
 * - Speed hacking (action frequency)
 * - Map hacking (vision bypass)
 * - Cooldown manipulation
 * - Invalid action sequences
 */

import type { GameState, PlayerState } from '~~/shared/types/game'
import type { Command } from '~~/shared/types/commands'
import { areAdjacent } from '~~/server/game/map/topology'
import { HEROES } from '~~/shared/constants/heroes'
import { MAX_LEVEL } from '~~/shared/constants/balance'
import { getRateLimitStats } from './RateLimiter'

export interface CheatDetection {
  playerId: string
  violationType: ViolationType
  severity: 'low' | 'medium' | 'high' | 'critical'
  timestamp: number
  details: string
}

export type ViolationType =
  | 'VISION_BYPASS'
  | 'COOLDOWN_MANIPULATION'
  | 'INVALID_MOVE'
  | 'IMPOSSIBLE_ACTION'
  | 'RATE_LIMIT_EXCEEDED'
  | 'STAT_MISMATCH'

const violationSeverity: Record<ViolationType, 'low' | 'medium' | 'high' | 'critical'> = {
  VISION_BYPASS: 'high',
  COOLDOWN_MANIPULATION: 'high',
  INVALID_MOVE: 'medium',
  IMPOSSIBLE_ACTION: 'medium',
  RATE_LIMIT_EXCEEDED: 'low',
  STAT_MISMATCH: 'critical',
}

const playerViolations = new Map<string, CheatDetection[]>()

/**
 * Validate that a player can only see and act on visible zones
 */
export function validateVision(
  state: GameState,
  playerId: string,
  command: Command,
): CheatDetection | null {
  const player = state.players[playerId]
  if (!player || !player.alive) return null

  // Check movement commands
  if (command.type === 'move') {
    const targetZone = command.zone
    // Players can only move to adjacent zones or stay in current zone
    // This is already validated in ActionResolver, but we double-check here for cheating
    if (!areAdjacent(player.zone, targetZone) && player.zone !== targetZone) {
      return createViolation(playerId, 'INVALID_MOVE', `Attempted move from ${player.zone} to ${targetZone}`)
    }
  }

  // Check ward placement (prevent placing wards in invisible areas)
  if (command.type === 'ward') {
    const wardZone = command.zone
    if (!areAdjacent(player.zone, wardZone) && player.zone !== wardZone) {
      return createViolation(playerId, 'VISION_BYPASS', `Attempted ward placement in invisible zone ${wardZone}`)
    }
  }

  // Check attack commands (prevent attacking invisible enemies)
  if (command.type === 'attack' && command.target.kind === 'hero') {
    const targetName = command.target.name
    const targetPlayer = findHeroByName(state.players, targetName)
    if (targetPlayer) {
      const target = state.players[targetPlayer]
      if (target && target.zone !== player.zone) {
        return createViolation(playerId, 'VISION_BYPASS', `Attempted attack on invisible hero ${targetName}`)
      }
    }
  }

  return null
}

/**
 * Validate ability cooldowns haven't been manipulated
 */
export function validateCooldowns(
  state: GameState,
  playerId: string,
  command: Command,
): CheatDetection | null {
  if (command.type !== 'cast') return null

  const player = state.players[playerId]
  if (!player || !player.heroId) return null

  const hero = HEROES[player.heroId]
  if (!hero) return null

  const ability = hero.abilities[command.ability]
  if (!ability) return null

  // Check if ability is on cooldown
  const cooldown = player.cooldowns[command.ability]
  if (cooldown > 0) {
    return createViolation(
      playerId,
      'COOLDOWN_MANIPULATION',
      `Attempted to cast ${command.ability} with ${cooldown} ticks remaining`,
    )
  }

  return null
}

/**
 * Validate that action timing is physically possible
 */
export function validateActionTiming(
  state: GameState,
  playerId: string,
  command: Command,
): CheatDetection | null {
  const player = state.players[playerId]
  if (!player) return null

  // Check for impossible movement speed
  if (command.type === 'move') {
    // Already validated in rate limiter and vision check
    const stats = getRateLimitStats(playerId)
    if (stats && stats.violations > 10) {
      return createViolation(
        playerId,
        'RATE_LIMIT_EXCEEDED',
        `Excessive action frequency: ${stats.totalActions} actions, ${stats.violations} violations`,
      )
    }
  }

  // Check for impossible ability usage (silenced/stunned)
  if (command.type === 'cast') {
    if (hasDebuff(player, 'silence') || hasDebuff(player, 'stun')) {
      return createViolation(
        playerId,
        'IMPOSSIBLE_ACTION',
        `Attempted to cast while silenced/stunned`,
      )
    }
  }

  // Check for impossible attack (stunned)
  if (command.type === 'attack') {
    if (hasDebuff(player, 'stun')) {
      return createViolation(playerId, 'IMPOSSIBLE_ACTION', `Attempted to attack while stunned`)
    }
  }

  return null
}

/**
 * Validate player stats haven't been modified
 */
export function validatePlayerStats(state: GameState, playerId: string): CheatDetection | null {
  const player = state.players[playerId]
  if (!player) return null

  const hero = HEROES[player.heroId]
  if (!hero || !player.heroId) return null

  // Check HP is within valid range
  if (player.hp > player.maxHp) {
    return createViolation(
      playerId,
      'STAT_MISMATCH',
      `HP (${player.hp}) exceeds max HP (${player.maxHp})`,
    )
  }

  // Check MP is within valid range
  if (player.mp > player.maxMp) {
    return createViolation(
      playerId,
      'STAT_MISMATCH',
      `MP (${player.mp}) exceeds max MP (${player.maxMp})`,
    )
  }

  // Check level is within valid range
  if (player.level > MAX_LEVEL) {
    return createViolation(
      playerId,
      'STAT_MISMATCH',
      `Level (${player.level}) exceeds max level (${MAX_LEVEL})`,
    )
  }

  // Check gold is non-negative
  if (player.gold < 0) {
    return createViolation(playerId, 'STAT_MISMATCH', `Negative gold (${player.gold})`)
  }

  // Check item count
  if (player.items.filter(Boolean).length > 6) {
    return createViolation(playerId, 'STAT_MISMATCH', `More than 6 items equipped`)
  }

  return null
}

/**
 * Run all anti-cheat validations for a player action
 */
export function runAntiCheatChecks(
  state: GameState,
  playerId: string,
  command: Command,
): CheatDetection[] {
  const violations: CheatDetection[] = []

  const visionViolation = validateVision(state, playerId, command)
  if (visionViolation) violations.push(visionViolation)

  const cooldownViolation = validateCooldowns(state, playerId, command)
  if (cooldownViolation) violations.push(cooldownViolation)

  const timingViolation = validateActionTiming(state, playerId, command)
  if (timingViolation) violations.push(timingViolation)

  const statsViolation = validatePlayerStats(state, playerId)
  if (statsViolation) violations.push(statsViolation)

  // Record violations
  if (violations.length > 0) {
    const existing = playerViolations.get(playerId) || []
    playerViolations.set(playerId, [...existing, ...violations])
  }

  return violations
}

/**
 * Get violation history for a player
 */
export function getPlayerViolations(playerId: string): CheatDetection[] {
  return playerViolations.get(playerId) || []
}

/**
 * Get all players with violations
 */
export function getAllViolators(): Array<{ playerId: string; violations: CheatDetection[] }> {
  const violators: Array<{ playerId: string; violations: CheatDetection[] }> = []

  for (const [playerId, violations] of playerViolations.entries()) {
    if (violations.length > 0) {
      violators.push({ playerId, violations })
    }
  }

  return violators
}

/**
 * Clear violation history for a player (e.g., on game end)
 */
export function clearPlayerViolations(playerId: string): void {
  playerViolations.delete(playerId)
}

/**
 * Clear all violation history (e.g., on server shutdown)
 */
export function cleanupAntiCheat(): void {
  playerViolations.clear()
}

/**
 * Get players with critical violations that should be kicked/banned
 */
export function getCriticalViolators(): Array<{ playerId: string; violationCount: number }> {
  const criticalViolators: Array<{ playerId: string; violationCount: number }> = []

  for (const [playerId, violations] of playerViolations.entries()) {
    const criticalCount = violations.filter((v) => v.severity === 'critical').length
    const highCount = violations.filter((v) => v.severity === 'high').length

    if (criticalCount > 0 || highCount >= 3) {
      criticalViolators.push({
        playerId,
        violationCount: violations.length,
      })
    }
  }

  return criticalViolators
}

// ── Helper Functions ──────────────────────────────────────────────

function createViolation(
  playerId: string,
  violationType: ViolationType,
  details: string,
): CheatDetection {
  return {
    playerId,
    violationType,
    severity: violationSeverity[violationType],
    timestamp: Date.now(),
    details,
  }
}

function hasDebuff(player: PlayerState, type: string): boolean {
  return player.buffs.some((b) => b.id.includes(type))
}

function findHeroByName(players: Record<string, PlayerState>, name: string): string | null {
  for (const [id, player] of Object.entries(players)) {
    if (player.name === name) return id
  }
  return null
}
