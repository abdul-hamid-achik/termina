/**
 * Rate limiter for player actions to prevent spam and cheating.
 * Tracks action frequency per player and enforces limits.
 */

export interface RateLimitConfig {
  maxActionsPerSecond: number
  maxBurstSize: number
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxActionsPerSecond: 5, // Max 5 actions per second on average
  maxBurstSize: 10, // Allow burst of up to 10 actions
}

interface PlayerRateLimitState {
  tokens: number
  lastRefill: number
  totalActions: number
  violations: number
}

const playerStates = new Map<string, PlayerRateLimitState>()

/**
 * Check if a player can perform an action using token bucket algorithm.
 * @param playerId - The player ID
 * @param config - Rate limit configuration (optional, uses defaults if not provided)
 * @returns true if action is allowed, false if rate limited
 */
export function checkRateLimit(playerId: string, config: RateLimitConfig = DEFAULT_CONFIG): boolean {
  const now = Date.now()
  let state = playerStates.get(playerId)

  if (!state) {
    state = {
      tokens: config.maxBurstSize,
      lastRefill: now,
      totalActions: 0,
      violations: 0,
    }
    playerStates.set(playerId, state)
  }

  // Refill tokens based on time elapsed
  const elapsed = now - state.lastRefill
  const refillRate = config.maxActionsPerSecond / 1000 // tokens per ms
  const tokensToAdd = elapsed * refillRate

  state.tokens = Math.min(config.maxBurstSize, state.tokens + tokensToAdd)
  state.lastRefill = now

  if (state.tokens >= 1) {
    state.tokens -= 1
    state.totalActions += 1
    return true
  }

  // Rate limit exceeded
  state.violations += 1
  return false
}

/**
 * Get rate limit statistics for a player.
 */
export function getRateLimitStats(playerId: string): {
  tokens: number
  totalActions: number
  violations: number
} | null {
  const state = playerStates.get(playerId)
  if (!state) return null

  return {
    tokens: state.tokens,
    totalActions: state.totalActions,
    violations: state.violations,
  }
}

/**
 * Reset rate limit state for a player (e.g., on game end).
 */
export function resetRateLimit(playerId: string): void {
  playerStates.delete(playerId)
}

/**
 * Clean up rate limit state for all players (e.g., on server shutdown).
 */
export function cleanupRateLimiters(): void {
  playerStates.clear()
}

/**
 * Get players with excessive violations (potential cheaters).
 * @param threshold - Number of violations to flag as suspicious
 */
export function getSuspiciousPlayers(threshold = 10): Array<{ playerId: string; violations: number }> {
  const suspicious: Array<{ playerId: string; violations: number }> = []

  for (const [playerId, state] of playerStates.entries()) {
    if (state.violations >= threshold) {
      suspicious.push({ playerId, violations: state.violations })
    }
  }

  return suspicious
}
