import { describe, it, expect } from 'vitest'
import { computeThreat, threatToneClass, recommendAction } from '../../../app/utils/tactics'
import type { ZoneThreat } from '../../../app/utils/tactics'

describe('computeThreat', () => {
  it('is CLEAR with no enemies and no enemy tower', () => {
    expect(computeThreat(0, 1, false)).toEqual({ label: 'CLEAR', tone: 'safe' })
  })

  it('is TOWER (warn) with no enemy heroes but an enemy tower present', () => {
    expect(computeThreat(0, 1, true)).toEqual({ label: 'TOWER', tone: 'warn' })
  })

  it('is DANGER when enemies outnumber the allied headcount', () => {
    expect(computeThreat(2, 1, false)).toEqual({ label: 'DANGER', tone: 'danger' })
  })

  it('is CONTESTED when enemies equal the allied headcount', () => {
    expect(computeThreat(1, 1, false)).toEqual({ label: 'CONTESTED', tone: 'warn' })
    expect(computeThreat(2, 2, false)).toEqual({ label: 'CONTESTED', tone: 'warn' })
  })

  it('is FAVORED when allies outnumber enemies', () => {
    expect(computeThreat(1, 2, false)).toEqual({ label: 'FAVORED', tone: 'safe' })
  })

  it('ignores an enemy tower once enemy heroes are present (heroes drive the verdict)', () => {
    expect(computeThreat(2, 1, true)).toEqual({ label: 'DANGER', tone: 'danger' })
  })
})

describe('threatToneClass', () => {
  it('maps each tone to its color class', () => {
    expect(threatToneClass('danger')).toBe('text-dire')
    expect(threatToneClass('warn')).toBe('text-gold')
    expect(threatToneClass('safe')).toBe('text-radiant')
  })
})

describe('recommendAction', () => {
  const threat = (label: ZoneThreat['label']): ZoneThreat => ({
    label,
    tone:
      label === 'DANGER' ? 'danger' : label === 'CLEAR' || label === 'FAVORED' ? 'safe' : 'warn',
  })

  it('prioritises being dead above everything', () => {
    const r = recommendAction({
      alive: false,
      hpFraction: 1,
      threat: threat('FAVORED'),
      hasReadyAbility: true,
    })
    expect(r).toContain('Dead')
  })

  it('prioritises low HP over the threat verdict (when alive)', () => {
    const r = recommendAction({
      alive: true,
      hpFraction: 0.25,
      threat: threat('FAVORED'),
      hasReadyAbility: true,
    })
    expect(r).toContain('Low HP')
  })

  it('advises retreat when outnumbered', () => {
    const r = recommendAction({
      alive: true,
      hpFraction: 1,
      threat: threat('DANGER'),
      hasReadyAbility: false,
    })
    expect(r).toContain('retreat')
  })

  it('mentions an ability in a contested fight only when one is ready', () => {
    const ready = recommendAction({
      alive: true,
      hpFraction: 1,
      threat: threat('CONTESTED'),
      hasReadyAbility: true,
    })
    const notReady = recommendAction({
      alive: true,
      hpFraction: 1,
      threat: threat('CONTESTED'),
      hasReadyAbility: false,
    })
    expect(ready).toContain('ability')
    expect(notReady).not.toContain('ability')
  })

  it('encourages pressing the advantage when favored', () => {
    const r = recommendAction({
      alive: true,
      hpFraction: 0.9,
      threat: threat('FAVORED'),
      hasReadyAbility: true,
    })
    expect(r).toContain('advantage')
  })

  it('falls back to farm/push/rotate when clear', () => {
    const r = recommendAction({
      alive: true,
      hpFraction: 1,
      threat: threat('CLEAR'),
      hasReadyAbility: true,
    })
    expect(r.toLowerCase()).toContain('farm')
  })
})
