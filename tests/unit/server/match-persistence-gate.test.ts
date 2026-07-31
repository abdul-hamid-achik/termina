import { describe, it, expect } from 'vitest'
import { shouldApplyDerivedMatchStats } from '~~/server/game/engine/matchPersistence'

describe('shouldApplyDerivedMatchStats', () => {
  it('allows MMR/stats only when the match row itself persisted', () => {
    expect(shouldApplyDerivedMatchStats(true)).toBe(true)
  })

  it('blocks derived ladder/stats when match persistence failed', () => {
    expect(shouldApplyDerivedMatchStats(false)).toBe(false)
  })
})
