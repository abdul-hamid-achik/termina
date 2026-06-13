import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import QuickBuy from '../../../app/components/game/QuickBuy.vue'
import { ITEMS } from '~~/shared/constants/items'

const SALVE_COST = ITEMS.healing_salve!.cost

function mountQuickBuy(
  overrides: Partial<{ pinnedItems: string[]; gold: number; canBuy: boolean }> = {},
) {
  return mount(QuickBuy, {
    props: {
      pinnedItems: ['healing_salve'],
      gold: SALVE_COST + 100,
      canBuy: true,
      ...overrides,
    },
  })
}

describe('QuickBuy', () => {
  it('emits buy when [BUY] is tapped', async () => {
    const wrapper = mountQuickBuy()

    await wrapper.find('[data-testid="quickbuy-buy-healing_salve"]').trigger('click')

    expect(wrapper.emitted('buy')).toEqual([['healing_salve']])
  })

  it('emits unpin when the unpin button is tapped (separate from buy)', async () => {
    const wrapper = mountQuickBuy()

    await wrapper.find('[data-testid="quickbuy-unpin-healing_salve"]').trigger('click')

    expect(wrapper.emitted('unpin')).toEqual([['healing_salve']])
    expect(wrapper.emitted('buy')).toBeUndefined()
  })

  it('hides [BUY] when unaffordable but keeps unpin reachable', () => {
    const wrapper = mountQuickBuy({ gold: 0 })

    expect(wrapper.find('[data-testid="quickbuy-buy-healing_salve"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="quickbuy-unpin-healing_salve"]').exists()).toBe(true)
    expect(wrapper.text()).toContain(`-${SALVE_COST}g`)
  })

  it('hides [BUY] when buying is unavailable (e.g. away from base)', () => {
    const wrapper = mountQuickBuy({ canBuy: false })

    expect(wrapper.find('[data-testid="quickbuy-buy-healing_salve"]').exists()).toBe(false)
  })

  it('buy and unpin are sized as touch targets with a coarse-pointer gap', () => {
    const wrapper = mountQuickBuy()

    expect(wrapper.find('[data-testid="quickbuy-buy-healing_salve"]').classes()).toContain(
      'touch-target',
    )
    expect(wrapper.find('[data-testid="quickbuy-unpin-healing_salve"]').classes()).toContain(
      'touch-target',
    )
    expect(wrapper.find('[data-testid="quickbuy-healing_salve"]').classes()).toContain('touch-gap')
  })
})
