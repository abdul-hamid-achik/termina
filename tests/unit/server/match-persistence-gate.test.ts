import { describe, it, expect } from 'vitest'
import { shouldApplyDerivedMatchStats } from '~~/server/game/engine/matchPersistence'

describe('shouldApplyDerivedMatchStats', () => {
  it('allows a newly inserted match to claim derived stats', () => {
    expect(shouldApplyDerivedMatchStats('inserted')).toBe(true)
  })

  it('allows an idempotent match retry to attempt the atomic claim', () => {
    expect(shouldApplyDerivedMatchStats('already_exists')).toBe(true)
  })

  it('blocks derived ladder/stats when match persistence failed', () => {
    expect(shouldApplyDerivedMatchStats('failed')).toBe(false)
  })
})
