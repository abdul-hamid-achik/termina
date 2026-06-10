import { describe, it, expect } from 'vitest'
import {
  expectedScore,
  calculateMmrChange,
  applyMmrChange,
  teamAverageMmr,
} from '../../../server/game/matchmaking/elo'

describe('Elo rating', () => {
  describe('expectedScore', () => {
    it('is 0.5 for equal ratings', () => {
      expect(expectedScore(1000, 1000)).toBeCloseTo(0.5)
    })

    it('is ~0.76 with a 200-point advantage', () => {
      expect(expectedScore(1200, 1000)).toBeCloseTo(0.76, 2)
    })

    it('is symmetric', () => {
      expect(expectedScore(1200, 1000) + expectedScore(1000, 1200)).toBeCloseTo(1)
    })
  })

  describe('calculateMmrChange', () => {
    it('awards +16 for a win between equals', () => {
      expect(calculateMmrChange(1000, 1000, true)).toBe(16)
    })

    it('costs -16 for a loss between equals', () => {
      expect(calculateMmrChange(1000, 1000, false)).toBe(-16)
    })

    it('pays more for beating a stronger team', () => {
      const upset = calculateMmrChange(1000, 1300, true)
      const expected = calculateMmrChange(1000, 1000, true)
      expect(upset).toBeGreaterThan(expected)
    })

    it('costs more for losing to a weaker team', () => {
      const badLoss = calculateMmrChange(1300, 1000, false)
      const normalLoss = calculateMmrChange(1000, 1000, false)
      expect(badLoss).toBeLessThan(normalLoss)
    })

    it('win and loss changes are bounded by K (32)', () => {
      expect(calculateMmrChange(0, 3000, true)).toBeLessThanOrEqual(32)
      expect(calculateMmrChange(3000, 0, false)).toBeGreaterThanOrEqual(-32)
    })

    it('a heavy favorite gains almost nothing from winning', () => {
      expect(calculateMmrChange(2000, 1000, true)).toBeLessThanOrEqual(1)
    })
  })

  describe('applyMmrChange', () => {
    it('applies the delta', () => {
      expect(applyMmrChange(1000, 16)).toBe(1016)
    })

    it('never goes below zero', () => {
      expect(applyMmrChange(10, -32)).toBe(0)
    })
  })

  describe('teamAverageMmr', () => {
    it('averages ratings', () => {
      expect(teamAverageMmr([900, 1000, 1100])).toBe(1000)
    })

    it('defaults to 1000 for an empty team', () => {
      expect(teamAverageMmr([])).toBe(1000)
    })
  })
})
