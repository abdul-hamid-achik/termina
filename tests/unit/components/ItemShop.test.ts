import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ItemShop from '../../../app/components/game/ItemShop.vue'
import { ITEMS } from '~~/shared/constants/items'

function shopItems() {
  return [
    {
      id: 'healing_salve',
      name: ITEMS.healing_salve!.name,
      cost: ITEMS.healing_salve!.cost,
      def: ITEMS.healing_salve!,
      category: 'starter' as const,
    },
    {
      id: 'iron_branch',
      name: ITEMS.iron_branch!.name,
      cost: ITEMS.iron_branch!.cost,
      def: ITEMS.iron_branch!,
      category: 'starter' as const,
    },
  ]
}

function mountShop(
  overrides: Partial<{ gold: number; ownedItems: (string | null)[]; pinnedItems: string[] }> = {},
) {
  return mount(ItemShop, {
    props: {
      items: shopItems(),
      gold: 10_000,
      ownedItems: [null, null, null, null, null, null],
      pinnedItems: [],
      ...overrides,
    },
  })
}

describe('ItemShop', () => {
  it('emits buy exactly once when the [BUY] button is tapped', async () => {
    const wrapper = mountShop()

    await wrapper.find('[data-testid="shop-buy-healing_salve"]').trigger('click')

    // .stop on the button must prevent the card click from double-buying
    expect(wrapper.emitted('buy')).toEqual([['healing_salve']])
  })

  it('still buys via card click (desktop behavior preserved)', async () => {
    const wrapper = mountShop()

    await wrapper.find('[data-testid="shop-item-healing_salve"]').trigger('click')

    expect(wrapper.emitted('buy')).toEqual([['healing_salve']])
  })

  it('hides [BUY] when the item is unaffordable', () => {
    const wrapper = mountShop({ gold: 0 })

    expect(wrapper.find('[data-testid="shop-buy-healing_salve"]').exists()).toBe(false)
  })

  it('hides [BUY] when the item is owned', () => {
    const wrapper = mountShop({
      ownedItems: ['healing_salve', null, null, null, null, null],
    })

    expect(wrapper.find('[data-testid="shop-buy-healing_salve"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('[OWNED]')
  })

  it('pin button toggles pin/unpin without triggering buy', async () => {
    const wrapper = mountShop()

    await wrapper.find('[data-testid="shop-pin-healing_salve"]').trigger('click')
    expect(wrapper.emitted('pin')).toEqual([['healing_salve']])
    expect(wrapper.emitted('buy')).toBeUndefined()

    await wrapper.setProps({ pinnedItems: ['healing_salve'] })
    await wrapper.find('[data-testid="shop-pin-healing_salve"]').trigger('click')
    expect(wrapper.emitted('unpin')).toEqual([['healing_salve']])
  })

  it('[BUY] and [PIN] are touch targets separated by the coarse-pointer gap', () => {
    const wrapper = mountShop()

    const buyBtn = wrapper.find('[data-testid="shop-buy-healing_salve"]')
    const pinBtn = wrapper.find('[data-testid="shop-pin-healing_salve"]')
    expect(buyBtn.classes()).toContain('touch-target')
    expect(pinBtn.classes()).toContain('touch-target')
    expect(buyBtn.element.parentElement?.classList.contains('touch-gap')).toBe(true)
  })
})
