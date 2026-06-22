/**
 * Rate limiter for player actions to prevent spam and cheating.
 * Tracks action frequency per player and enforces limits.
 */
import { isRealProduction } from '~~/server/utils/testHooks'

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

// Test escape hatch: an e2e/hitspec run can mint many users from one IP in quick
// succession, which the per-IP auth limit (5 burst, 0.5/s) would 429. When
// TERMINA_DISABLE_RATE_LIMIT=1 is set, rate checks always pass — but ONLY on a
// non-production server OR a test-hooks server. The prod PREVIEW used for e2e
// runs with NODE_ENV=production, so it qualifies via TERMINA_TEST_HOOKS=1; REAL
// production never sets TERMINA_TEST_HOOKS (it gates the dev /api/test/* hooks),
// so this can never weaken brute-force protection in production. Unit tests set
// neither flag, so they still exercise the real token-bucket behaviour.
function rateLimitDisabled(): boolean {
  if (process.env.TERMINA_DISABLE_RATE_LIMIT !== '1') return false
  return !isRealProduction()
}

// Bound the tracked-key map: when it grows past the cap, evict entries that
// have been idle long enough to be fully refilled anyway.
const MAX_TRACKED_KEYS = 10_000
const IDLE_EVICT_MS = 10 * 60 * 1000

function evictStaleStates(now: number): void {
  if (playerStates.size < MAX_TRACKED_KEYS) return
  for (const [key, state] of playerStates) {
    if (now - state.lastRefill > IDLE_EVICT_MS) {
      playerStates.delete(key)
    }
  }
}

/**
 * Check if a player can perform an action using token bucket algorithm.
 * @param playerId - The player ID
 * @param config - Rate limit configuration (optional, uses defaults if not provided)
 * @returns true if action is allowed, false if rate limited
 */
export function checkRateLimit(
  playerId: string,
  config: RateLimitConfig = DEFAULT_CONFIG,
): boolean {
  if (rateLimitDisabled()) return true
  const now = Date.now()
  evictStaleStates(now)
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

// ── Scoped limits for non-action surfaces ────────────────────────
// Same token-bucket state, namespaced keys, per-scope budgets.

const SCOPE_CONFIGS: Record<string, RateLimitConfig> = {
  // Credential endpoints: slow enough to blunt brute force per IP
  auth: { maxActionsPerSecond: 0.5, maxBurstSize: 5 },
  // Queue join/leave per user
  queue: { maxActionsPerSecond: 1, maxBurstSize: 5 },
  // Draft picks/bans per user
  lobby: { maxActionsPerSecond: 2, maxBurstSize: 6 },
  // Tutorial game creation per user — cheap to ask for, but cap rapid spamming
  tutorial: { maxActionsPerSecond: 0.5, maxBurstSize: 3 },
  // In-game chat + map pings per user — 3/s with a burst of 10
  chat: { maxActionsPerSecond: 3, maxBurstSize: 10 },
  // Reconnect / request_state recovery ops per player — cheap to send but each
  // triggers a state rebuild / snapshot read, so cap rapid spamming.
  recovery: { maxActionsPerSecond: 1, maxBurstSize: 5 },
  // Public read endpoints (leaderboard/history/replay/profile) keyed by IP —
  // generous so normal browsing is never throttled; only blunts scraping/abuse.
  publicRead: { maxActionsPerSecond: 10, maxBurstSize: 50 },
}

/**
 * Rate-limit an operation in a named scope (e.g. 'auth' keyed by IP,
 * 'lobby' keyed by player). Returns true if the operation is allowed.
 */
export function checkScopedRateLimit(scope: keyof typeof SCOPE_CONFIGS, key: string): boolean {
  const config = SCOPE_CONFIGS[scope] ?? DEFAULT_CONFIG
  return checkRateLimit(`${scope}:${key}`, config)
}

/**
 * Get players with excessive violations (potential cheaters).
 * @param threshold - Number of violations to flag as suspicious
 */
export function getSuspiciousPlayers(
  threshold = 10,
): Array<{ playerId: string; violations: number }> {
  const suspicious: Array<{ playerId: string; violations: number }> = []

  for (const [playerId, state] of playerStates.entries()) {
    if (state.violations >= threshold) {
      suspicious.push({ playerId, violations: state.violations })
    }
  }

  return suspicious
}
