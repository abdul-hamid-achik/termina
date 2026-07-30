import { describe, it, expect } from 'vitest'
import { POSTURE_META, POSTURE_ORDER } from '~~/shared/constants/postures'
import type { HeroPosture } from '~~/shared/types/hero'

const ALL_POSTURES: HeroPosture[] = ['BREACH', 'HOLD', 'ROAM', 'HARDLINE']

describe('postures', () => {
  it('every HeroPosture has display metadata with a non-empty blurb', () => {
    for (const p of ALL_POSTURES) {
      expect(POSTURE_META[p]).toBeDefined()
      expect(POSTURE_META[p].label.length).toBeGreaterThan(0)
      expect(POSTURE_META[p].blurb.length).toBeGreaterThan(0)
    }
  })

  it('POSTURE_ORDER covers the union exactly once', () => {
    expect([...POSTURE_ORDER].sort()).toEqual([...ALL_POSTURES].sort())
    expect(new Set(POSTURE_ORDER).size).toBe(POSTURE_ORDER.length)
  })
})
