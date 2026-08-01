import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import MapPrimer from '~~/app/components/game/MapPrimer.vue'

// Stub the trace rail — the primer's state machine is what we assert (the
// selected zone, the adjacency list, the caption), not the trace itself.
const TraceRailStub = defineComponent({
  name: 'TraceRail',
  props: ['trace'],
  template: '<div data-testid="trace-rail-stub" />',
})

function mountPrimer() {
  return mount(MapPrimer, { global: { stubs: { TraceRail: TraceRailStub } } })
}

const caption = (w: ReturnType<typeof mountPrimer>) =>
  w.find('[data-testid="map-primer-caption"]').text().replace(/\s+/g, ' ')

describe('MapPrimer', () => {
  it('starts the explorer at the chaff fountain with its (singular) adjacency', () => {
    const cap = caption(mountPrimer())
    expect(cap).toContain('Rookery Anchor')
    expect(cap).toContain('1 adjacent zone arrives')
  })

  it('lists the adjacent zones as clickable hops and moves the explorer on click', async () => {
    const w = mountPrimer()
    // rookery-anchor is adjacent only to rookery-terminal.
    const hop = w.find('[data-testid="primer-zone-rookery-terminal"]')
    expect(hop.exists()).toBe(true)
    await hop.trigger('click')
    const cap = caption(w)
    expect(cap).toContain('Rookery Terminal')
    expect(cap).toContain('4 adjacent zones arrive')
  })

  it('renders the trace rail for the selected zone', async () => {
    const w = mountPrimer()
    expect(w.find('[data-testid="trace-rail-stub"]').exists()).toBe(true)
  })

  it('every zone in the topology is clickable in the grouped index', async () => {
    const w = mountPrimer()
    await w.find('[data-testid="primer-all-hollow"]').trigger('click')
    const cap = caption(w)
    expect(cap).toContain('The Hollow')
  })
})
