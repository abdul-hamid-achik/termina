import { describe, it, expect } from 'vitest'
import { formatReplayCommand, clampFrameIndex } from '../../../app/utils/replayView'

describe('formatReplayCommand', () => {
  it('formats movement with the destination zone', () => {
    expect(formatReplayCommand({ type: 'move', zone: 'mid_river' })).toBe('move → mid_river')
    expect(formatReplayCommand({ type: 'move' })).toBe('move → ?')
  })

  it('formats an attack with target kind + id (and trims when partial)', () => {
    expect(formatReplayCommand({ type: 'attack', target: { kind: 'hero', id: 'echo' } })).toBe(
      'attack hero echo',
    )
    // Missing target shouldn't leave dangling whitespace
    expect(formatReplayCommand({ type: 'attack' })).toBe('attack')
  })

  it('formats cast / buy / sell with their subject', () => {
    expect(formatReplayCommand({ type: 'cast', ability: 'phase_shift' })).toBe('cast phase_shift')
    expect(formatReplayCommand({ type: 'buy', item: 'blink_dagger' })).toBe('buy blink_dagger')
    expect(formatReplayCommand({ type: 'sell', item: 'boots' })).toBe('sell boots')
  })

  it('formats the special single-word + parameterised commands', () => {
    expect(formatReplayCommand({ type: 'buyback' })).toBe('buyback')
    expect(formatReplayCommand({ type: 'surrender', vote: 'yes' })).toBe('surrender (yes)')
    expect(formatReplayCommand({ type: 'select_talent', tier: 2 })).toBe('talent tier2')
    expect(formatReplayCommand({ type: 'place_ward', kind: 'observer', zone: 'top_jungle' })).toBe(
      'ward observer @ top_jungle',
    )
  })

  it('falls back to the bare command type for unknown commands (no raw JSON)', () => {
    expect(formatReplayCommand({ type: 'teleport', zone: 'base' })).toBe('teleport')
    expect(formatReplayCommand({ type: 'whatever' })).toBe('whatever')
  })
})

describe('clampFrameIndex', () => {
  it('returns -1 when there are no frames', () => {
    expect(clampFrameIndex(0, 0)).toBe(-1)
    expect(clampFrameIndex(0, 5)).toBe(-1)
  })

  it('pins a scrub past the end to the last frame', () => {
    expect(clampFrameIndex(10, 99)).toBe(9)
    expect(clampFrameIndex(10, 10)).toBe(9)
  })

  it('pins a negative scrub to the first frame', () => {
    expect(clampFrameIndex(10, -3)).toBe(0)
  })

  it('returns the scrub index when in range', () => {
    expect(clampFrameIndex(10, 0)).toBe(0)
    expect(clampFrameIndex(10, 4)).toBe(4)
    expect(clampFrameIndex(10, 9)).toBe(9)
  })
})
