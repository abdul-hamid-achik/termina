import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import MapLegend from '~~/app/components/game/MapLegend.vue'

describe('MapLegend', () => {
  it('renders a collapsible "legend" summary', () => {
    const w = mount(MapLegend)
    const details = w.get('[data-testid="map-legend"]')
    expect(details.find('summary').text().toLowerCase()).toContain('legend')
    // closed by default — no `open` attribute
    expect(details.attributes('open')).toBeUndefined()
  })

  it('opens when the open prop is set', () => {
    const w = mount(MapLegend, { props: { open: true } })
    expect(w.get('[data-testid="map-legend"]').attributes('open')).toBeDefined()
  })

  it('decodes the key map glyphs with their meanings', () => {
    const text = mount(MapLegend, { props: { open: true } }).text()
    expect(text).toContain('►YOU')
    expect(text).toContain('your hero')
    expect(text).toContain('◉')
    expect(text).toContain('your ward')
    expect(text).toContain('✦')
    expect(text).toContain('live rune')
    expect(text).toContain('Roshan respawn')
  })

  it('decodes the mini-overview zone codes', () => {
    const text = mount(MapLegend, { props: { open: true } }).text()
    expect(text).toContain('T1-3')
    expect(text).toContain('tower zones')
    expect(text).toContain('JG')
    expect(text).toContain('jungle')
    expect(text).toContain('RN')
    expect(text).toContain('rune spot')
    expect(text).toContain('ROS')
    expect(text).toContain('Roshan pit')
    expect(text).toContain('RF/RB')
    expect(text).toContain('fountain / base')
    expect(text).toContain('TR/MR/BR')
    expect(text).toContain('river crossings')
  })
})
