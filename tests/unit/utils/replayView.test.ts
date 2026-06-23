import { describe, it, expect } from 'vitest'
import {
  formatReplayCommand,
  clampFrameIndex,
  nextScrubTick,
  keyMoments,
  type ReplayFrameLite,
} from '../../../app/utils/replayView'

// Build a frame stream from per-tick cumulative [radiantKills, direKills,
// radiantTowers, direTowers] tuples — terse fixtures for the delta logic.
function frames(rows: Array<[number, number, number, number, number]>): ReplayFrameLite[] {
  return rows.map(([tick, rk, dk, rt, dt]) => ({
    tick,
    teams: { radiant: { kills: rk, towerKills: rt }, dire: { kills: dk, towerKills: dt } },
  }))
}

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

describe('nextScrubTick', () => {
  it('advances one tick', () => {
    expect(nextScrubTick(0, 100)).toBe(1)
    expect(nextScrubTick(41, 100)).toBe(42)
  })
  it('caps at the final tick (playback stalls there)', () => {
    expect(nextScrubTick(100, 100)).toBe(100)
    expect(nextScrubTick(99, 100)).toBe(100)
  })
  it('is 0 for an empty replay', () => {
    expect(nextScrubTick(0, 0)).toBe(0)
  })
})

describe('keyMoments', () => {
  it('returns nothing for an eventless replay', () => {
    expect(
      keyMoments(
        frames([
          [0, 0, 0, 0, 0],
          [10, 0, 0, 0, 0],
        ]),
      ),
    ).toEqual([])
    expect(keyMoments([])).toEqual([])
  })

  it('marks a single kill as a Kill', () => {
    const m = keyMoments(
      frames([
        [0, 0, 0, 0, 0],
        [5, 1, 0, 0, 0],
      ]),
    )
    expect(m).toEqual([{ tick: 5, kind: 'fight', label: 'Kill' }])
  })

  it('coalesces a run of kills into one Fight tallying the kills', () => {
    // kills at ticks 5,6,7 (within the default gap) → one Fight ×3 at tick 5
    const m = keyMoments(
      frames([
        [0, 0, 0, 0, 0],
        [5, 1, 0, 0, 0],
        [6, 1, 1, 0, 0],
        [7, 2, 1, 0, 0],
      ]),
    )
    expect(m).toEqual([{ tick: 5, kind: 'fight', label: 'Fight ×3' }])
  })

  it('splits kills separated by a long lull into distinct fights', () => {
    const m = keyMoments(
      frames([
        [0, 0, 0, 0, 0],
        [5, 1, 0, 0, 0],
        [40, 2, 0, 0, 0], // 35-tick gap → a new fight
      ]),
    )
    expect(m).toEqual([
      { tick: 5, kind: 'fight', label: 'Kill' },
      { tick: 40, kind: 'fight', label: 'Kill' },
    ])
  })

  it('marks tower falls as their own beat, in chronological order', () => {
    const m = keyMoments(
      frames([
        [0, 0, 0, 0, 0],
        [5, 1, 0, 0, 0], // kill
        [12, 1, 0, 1, 0], // radiant takes a dire tower
      ]),
    )
    expect(m).toEqual([
      { tick: 5, kind: 'fight', label: 'Kill' },
      { tick: 12, kind: 'tower', label: 'Tower' },
    ])
  })
})
