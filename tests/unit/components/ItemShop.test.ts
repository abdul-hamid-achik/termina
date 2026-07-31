import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ItemShop from '~~/app/components/game/ItemShop.vue'
import { ITEMS } from '~~/shared/constants/items'

function shopItems() {
  return [
    {
      id: 'trauma_patch',
      name: ITEMS.trauma_patch!.name,
      cost: ITEMS.trauma_patch!.cost,
      def: ITEMS.trauma_patch!,
      category: 'street' as const,
    },
    {
      id: 'scrap_lot',
      name: ITEMS.scrap_lot!.name,
      cost: ITEMS.scrap_lot!.cost,
      def: ITEMS.scrap_lot!,
      category: 'street' as const,
    },
  ]
}

function mountShop(
  overrides: Partial<{
    scrip: number
    ownedItems: (string | null)[]
    pinnedItems: string[]
    recommendedItems: string[]
  }> = {},
) {
  return mount(ItemShop, {
    props: {
      items: shopItems(),
      scrip: 10_000,
      ownedItems: [null, null, null, null, null, null],
      pinnedItems: [],
      ...overrides,
    },
  })
}

describe('ItemShop', () => {
  it('emits buy exactly once when the [BUY] button is tapped', async () => {
    const wrapper = mountShop()

    await wrapper.find('[data-testid="shop-buy-trauma_patch"]').trigger('click')

    // .stop on the button must prevent the card click from double-buying
    expect(wrapper.emitted('buy')).toEqual([['trauma_patch']])
  })

  it('still buys via card click (desktop behavior preserved)', async () => {
    const wrapper = mountShop()

    await wrapper.find('[data-testid="shop-item-trauma_patch"]').trigger('click')

    expect(wrapper.emitted('buy')).toEqual([['trauma_patch']])
  })

  it('hides [BUY] when the item is unaffordable', () => {
    const wrapper = mountShop({ scrip: 0 })

    expect(wrapper.find('[data-testid="shop-buy-trauma_patch"]').exists()).toBe(false)
  })

  it('marks a unique (non-consumable) item [OWNED] and hides [BUY]', () => {
    // scrap_lot has no maxStacks → unique → owning one caps it.
    const wrapper = mountShop({
      ownedItems: ['scrap_lot', null, null, null, null, null],
    })

    expect(wrapper.find('[data-testid="shop-buy-scrap_lot"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('[OWNED]')
  })

  it('keeps [BUY] for a restockable consumable below its stack cap', () => {
    // trauma_patch stacks to 3 — owning one must NOT lock out re-buying.
    const wrapper = mountShop({
      ownedItems: ['trauma_patch', null, null, null, null, null],
    })

    expect(wrapper.find('[data-testid="shop-buy-trauma_patch"]').exists()).toBe(true)
    // shows an owned-count indicator, not [OWNED]
    expect(wrapper.text()).toContain('×1')
    expect(wrapper.text()).not.toContain('[OWNED]')
  })

  it('hides [BUY] and shows [OWNED] only when a consumable hits its stack cap', () => {
    const wrapper = mountShop({
      ownedItems: ['trauma_patch', 'trauma_patch', 'trauma_patch', null, null, null],
    })

    expect(wrapper.find('[data-testid="shop-buy-trauma_patch"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('[OWNED]')
  })

  it('pin button toggles pin/unpin without triggering buy', async () => {
    const wrapper = mountShop()

    await wrapper.find('[data-testid="shop-pin-trauma_patch"]').trigger('click')
    expect(wrapper.emitted('pin')).toEqual([['trauma_patch']])
    expect(wrapper.emitted('buy')).toBeUndefined()

    await wrapper.setProps({ pinnedItems: ['trauma_patch'] })
    await wrapper.find('[data-testid="shop-pin-trauma_patch"]').trigger('click')
    expect(wrapper.emitted('unpin')).toEqual([['trauma_patch']])
  })

  it('[BUY] and [PIN] are touch targets separated by the coarse-pointer gap', () => {
    const wrapper = mountShop()

    const buyBtn = wrapper.find('[data-testid="shop-buy-trauma_patch"]')
    const pinBtn = wrapper.find('[data-testid="shop-pin-trauma_patch"]')
    expect(buyBtn.classes()).toContain('touch-target')
    expect(pinBtn.classes()).toContain('touch-target')
    expect(buyBtn.element.parentElement?.classList.contains('touch-gap')).toBe(true)
  })

  describe('role recommendations (new-player funnel)', () => {
    it('badges recommended items with a ★ and leaves others unbadged', () => {
      const wrapper = mountShop({ recommendedItems: ['scrap_lot'] })

      expect(wrapper.find('[data-testid="shop-rec-scrap_lot"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="shop-rec-trauma_patch"]').exists()).toBe(false)
    })

    it('shows a "★ FOR YOU" tab that filters to the recommended items', async () => {
      const wrapper = mountShop({ recommendedItems: ['scrap_lot'] })
      const forYou = wrapper.findAll('button').find((b) => b.text().includes('FOR YOU'))
      expect(forYou).toBeTruthy()

      await forYou!.trigger('click')
      // Only the recommended item card remains under the tab.
      expect(wrapper.find('[data-testid="shop-item-scrap_lot"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="shop-item-trauma_patch"]').exists()).toBe(false)
    })

    it('omits the "★ FOR YOU" tab when there are no recommendations (e.g. spectator)', () => {
      const wrapper = mountShop()
      const forYou = wrapper.findAll('button').find((b) => b.text().includes('FOR YOU'))
      expect(forYou).toBeUndefined()
    })
  })
})
