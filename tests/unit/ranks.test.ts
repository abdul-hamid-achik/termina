import { describe, it, expect } from 'vitest'
import { getRankTier, RANK_TIERS, PLACEMENT_GAMES } from '~~/shared/constants/ranks'

/**
 * These used to spell the whole ladder out (`toBe('iron')`, `toBe('silver')`,
 * `toBe('diamond')`), so renaming the tiers broke five assertions that were not
 * actually guarding anything about the ladder's behaviour. What matters is the
 * SHAPE: ordered, inclusive lower bounds, a baseline that lands somewhere real,
 * and no two tiers claiming the same ground. The names themselves are content.
 */
describe('getRankTier', () => {
  const first = RANK_TIERS[0]!
  const last = RANK_TIERS[RANK_TIERS.length - 1]!

  it('starts at zero so no rating is unrankable', () => {
    expect(first.minMmr).toBe(0)
    expect(getRankTier(0).id).toBe(first.id)
    expect(getRankTier(-500).id).toBe(first.id)
  })

  it('is strictly ascending — each tier starts above the last', () => {
    for (let i = 1; i < RANK_TIERS.length; i++) {
      expect(
        RANK_TIERS[i]!.minMmr,
        `${RANK_TIERS[i]!.id} does not start above ${RANK_TIERS[i - 1]!.id}`,
      ).toBeGreaterThan(RANK_TIERS[i - 1]!.minMmr)
    }
  })

  it('uses inclusive lower bounds (exactly at a threshold lands in that tier)', () => {
    for (const tier of RANK_TIERS) {
      expect(getRankTier(tier.minMmr).id).toBe(tier.id)
    }
  })

  it('lands one below the threshold in the previous tier', () => {
    for (let i = 1; i < RANK_TIERS.length; i++) {
      expect(getRankTier(RANK_TIERS[i]!.minMmr - 1).id).toBe(RANK_TIERS[i - 1]!.id)
    }
  })

  it('never climbs as rating falls', () => {
    let seen = -1
    for (let mmr = 0; mmr <= 3000; mmr += 25) {
      const idx = RANK_TIERS.findIndex((t) => t.id === getRankTier(mmr).id)
      expect(idx).toBeGreaterThanOrEqual(seen)
      seen = idx
    }
  })

  it('tops out — a rating past the last threshold stays in the last tier', () => {
    expect(getRankTier(last.minMmr).id).toBe(last.id)
    expect(getRankTier(last.minMmr + 5000).id).toBe(last.id)
  })

  it('puts the 1000 season baseline in the middle of the ladder, not at an end', () => {
    // A new account must have room to fall as well as climb.
    const idx = RANK_TIERS.findIndex((t) => t.id === getRankTier(1000).id)
    expect(idx).toBeGreaterThan(0)
    expect(idx).toBeLessThan(RANK_TIERS.length - 1)
  })

  it('every tier has a unique id and a non-empty display name', () => {
    expect(new Set(RANK_TIERS.map((t) => t.id)).size).toBe(RANK_TIERS.length)
    expect(new Set(RANK_TIERS.map((t) => t.name)).size).toBe(RANK_TIERS.length)
    for (const tier of RANK_TIERS) {
      expect(tier.name.trim().length, `${tier.id} has no display name`).toBeGreaterThan(0)
    }
  })

  // The id/name pair drifted once already: the currency sweep renamed the Gold
  // tier's id to `scrip` and left its label reading "Gold", so the two disagreed.
  it('every tier id is the kebab-case of its display name', () => {
    for (const tier of RANK_TIERS) {
      const expected = tier.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
      expect(tier.id, `${tier.id} is not the kebab-case of "${tier.name}"`).toBe(expected)
    }
  })

  it('requires placement games before a player is ranked at all', () => {
    expect(PLACEMENT_GAMES).toBeGreaterThan(0)
  })
})
