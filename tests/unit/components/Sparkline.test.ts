import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import Sparkline from '../../../app/components/game/Sparkline.vue'

describe('Sparkline', () => {
  it('renders a sparkline for a rising series', () => {
    const w = mount(Sparkline, { props: { values: [1, 2, 3, 4] } })
    const text = w.get('[data-testid="sparkline"]').text()
    expect(text).toHaveLength(4)
    expect(text.at(-1)).toBe('█')
  })

  it('renders nothing for an empty series', () => {
    const w = mount(Sparkline, { props: { values: [] } })
    expect(w.get('[data-testid="sparkline"]').text()).toBe('')
  })

  it('renders the series regardless of the colour variable', () => {
    // (happy-dom drops rgb(var(--x)) from the serialized style attribute, so we
    // assert on the rendered series rather than the cosmetic colour.)
    const w = mount(Sparkline, { props: { values: [3, 1, 4, 1, 5], colorVar: 'color-dire' } })
    expect(w.get('[data-testid="sparkline"]').text()).toHaveLength(5)
  })
})
