import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import InventoryBar from '../../../app/components/game/InventoryBar.vue'
import type { BuffState } from '../../../shared/types/game'
import { mockPointer, restorePointer, tapOutside } from './helpers/pointer'

// healing_salve has an active ("Heal"), iron_branch is stats-only (no active)
const DEFAULT_ITEMS: (string | null)[] = ['healing_salve', 'iron_branch', null, null, null, null]

function mountBar(items = DEFAULT_ITEMS, buffs: BuffState[] = []) {
  return mount(InventoryBar, {
    props: { items, buffs },
    attachTo: document.body,
  })
}

afterEach(() => {
  restorePointer()
  document.body.innerHTML = ''
})

describe('InventoryBar', () => {
  describe('fine pointer (desktop)', () => {
    it('uses an active item immediately on click', async () => {
      mockPointer(false)
      const wrapper = mountBar()

      await wrapper.find('[data-testid="inventory-slot-0"]').trigger('click')

      expect(wrapper.emitted('use')).toEqual([[0, 'healing_salve']])
      wrapper.unmount()
    })

    it('exposes a filled slot as a keyboard-operable button and uses it on Enter', async () => {
      mockPointer(false)
      const wrapper = mountBar()
      const slot = wrapper.find('[data-testid="inventory-slot-0"]')

      expect(slot.attributes('role')).toBe('button')
      expect(slot.attributes('tabindex')).toBe('0')
      expect(slot.attributes('aria-label')).toContain('Healing Salve')

      await slot.trigger('keydown.enter')
      expect(wrapper.emitted('use')).toEqual([[0, 'healing_salve']])
      wrapper.unmount()
    })

    it('shows tooltip on hover with keyboard hint and no [USE] button', async () => {
      mockPointer(false)
      const wrapper = mountBar()

      await wrapper.find('[data-testid="inventory-slot-0"]').trigger('mouseenter')

      const tooltip = wrapper.find('[data-testid="inventory-tooltip-0"]')
      expect(tooltip.exists()).toBe(true)
      expect(tooltip.text()).toContain('[Click or press 1]')
      expect(wrapper.find('[data-testid="inventory-use-0"]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('does not emit use for a passive item', async () => {
      mockPointer(false)
      const wrapper = mountBar()

      await wrapper.find('[data-testid="inventory-slot-1"]').trigger('click')

      expect(wrapper.emitted('use')).toBeUndefined()
      wrapper.unmount()
    })
  })

  describe('coarse pointer (touch)', () => {
    it('first tap opens the tooltip instead of using the item', async () => {
      mockPointer(true)
      const wrapper = mountBar()

      await wrapper.find('[data-testid="inventory-slot-0"]').trigger('click')

      expect(wrapper.emitted('use')).toBeUndefined()
      expect(wrapper.find('[data-testid="inventory-tooltip-0"]').exists()).toBe(true)
      wrapper.unmount()
    })

    it('tooltip shows an explicit [USE] button for active items', async () => {
      mockPointer(true)
      const wrapper = mountBar()

      await wrapper.find('[data-testid="inventory-slot-0"]').trigger('click')

      const useBtn = wrapper.find('[data-testid="inventory-use-0"]')
      expect(useBtn.exists()).toBe(true)
      expect(useBtn.text()).toContain('[USE]')
      wrapper.unmount()
    })

    it('tapping [USE] uses the item and dismisses the tooltip', async () => {
      mockPointer(true)
      const wrapper = mountBar()

      await wrapper.find('[data-testid="inventory-slot-0"]').trigger('click')
      await wrapper.find('[data-testid="inventory-use-0"]').trigger('click')

      expect(wrapper.emitted('use')).toEqual([[0, 'healing_salve']])
      expect(wrapper.find('[data-testid="inventory-tooltip-0"]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('passive item tooltip has no [USE] button', async () => {
      mockPointer(true)
      const wrapper = mountBar()

      await wrapper.find('[data-testid="inventory-slot-1"]').trigger('click')

      expect(wrapper.find('[data-testid="inventory-tooltip-1"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="inventory-use-1"]').exists()).toBe(false)
      expect(wrapper.emitted('use')).toBeUndefined()
      wrapper.unmount()
    })

    it('item on cooldown shows tooltip without [USE] and never emits', async () => {
      mockPointer(true)
      const buffs: BuffState[] = [
        { id: 'item_cd_healing_salve', stacks: 1, ticksRemaining: 2, source: 'item' },
      ]
      const wrapper = mountBar(DEFAULT_ITEMS, buffs)

      await wrapper.find('[data-testid="inventory-slot-0"]').trigger('click')

      const tooltip = wrapper.find('[data-testid="inventory-tooltip-0"]')
      expect(tooltip.exists()).toBe(true)
      expect(tooltip.text()).toContain('[Cooldown: 2t]')
      expect(wrapper.find('[data-testid="inventory-use-0"]').exists()).toBe(false)
      expect(wrapper.emitted('use')).toBeUndefined()
      wrapper.unmount()
    })

    it('tapping an empty slot does nothing', async () => {
      mockPointer(true)
      const wrapper = mountBar()

      await wrapper.find('[data-testid="inventory-slot-2"]').trigger('click')

      expect(wrapper.find('[data-testid="inventory-tooltip-2"]').exists()).toBe(false)
      expect(wrapper.emitted('use')).toBeUndefined()
      wrapper.unmount()
    })

    it('tap outside dismisses the tooltip', async () => {
      mockPointer(true)
      const wrapper = mountBar()

      await wrapper.find('[data-testid="inventory-slot-0"]').trigger('click')
      expect(wrapper.find('[data-testid="inventory-tooltip-0"]').exists()).toBe(true)

      tapOutside()
      await nextTick()

      expect(wrapper.find('[data-testid="inventory-tooltip-0"]').exists()).toBe(false)
      expect(wrapper.emitted('use')).toBeUndefined()
      wrapper.unmount()
    })
  })
})
