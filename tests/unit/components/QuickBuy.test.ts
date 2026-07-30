import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import QuickBuy from '~~/app/components/game/QuickBuy.vue'
import { ITEMS } from '~~/shared/constants/items'

const SALVE_COST = ITEMS.trauma_patch!.cost

function mountQuickBuy(
  overrides: Partial<{
    pinnedItems: string[]
    gold: number
    canBuy: boolean
    recommendedItems: string[]
  }> = {},
) {
  return mount(QuickBuy, {
    props: {
      pinnedItems: ['trauma_patch'],
      gold: SALVE_COST + 100,
      canBuy: true,
      ...overrides,
    },
  })
}

describe('QuickBuy', () => {
  it('emits buy when [BUY] is tapped', async () => {
    const wrapper = mountQuickBuy()

    await wrapper.find('[data-testid="quickbuy-buy-trauma_patch"]').trigger('click')

    expect(wrapper.emitted('buy')).toEqual([['trauma_patch']])
  })

  it('emits unpin when the unpin button is tapped (separate from buy)', async () => {
    const wrapper = mountQuickBuy()

    await wrapper.find('[data-testid="quickbuy-unpin-trauma_patch"]').trigger('click')

    expect(wrapper.emitted('unpin')).toEqual([['trauma_patch']])
    expect(wrapper.emitted('buy')).toBeUndefined()
  })

  it('hides [BUY] when unaffordable but keeps unpin reachable', () => {
    const wrapper = mountQuickBuy({ gold: 0 })

    expect(wrapper.find('[data-testid="quickbuy-buy-trauma_patch"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="quickbuy-unpin-trauma_patch"]').exists()).toBe(true)
    expect(wrapper.text()).toContain(`-${SALVE_COST}sc`)
  })

  it('hides [BUY] when buying is unavailable (e.g. away from base)', () => {
    const wrapper = mountQuickBuy({ canBuy: false })

    expect(wrapper.find('[data-testid="quickbuy-buy-trauma_patch"]').exists()).toBe(false)
  })

  it('buy and unpin are sized as touch targets with a coarse-pointer gap', () => {
    const wrapper = mountQuickBuy()

    expect(wrapper.find('[data-testid="quickbuy-buy-trauma_patch"]').classes()).toContain(
      'touch-target',
    )
    expect(wrapper.find('[data-testid="quickbuy-unpin-trauma_patch"]').classes()).toContain(
      'touch-target',
    )
    expect(wrapper.find('[data-testid="quickbuy-trauma_patch"]').classes()).toContain('touch-gap')
  })

  describe('recommendation fallback (new-player funnel)', () => {
    it('shows role suggestions (no unpin) when nothing is pinned', () => {
      const wrapper = mountQuickBuy({
        pinnedItems: [],
        gold: 99999,
        recommendedItems: ['edge_kit', 'null_pointer'],
      })
      expect(wrapper.text()).toContain('Suggested')
      expect(wrapper.find('[data-testid="quickbuy-edge_kit"]').exists()).toBe(true)
      // Suggestions aren't pinned, so they expose no unpin control.
      expect(wrapper.find('[data-testid="quickbuy-unpin-edge_kit"]').exists()).toBe(false)
    })

    it('prefers pinned items over suggestions when both exist', () => {
      const wrapper = mountQuickBuy({
        pinnedItems: ['trauma_patch'],
        recommendedItems: ['edge_kit'],
      })
      expect(wrapper.text()).toContain('Quick Buy')
      expect(wrapper.find('[data-testid="quickbuy-trauma_patch"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="quickbuy-edge_kit"]').exists()).toBe(false)
    })
  })
})
