import { describe, it, expect } from 'vitest'
import { arrowTargetZone } from '../../../app/utils/arrowMove'

describe('arrowTargetZone', () => {
  it('Up picks the radiant-side adjacent zone', () => {
    expect(arrowTargetZone('ArrowUp', ['mid-river', 'mid-t2-rad', 'mid-t2-dire'])).toBe(
      'mid-t2-rad',
    )
    expect(arrowTargetZone('ArrowUp', ['radiant-base', 'mid-t3-rad'])).toBe('radiant-base')
  })

  it('Down picks the dire-side adjacent zone', () => {
    expect(arrowTargetZone('ArrowDown', ['mid-river', 'mid-t2-rad', 'mid-t2-dire'])).toBe(
      'mid-t2-dire',
    )
    expect(arrowTargetZone('ArrowDown', ['dire-fountain', 'dire-base'])).toBe('dire-fountain')
  })

  it('Left picks a top-lane / radiant-jungle adjacent zone', () => {
    expect(arrowTargetZone('ArrowLeft', ['mid-river', 'top-t1-rad', 'bot-t1-dire'])).toBe(
      'top-t1-rad',
    )
    expect(arrowTargetZone('ArrowLeft', ['jungle-rad-1', 'mid-river'])).toBe('jungle-rad-1')
  })

  it('Right picks a bot-lane / dire-jungle adjacent zone', () => {
    expect(arrowTargetZone('ArrowRight', ['mid-river', 'top-t1-rad', 'bot-t1-dire'])).toBe(
      'bot-t1-dire',
    )
    expect(arrowTargetZone('ArrowRight', ['jungle-dire-2', 'mid-river'])).toBe('jungle-dire-2')
  })

  it('returns null when no adjacent zone lies in the pressed direction (no blind fallback)', () => {
    // no 'rad' substring among these → Up finds nothing
    expect(arrowTargetZone('ArrowUp', ['mid-river', 'bot-t1-dire'])).toBe(null)
    expect(arrowTargetZone('ArrowLeft', ['mid-river'])).toBe(null)
    expect(arrowTargetZone('ArrowRight', [])).toBe(null)
  })

  it('matches "rad"/"dire" as a substring (greedy) — preserving the original heuristic', () => {
    // a radiant jungle zone contains 'rad', so Up will pick it up too
    expect(arrowTargetZone('ArrowUp', ['mid-river', 'jungle-rad-1'])).toBe('jungle-rad-1')
  })
})
