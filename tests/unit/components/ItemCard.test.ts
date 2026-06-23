import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ItemCard from '../../../app/components/items/ItemCard.vue'
import type { ItemDef } from '../../../shared/types/items'

const base: ItemDef = {
  id: 'dagon',
  name: 'Dagon',
  cost: 2750,
  stats: { mp: 150, attack: 15 },
  consumable: false,
  active: {
    id: 'dagon_active',
    name: 'Energy Burst',
    description: 'Deal 300 magical damage to a target hero.',
    cooldownTicks: 18,
    targetType: 'enemy',
  },
}

function mountCard(item: Partial<ItemDef> = {}, props: Record<string, unknown> = {}) {
  return mount(ItemCard, { props: { item: { ...base, ...item }, ...props } })
}

describe('ItemCard', () => {
  it('renders name, cost and humanized stats', () => {
    const text = mountCard().text()
    expect(text).toContain('Dagon')
    expect(text).toContain('2750g')
    expect(text).toContain('+150 Mana')
    expect(text).toContain('+15 Attack')
  })

  it('renders the active with name, description, cooldown (s) and target', () => {
    const text = mountCard().text()
    expect(text).toContain('Active · Energy Burst')
    expect(text).toContain('Deal 300 magical damage')
    expect(text).toContain('72s') // 18 ticks * 4000ms / 1000
    expect(text.toLowerCase()).toContain('enemy')
  })

  it('shows an active mana cost when the active declares one', () => {
    const text = mountCard({
      active: {
        id: 'a',
        name: 'Cast',
        description: 'does a thing',
        cooldownTicks: 10,
        manaCost: 75,
      },
    }).text()
    expect(text).toContain('40s') // 10 ticks
    expect(text).toContain('75') // mana cost line
  })

  it('renders a passive with its name + description', () => {
    const text = mountCard({
      active: undefined,
      passive: { id: 'p', name: 'Corruption', description: 'Attacks reduce armor.' },
    }).text()
    expect(text).toContain('Passive · Corruption')
    expect(text).toContain('Attacks reduce armor.')
  })

  it('shows a consumable badge with stack count', () => {
    const text = mountCard({ consumable: true, maxStacks: 3, stats: {}, active: undefined }).text()
    expect(text.toLowerCase()).toContain('consumable')
    expect(text).toContain('×3')
  })

  it('is a non-interactive div by default and emits nothing on click', async () => {
    const wrapper = mountCard()
    expect(wrapper.element.tagName).toBe('DIV')
    await wrapper.trigger('click')
    expect(wrapper.emitted('toggle')).toBeUndefined()
  })

  it('is a button and emits toggle when interactive', async () => {
    const wrapper = mountCard({}, { interactive: true })
    expect(wrapper.element.tagName).toBe('BUTTON')
    await wrapper.trigger('click')
    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })

  it('shows the loadout marker + selected styling when selected', () => {
    const wrapper = mountCard({}, { interactive: true, selected: true })
    expect(wrapper.find('[data-testid="item-card-selected"]').exists()).toBe(true)
    expect(wrapper.classes()).toContain('border-radiant')
  })

  it('omits the active/passive/stats blocks when absent', () => {
    const wrapper = mountCard({ stats: {}, active: undefined, passive: undefined })
    const text = wrapper.text()
    expect(text).not.toContain('Active ·')
    expect(text).not.toContain('Passive ·')
  })
})
