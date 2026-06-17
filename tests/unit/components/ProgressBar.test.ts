import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ProgressBar from '../../../app/components/ui/ProgressBar.vue'

const FILLED = '█'
const EMPTY = '░'

/**
 * The █/░ bar lives in the span with the tight `tracking-[-0.05em]` class
 * (the surrounding spans are the outer wrapper and the `[` / `]` brackets).
 */
function barText(wrapper: ReturnType<typeof mount>): string {
  return wrapper.find('span.tracking-\\[-0\\.05em\\]').text()
}

function mountBar(props: Record<string, unknown>) {
  return mount(ProgressBar, { props })
}

describe('ProgressBar', () => {
  it('renders a full bar of the requested width at 100%', () => {
    const wrapper = mountBar({ value: 100, max: 100, width: 20 })

    const bar = barText(wrapper)
    expect(bar).toBe(FILLED.repeat(20))
    expect(bar.length).toBe(20)
  })

  it('renders an empty bar at 0%', () => {
    const wrapper = mountBar({ value: 0, max: 100, width: 20 })

    expect(barText(wrapper)).toBe(EMPTY.repeat(20))
  })

  it('splits filled/empty proportionally at the half-way point', () => {
    const wrapper = mountBar({ value: 50, max: 100, width: 20 })

    const bar = barText(wrapper)
    expect(bar).toBe(FILLED.repeat(10) + EMPTY.repeat(10))
    // total width is always preserved
    expect(bar.length).toBe(20)
  })

  it('honours a custom width', () => {
    const wrapper = mountBar({ value: 100, max: 100, width: 8 })

    expect(barText(wrapper)).toBe(FILLED.repeat(8))
  })

  it('respects a non-100 max when computing the fill ratio', () => {
    // 300/600 = 50% of a width-10 bar => 5 filled
    const wrapper = mountBar({ value: 300, max: 600, width: 10 })

    expect(barText(wrapper)).toBe(FILLED.repeat(5) + EMPTY.repeat(5))
  })

  it('clamps an over-max value to a full bar', () => {
    const wrapper = mountBar({ value: 250, max: 100, width: 10 })

    expect(barText(wrapper)).toBe(FILLED.repeat(10))
  })

  it('clamps a negative value to an empty bar', () => {
    const wrapper = mountBar({ value: -50, max: 100, width: 10 })

    expect(barText(wrapper)).toBe(EMPTY.repeat(10))
  })

  describe('label', () => {
    it('is hidden by default', () => {
      const wrapper = mountBar({ value: 50, max: 100 })

      // no "value/max" text rendered
      expect(wrapper.text()).not.toContain('50/100')
    })

    it('shows value/max and the rounded percentage when enabled', () => {
      const wrapper = mountBar({ value: 30, max: 120, showLabel: true })

      const text = wrapper.text()
      expect(text).toContain('30/120')
      expect(text).toContain('25%') // 30/120 = 25%
    })
  })

  describe('color', () => {
    // NOTE: the component sets `color: rgb(var(--color-<x>, <x>))` inline.
    // happy-dom rejects that as an invalid CSS value and drops the style attr,
    // so we can't assert on the inline style; instead we assert the color prop
    // is accepted and never changes the bar geometry (it's purely cosmetic).
    it('accepts a custom color without altering the bar glyphs', () => {
      const wrapper = mountBar({ value: 50, max: 100, width: 20, color: 'dire' })

      expect(barText(wrapper)).toBe(FILLED.repeat(10) + EMPTY.repeat(10))
    })

    it('renders identically regardless of the color prop', () => {
      const a = barText(mountBar({ value: 30, max: 100, width: 10, color: 'radiant' }))
      const b = barText(mountBar({ value: 30, max: 100, width: 10, color: 'gold' }))

      expect(a).toBe(b)
    })
  })

  describe('danger threshold', () => {
    const span = (w: ReturnType<typeof mount>) => w.find('span.tracking-\\[-0\\.05em\\]')

    it('flags danger at/below the threshold while alive', () => {
      const w = mountBar({ value: 100, max: 620, dangerBelow: 0.25 }) // ~16% < 25%
      expect(span(w).attributes('data-danger')).toBe('true')
      expect(span(w).classes()).toContain('animate-pulse')
    })

    it('treats the exact boundary as danger (<=)', () => {
      const w = mountBar({ value: 155, max: 620, dangerBelow: 0.25 }) // exactly 25%
      expect(span(w).attributes('data-danger')).toBe('true')
    })

    it('does NOT flag danger above the threshold', () => {
      const w = mountBar({ value: 500, max: 620, dangerBelow: 0.25 }) // ~80%
      expect(span(w).attributes('data-danger')).toBeUndefined()
      expect(span(w).classes()).not.toContain('animate-pulse')
    })

    it('does NOT flag danger at 0 (dead, not "about to die")', () => {
      const w = mountBar({ value: 0, max: 620, dangerBelow: 0.25 })
      expect(span(w).attributes('data-danger')).toBeUndefined()
    })

    it('is off by default even at a very low fill', () => {
      const w = mountBar({ value: 10, max: 620 }) // low, but no dangerBelow set
      expect(span(w).attributes('data-danger')).toBeUndefined()
    })
  })
})
