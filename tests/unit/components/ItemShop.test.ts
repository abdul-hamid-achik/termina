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
  overrides: Partial<{
    gold: number
    ownedItems: (string | null)[]
    pinnedItems: string[]
    recommendedItems: string[]
  }> = {},
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

  it('marks a unique (non-consumable) item [OWNED] and hides [BUY]', () => {
    // iron_branch has no maxStacks → unique → owning one caps it.
    const wrapper = mountShop({
      ownedItems: ['iron_branch', null, null, null, null, null],
    })

    expect(wrapper.find('[data-testid="shop-buy-iron_branch"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('[OWNED]')
  })

  it('keeps [BUY] for a restockable consumable below its stack cap', () => {
    // healing_salve stacks to 3 — owning one must NOT lock out re-buying.
    const wrapper = mountShop({
      ownedItems: ['healing_salve', null, null, null, null, null],
    })

    expect(wrapper.find('[data-testid="shop-buy-healing_salve"]').exists()).toBe(true)
    // shows an owned-count indicator, not [OWNED]
    expect(wrapper.text()).toContain('×1')
    expect(wrapper.text()).not.toContain('[OWNED]')
  })

  it('hides [BUY] and shows [OWNED] only when a consumable hits its stack cap', () => {
    const wrapper = mountShop({
      ownedItems: ['healing_salve', 'healing_salve', 'healing_salve', null, null, null],
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

  describe('role recommendations (new-player funnel)', () => {
    it('badges recommended items with a ★ and leaves others unbadged', () => {
      const wrapper = mountShop({ recommendedItems: ['iron_branch'] })

      expect(wrapper.find('[data-testid="shop-rec-iron_branch"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="shop-rec-healing_salve"]').exists()).toBe(false)
    })

    it('shows a "★ FOR YOU" tab that filters to the recommended items', async () => {
      const wrapper = mountShop({ recommendedItems: ['iron_branch'] })
      const forYou = wrapper.findAll('button').find((b) => b.text().includes('FOR YOU'))
      expect(forYou).toBeTruthy()

      await forYou!.trigger('click')
      // Only the recommended item card remains under the tab.
      expect(wrapper.find('[data-testid="shop-item-iron_branch"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="shop-item-healing_salve"]').exists()).toBe(false)
    })

    it('omits the "★ FOR YOU" tab when there are no recommendations (e.g. spectator)', () => {
      const wrapper = mountShop()
      const forYou = wrapper.findAll('button').find((b) => b.text().includes('FOR YOU'))
      expect(forYou).toBeUndefined()
    })
  })
})
