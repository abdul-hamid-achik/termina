import { describe, it, expect, beforeEach } from 'vitest'
import {
  escalateRejection,
  clearRejectionEscalation,
} from '~~/server/game/engine/rejectionEscalation'

describe('rejectionEscalation (server)', () => {
  beforeEach(() => clearRejectionEscalation('game-a'))
  beforeEach(() => clearRejectionEscalation('game-b'))

  it('passes the first two identical rejections through unchanged', () => {
    const msg = 'No cache in this zone to grab'
    expect(escalateRejection('game-a', undefined, 'p1', msg)).toBe(msg)
    expect(escalateRejection('game-a', undefined, 'p1', msg)).toBe(msg)
  })

  it('appends a help pointer on the THIRD identical rejection per player', () => {
    const msg = 'No cache in this zone to grab'
    escalateRejection('game-a', undefined, 'p1', msg)
    escalateRejection('game-a', undefined, 'p1', msg)
    expect(escalateRejection('game-a', undefined, 'p1', msg)).toContain('help')
    // Another player failing the same way starts their own count.
    expect(escalateRejection('game-a', undefined, 'p2', msg)).toBe(msg)
  })

  it('scopes counters per game — a new match starts clean', () => {
    const msg = 'No cache in this zone to grab'
    escalateRejection('game-a', undefined, 'p1', msg)
    escalateRejection('game-a', undefined, 'p1', msg)
    expect(escalateRejection('game-b', undefined, 'p1', msg)).toBe(msg)
  })

  it('never escalates tutorial lock messages (they are teaching, not failure)', () => {
    const msg = '🎓 Move to a lane to unlock attack'
    escalateRejection('game-t', 'tutorial', 'p1', msg)
    escalateRejection('game-t', 'tutorial', 'p1', msg)
    expect(escalateRejection('game-t', 'tutorial', 'p1', msg)).toBe(msg)
  })

  it('clearRejectionEscalation drops only the given game', () => {
    const msg = 'No cache in this zone to grab'
    escalateRejection('game-a', undefined, 'p1', msg)
    escalateRejection('game-a', undefined, 'p1', msg)
    escalateRejection('game-b', undefined, 'p1', msg)
    escalateRejection('game-b', undefined, 'p1', msg)
    clearRejectionEscalation('game-a')
    expect(escalateRejection('game-a', undefined, 'p1', msg)).toBe(msg)
    expect(escalateRejection('game-b', undefined, 'p1', msg)).toContain('help')
  })
})
