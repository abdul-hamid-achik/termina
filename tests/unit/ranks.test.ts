import { describe, it, expect } from 'vitest'
import { getRankTier, RANK_TIERS } from '~~/shared/constants/ranks'

describe('getRankTier', () => {
  it('returns the lowest tier for very low MMR', () => {
    expect(getRankTier(0).id).toBe('iron')
    expect(getRankTier(500).id).toBe('iron')
  })

  it('returns silver at the 1000 baseline (season start)', () => {
    expect(getRankTier(1000).id).toBe('silver')
  })

  it('climbs tiers as MMR increases', () => {
    expect(getRankTier(700).id).toBe('bronze')
    expect(getRankTier(1300).id).toBe('scrip')
    expect(getRankTier(1600).id).toBe('platinum')
    expect(getRankTier(1900).id).toBe('diamond')
    expect(getRankTier(2200).id).toBe('terminal')
    expect(getRankTier(3000).id).toBe('terminal')
  })

  it('uses inclusive lower bounds (exactly at a threshold lands in that tier)', () => {
    for (const tier of RANK_TIERS) {
      expect(getRankTier(tier.minMmr).id).toBe(tier.id)
    }
  })

  it('exposes a display name for every tier', () => {
    for (const tier of RANK_TIERS) {
      expect(tier.name.length).toBeGreaterThan(0)
    }
  })
})
