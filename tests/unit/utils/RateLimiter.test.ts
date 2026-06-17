import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  checkRateLimit,
  checkScopedRateLimit,
  getRateLimitStats,
  resetRateLimit,
  cleanupRateLimiters,
  getSuspiciousPlayers,
} from '~~/server/utils/RateLimiter'

describe('RateLimiter', () => {
  const testPlayerId = 'test_player'

  beforeEach(() => {
    // Clean state before each test
    cleanupRateLimiters()
  })

  afterEach(() => {
    cleanupRateLimiters()
  })

  describe('checkRateLimit', () => {
    it('should allow actions within burst limit', () => {
      // Default config: 10 burst, 5 per second
      for (let i = 0; i < 10; i++) {
        expect(checkRateLimit(testPlayerId)).toBe(true)
      }
    })

    it('should reject actions exceeding burst limit', () => {
      // Exhaust burst
      for (let i = 0; i < 10; i++) {
        checkRateLimit(testPlayerId)
      }

      // Next action should be rejected
      expect(checkRateLimit(testPlayerId)).toBe(false)
    })

    it('should refill tokens over time', () => {
      // Fake timers make this deterministic. The refill rate is exactly 1 token
      // per 200ms (5/sec), so a real `setTimeout(200)` sat *on* the boundary and
      // flaked on CI when the timer fired a hair under 200ms (0.995 < 1 token).
      vi.useFakeTimers()
      try {
        // Exhaust burst
        for (let i = 0; i < 10; i++) {
          checkRateLimit(testPlayerId)
        }
        expect(checkRateLimit(testPlayerId)).toBe(false) // bucket empty

        // Advance comfortably past one refill interval (250ms → 1.25 tokens).
        vi.advanceTimersByTime(250)

        expect(checkRateLimit(testPlayerId)).toBe(true)
      } finally {
        vi.useRealTimers()
      }
    })

    it('should track violations', () => {
      // Exhaust burst
      for (let i = 0; i < 10; i++) {
        checkRateLimit(testPlayerId)
      }

      // Generate violations
      for (let i = 0; i < 5; i++) {
        checkRateLimit(testPlayerId) // Will be rejected
      }

      const stats = getRateLimitStats(testPlayerId)
      expect(stats?.violations).toBe(5)
    })

    it('should handle custom rate limit config', () => {
      const customConfig = {
        maxActionsPerSecond: 2,
        maxBurstSize: 3,
      }

      // Should allow 3 burst
      for (let i = 0; i < 3; i++) {
        expect(checkRateLimit(testPlayerId, customConfig)).toBe(true)
      }

      // 4th should be rejected
      expect(checkRateLimit(testPlayerId, customConfig)).toBe(false)
    })
  })

  describe('getRateLimitStats', () => {
    it('should return null for unknown player', () => {
      expect(getRateLimitStats('unknown_player')).toBeNull()
    })

    it('should return stats for tracked player', () => {
      checkRateLimit(testPlayerId)
      const stats = getRateLimitStats(testPlayerId)

      expect(stats).toMatchObject({
        totalActions: 1,
        violations: 0,
      })
      expect(stats?.tokens).toBeLessThan(10) // Started with 10, used 1
    })
  })

  describe('resetRateLimit', () => {
    it('should remove player from tracking', () => {
      checkRateLimit(testPlayerId)
      resetRateLimit(testPlayerId)
      expect(getRateLimitStats(testPlayerId)).toBeNull()
    })

    it('should allow fresh rate limit after reset', () => {
      // Exhaust burst
      for (let i = 0; i < 10; i++) {
        checkRateLimit(testPlayerId)
      }

      // Reset
      resetRateLimit(testPlayerId)

      // Should have full burst again
      for (let i = 0; i < 10; i++) {
        expect(checkRateLimit(testPlayerId)).toBe(true)
      }
    })
  })

  describe('getSuspiciousPlayers', () => {
    it('should return empty array when no violations', () => {
      checkRateLimit('player1')
      checkRateLimit('player2')
      expect(getSuspiciousPlayers(1)).toEqual([])
    })

    it('should return players exceeding violation threshold', () => {
      // Player 1: 5 violations
      for (let i = 0; i < 15; i++) {
        checkRateLimit('player1')
      }

      // Player 2: 2 violations
      for (let i = 0; i < 12; i++) {
        checkRateLimit('player2')
      }

      // Player 3: 0 violations
      checkRateLimit('player3')

      const suspicious = getSuspiciousPlayers(5)
      expect(suspicious).toHaveLength(1)
      expect(suspicious[0]?.playerId).toBe('player1')
      expect(suspicious[0]?.violations).toBe(5)
    })
  })

  describe('cleanupRateLimiters', () => {
    it('should clear all tracked players', () => {
      checkRateLimit('player1')
      checkRateLimit('player2')
      checkRateLimit('player3')

      cleanupRateLimiters()

      expect(getRateLimitStats('player1')).toBeNull()
      expect(getRateLimitStats('player2')).toBeNull()
      expect(getRateLimitStats('player3')).toBeNull()
    })
  })

  describe('checkScopedRateLimit', () => {
    it('namespaces buckets per scope+key — keys and scopes are independent', () => {
      // lobby burst is 6: exhaust it for userA
      for (let i = 0; i < 6; i++) expect(checkScopedRateLimit('lobby', 'userA')).toBe(true)
      expect(checkScopedRateLimit('lobby', 'userA')).toBe(false)
      // a different key in the same scope has its own bucket
      expect(checkScopedRateLimit('lobby', 'userB')).toBe(true)
      // the same key in a different scope is independent too (namespaced)
      expect(checkScopedRateLimit('queue', 'userA')).toBe(true)
    })

    it('applies each scope’s own burst budget (auth stricter than lobby)', () => {
      // auth burst is 5 (brute-force protection); the 6th is rejected
      for (let i = 0; i < 5; i++) expect(checkScopedRateLimit('auth', 'ip1')).toBe(true)
      expect(checkScopedRateLimit('auth', 'ip1')).toBe(false)
    })

    it('falls back to the default budget for an unknown scope', () => {
      // Unknown scope → DEFAULT_CONFIG (burst 10) rather than a crash.
      const scope = 'mystery' as Parameters<typeof checkScopedRateLimit>[0]
      for (let i = 0; i < 10; i++) expect(checkScopedRateLimit(scope, 'k')).toBe(true)
      expect(checkScopedRateLimit(scope, 'k')).toBe(false)
    })
  })

  describe('stale-state eviction (unbounded-growth backstop)', () => {
    it('evicts long-idle entries once the tracked-key cap is exceeded', () => {
      vi.useFakeTimers()
      try {
        // Fill to the 10k cap; each key is tracked.
        for (let i = 0; i < 10_000; i++) checkRateLimit(`bulk_${i}`)
        expect(getRateLimitStats('bulk_0')).not.toBeNull()

        // Idle past the eviction window, then one more distinct key trips the
        // size>=cap check and sweeps the now-idle entries.
        vi.advanceTimersByTime(11 * 60 * 1000)
        checkRateLimit('trigger')
        expect(getRateLimitStats('bulk_0')).toBeNull()
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('rate-limit escape hatch (rateLimitDisabled)', () => {
    const ENV_KEYS = ['TERMINA_DISABLE_RATE_LIMIT', 'NODE_ENV', 'TERMINA_TEST_HOOKS'] as const
    const saved: Record<string, string | undefined> = {}
    beforeEach(() => {
      for (const k of ENV_KEYS) saved[k] = process.env[k]
    })
    afterEach(() => {
      for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k]
        else process.env[k] = saved[k]
      }
    })

    it('stays ENFORCED in real production even with the disable flag set', () => {
      // The security invariant: the escape hatch must never weaken real prod.
      process.env.TERMINA_DISABLE_RATE_LIMIT = '1'
      process.env.NODE_ENV = 'production'
      delete process.env.TERMINA_TEST_HOOKS
      for (let i = 0; i < 10; i++) checkRateLimit('prod_player') // drain the burst
      expect(checkRateLimit('prod_player')).toBe(false)
    })

    it('disables limits on a non-production server when the flag is set', () => {
      process.env.TERMINA_DISABLE_RATE_LIMIT = '1'
      process.env.NODE_ENV = 'development'
      for (let i = 0; i < 50; i++) expect(checkRateLimit('dev_player')).toBe(true)
    })

    it('disables limits on a prod test-hooks server (e2e preview)', () => {
      process.env.TERMINA_DISABLE_RATE_LIMIT = '1'
      process.env.NODE_ENV = 'production'
      process.env.TERMINA_TEST_HOOKS = '1'
      for (let i = 0; i < 50; i++) expect(checkRateLimit('e2e_player')).toBe(true)
    })
  })
})
