import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import MapPrimer from '~~/app/components/game/MapPrimer.vue'

// Stub the heavy in-game AsciiMap (window/viewport/grid). It only needs to
// surface the props MapPrimer feeds it and re-emit a zoneClick on demand, so we
// can assert MapPrimer's explorer state machine in isolation.
const AsciiMapStub = defineComponent({
  name: 'AsciiMap',
  props: ['zones', 'playerZone', 'ancients'],
  emits: ['zoneClick'],
  template: `<button data-testid="hop" @click="$emit('zoneClick','chaff-base')">hop</button>`,
})

function mountPrimer() {
  return mount(MapPrimer, { global: { stubs: { AsciiMap: AsciiMapStub } } })
}

const caption = (w: ReturnType<typeof mountPrimer>) =>
  w.find('[data-testid="map-primer-caption"]').text().replace(/\s+/g, ' ')

describe('MapPrimer', () => {
  it('starts the explorer at the chaff fountain with its (singular) adjacency', () => {
    const cap = caption(mountPrimer())
    expect(cap).toContain('Rookery Anchor')
    expect(cap).toContain('1 adjacent zone arrives')
  })

  it('hops to an adjacent zone on zoneClick and updates the caption (plural)', async () => {
    const w = mountPrimer()
    await w.find('[data-testid="hop"]').trigger('click')
    const cap = caption(w)
    expect(cap).toContain('Rookery Terminal')
    expect(cap).toContain('4 adjacent zones arrive')
  })

  it('feeds the selected zone to AsciiMap as the player zone', async () => {
    const w = mountPrimer()
    const map = w.findComponent(AsciiMapStub)
    expect(map.props('playerZone')).toBe('chaff-fountain')
    await w.find('[data-testid="hop"]').trigger('click')
    expect(map.props('playerZone')).toBe('chaff-base')
  })

  it('sizes the map frame to the viewport instead of a fixed half-map box', () => {
    // REGRESSION: a hard h-[460px] around a ~740px grid (+ header, legend and
    // orientation labels) cut /learn's map in half — a new player saw the
    // Chaff side and nothing below the river.
    const frame = mountPrimer().find('[data-testid="map-primer-frame"]')
    expect(frame.classes().some((c) => c.startsWith('h-[min('))).toBe(true)
    expect(frame.classes().some((c) => /^h-\[\d+px\]$/.test(c))).toBe(false)
  })

  it('marks the selected zone as playerHere in the zones it passes down', () => {
    const w = mountPrimer()
    const zones = w.findComponent(AsciiMapStub).props('zones') as {
      id: string
      playerHere: boolean
    }[]
    expect(zones.find((z) => z.id === 'chaff-fountain')!.playerHere).toBe(true)
    expect(zones.find((z) => z.id === 'chaff-base')!.playerHere).toBe(false)
  })
})
