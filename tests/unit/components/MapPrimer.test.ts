import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import MapPrimer from '../../../app/components/game/MapPrimer.vue'

// Stub the heavy in-game AsciiMap (window/viewport/grid). It only needs to
// surface the props MapPrimer feeds it and re-emit a zoneClick on demand, so we
// can assert MapPrimer's explorer state machine in isolation.
const AsciiMapStub = defineComponent({
  name: 'AsciiMap',
  props: ['zones', 'playerZone', 'ancients'],
  emits: ['zoneClick'],
  template: `<button data-testid="hop" @click="$emit('zoneClick','radiant-base')">hop</button>`,
})

function mountPrimer() {
  return mount(MapPrimer, { global: { stubs: { AsciiMap: AsciiMapStub } } })
}

const caption = (w: ReturnType<typeof mountPrimer>) =>
  w.find('[data-testid="map-primer-caption"]').text().replace(/\s+/g, ' ')

describe('MapPrimer', () => {
  it('starts the explorer at the radiant fountain with its (singular) adjacency', () => {
    const cap = caption(mountPrimer())
    expect(cap).toContain('Radiant Fountain')
    expect(cap).toContain('1 adjacent zone reachable')
  })

  it('hops to an adjacent zone on zoneClick and updates the caption (plural)', async () => {
    const w = mountPrimer()
    await w.find('[data-testid="hop"]').trigger('click')
    const cap = caption(w)
    expect(cap).toContain('Radiant Base')
    expect(cap).toContain('4 adjacent zones reachable')
  })

  it('feeds the selected zone to AsciiMap as the player zone', async () => {
    const w = mountPrimer()
    const map = w.findComponent(AsciiMapStub)
    expect(map.props('playerZone')).toBe('radiant-fountain')
    await w.find('[data-testid="hop"]').trigger('click')
    expect(map.props('playerZone')).toBe('radiant-base')
  })

  it('marks the selected zone as playerHere in the zones it passes down', () => {
    const w = mountPrimer()
    const zones = w.findComponent(AsciiMapStub).props('zones') as {
      id: string
      playerHere: boolean
    }[]
    expect(zones.find((z) => z.id === 'radiant-fountain')!.playerHere).toBe(true)
    expect(zones.find((z) => z.id === 'radiant-base')!.playerHere).toBe(false)
  })
})
