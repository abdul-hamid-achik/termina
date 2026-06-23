import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import LoadoutSummary from '../../../app/components/items/LoadoutSummary.vue'
import type { ItemDef } from '../../../shared/types/items'

const vanguard: ItemDef = {
  id: 'vanguard',
  name: 'Vanguard',
  cost: 2500,
  stats: { hp: 250, defense: 5 },
  consumable: false,
  passive: { id: 'p', name: 'Damage Block', description: 'Block damage.' },
}
const dagon: ItemDef = {
  id: 'dagon',
  name: 'Dagon',
  cost: 2750,
  stats: { mp: 150, attack: 15 },
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
    expect(wrapper.find('[data-testid="loadout-cost"]').text()).toBe('0g')
    expect(wrapper.text()).toContain('Pick items')
    // no clear button when empty
    expect(wrapper.find('[data-testid="loadout-clear"]').exists()).toBe(false)
    // the last-hits economy cue only shows once there's a build
    expect(wrapper.find('[data-testid="loadout-lasthits"]').exists()).toBe(false)
  })

  it('shows the ≈ last-hits economy cue for a build (cost / avg creep bounty)', () => {
    const wrapper = mountSummary([vanguard, dagon]) // 5250g → ceil(5250/40) = 132
    const lh = wrapper.find('[data-testid="loadout-lasthits"]')
    expect(lh.exists()).toBe(true)
    expect(lh.text()).toContain('132')
  })

  it('aggregates cost, stats and slot count across the build', () => {
    const wrapper = mountSummary([vanguard, dagon])
    expect(wrapper.find('[data-testid="loadout-slots"]').text()).toBe('2 / 6')
    expect(wrapper.find('[data-testid="loadout-cost"]').text()).toBe('5250g') // 2500 + 2750
    const text = wrapper.text()
    expect(text).toContain('+250 HP')
    expect(text).toContain('+150 Mana')
    expect(text).toContain('+15 Attack')
    expect(text).toContain('+5 Defense')
  })

  it('lists only the actives the build grants (passive-only items excluded)', () => {
    const wrapper = mountSummary([vanguard, dagon])
    expect(wrapper.text()).toContain('Energy Burst') // dagon's active
    // vanguard is passive-only → exactly one active listed, not two
    expect(wrapper.findAll('.text-ability')).toHaveLength(1)
  })

  it('omits the actives section entirely for a passive-only build', () => {
    const wrapper = mountSummary([vanguard])
    expect(wrapper.findAll('.text-ability')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('actives')
  })

  it('emits clear when the clear button is clicked', async () => {
    const wrapper = mountSummary([dagon])
    await wrapper.find('[data-testid="loadout-clear"]').trigger('click')
    expect(wrapper.emitted('clear')).toHaveLength(1)
  })

  it('respects a custom slot count', () => {
    expect(mountSummary([dagon], 3).find('[data-testid="loadout-slots"]').text()).toBe('1 / 3')
  })
})
