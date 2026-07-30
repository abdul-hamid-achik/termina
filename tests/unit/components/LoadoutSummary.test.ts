import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import LoadoutSummary from '~~/app/components/items/LoadoutSummary.vue'
import type { ItemDef } from '~~/shared/types/items'

const bulwark_plate: ItemDef = {
  id: 'bulwark_plate',
  name: 'Bulwark Plate',
  cost: 2500,
  stats: { integ: 250, plate: 5 },
  consumable: false,
  passive: { id: 'p', name: 'Damage Block', description: 'Block damage.' },
}
const burnout: ItemDef = {
  id: 'burnout',
  name: 'Burnout',
  cost: 2750,
  stats: { bw: 150, attack: 15 },
  consumable: false,
  active: { id: 'a', name: 'Energy Burst', description: 'Nuke.', cooldownTicks: 18 },
}

function mountSummary(items: ItemDef[] = [], maxSlots = 6) {
  return mount(LoadoutSummary, { props: { items, maxSlots } })
}

describe('LoadoutSummary', () => {
  it('shows an empty prompt and zero cost with no items', () => {
    const wrapper = mountSummary([])
    expect(wrapper.find('[data-testid="loadout-slots"]').text()).toBe('0 / 6')
    expect(wrapper.find('[data-testid="loadout-cost"]').text()).toBe('0sc')
    expect(wrapper.text()).toContain('Pick items')
    // no clear button when empty
    expect(wrapper.find('[data-testid="loadout-clear"]').exists()).toBe(false)
    // the last-hits economy cue only shows once there's a build
    expect(wrapper.find('[data-testid="loadout-lasthits"]').exists()).toBe(false)
  })

  it('shows the ≈ last-hits economy cue for a build (cost / avg wave bounty)', () => {
    const wrapper = mountSummary([bulwark_plate, burnout]) // 5250g → ceil(5250/40) = 132
    const lh = wrapper.find('[data-testid="loadout-lasthits"]')
    expect(lh.exists()).toBe(true)
    expect(lh.text()).toContain('132')
  })

  it('aggregates cost, stats and slot count across the build', () => {
    const wrapper = mountSummary([bulwark_plate, burnout])
    expect(wrapper.find('[data-testid="loadout-slots"]').text()).toBe('2 / 6')
    expect(wrapper.find('[data-testid="loadout-cost"]').text()).toBe('5250sc') // 2500 + 2750
    const text = wrapper.text()
    expect(text).toContain('+250 INTEG')
    expect(text).toContain('+150 BW')
    expect(text).toContain('+15 Attack')
    expect(text).toContain('+5 Plate')
  })

  it('lists only the actives the build grants (passive-only items excluded)', () => {
    const wrapper = mountSummary([bulwark_plate, burnout])
    expect(wrapper.text()).toContain('Energy Burst') // burnout's active
    // bulwark_plate is passive-only → exactly one active listed, not two
    expect(wrapper.findAll('.text-ability')).toHaveLength(1)
  })

  it('omits the actives section entirely for a passive-only build', () => {
    const wrapper = mountSummary([bulwark_plate])
    expect(wrapper.findAll('.text-ability')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('actives')
  })

  it('emits clear when the clear button is clicked', async () => {
    const wrapper = mountSummary([burnout])
    await wrapper.find('[data-testid="loadout-clear"]').trigger('click')
    expect(wrapper.emitted('clear')).toHaveLength(1)
  })

  it('respects a custom slot count', () => {
    expect(mountSummary([burnout], 3).find('[data-testid="loadout-slots"]').text()).toBe('1 / 3')
  })
})
