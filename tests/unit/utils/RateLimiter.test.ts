import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  checkRateLimit,
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

    it('should refill tokens over time', async () => {
      // Exhaust burst
      for (let i = 0; i < 10; i++) {
        checkRateLimit(testPlayerId)
      }

      // Wait 200ms (should refill 1 token at 5/sec rate)
      await new Promise((resolve) => setTimeout(resolve, 200))

      // Should have at least 1 token
      expect(checkRateLimit(testPlayerId)).toBe(true)
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
})
