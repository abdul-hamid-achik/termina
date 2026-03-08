import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CommandInput from '../../../app/components/game/CommandInput.vue'

describe('CommandInput', () => {
  describe('accessibility', () => {
    it('should announce validation errors', async () => {
      const wrapper = mount(CommandInput, {
        props: { canAct: true },
        attachTo: document.body,
      })

      const input = wrapper.find('input')
      await input.setValue('move invalid-zone-xyz')

      const liveRegion = wrapper.find('[aria-live="polite"]')
      expect(liveRegion.exists()).toBe(true)
    })

    it('should have accessible label for input', () => {
      const wrapper = mount(CommandInput)

      const input = wrapper.find('input')
      expect(input.attributes('aria-label')).toBeDefined()
    })

    it('should announce preview changes', async () => {
      const wrapper = mount(CommandInput, {
        props: { canAct: true },
      })

      const input = wrapper.find('input')
      await input.setValue('move mid')

      const preview = wrapper.find('[data-testid="command-preview"]')
      expect(preview.exists()).toBe(true)
    })
  })

  describe('input behavior', () => {
    it('should show placeholder when empty', () => {
      const wrapper = mount(CommandInput, {
        props: { placeholder: 'Enter command...' },
      })

      const input = wrapper.find('input')
      expect(input.attributes('placeholder')).toBe('Enter command...')
    })

    it('should be disabled when canAct is false', () => {
      const wrapper = mount(CommandInput, {
        props: { canAct: false },
      })

      const input = wrapper.find('input')
      expect(input.attributes('disabled')).toBeDefined()
    })

    it('should emit submit on Enter', async () => {
      const wrapper = mount(CommandInput, {
        props: { canAct: true },
      })

      const vm = wrapper.vm as { input: string; open: boolean }
      const input = wrapper.find('input')

      vm.input = 'move mid'
      await wrapper.vm.$nextTick()

      vm.open = false
      await wrapper.vm.$nextTick()

      await input.trigger('keydown', { key: 'Enter' })
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('submit')).toBeTruthy()
      expect(wrapper.emitted('submit')![0]).toEqual(['move mid'])
    })
  })

  describe('autocomplete', () => {
    it('should show suggestions dropdown', async () => {
      const wrapper = mount(CommandInput, {
        props: { canAct: true },
      })

      const input = wrapper.find('input')
      await input.setValue('mov')
      await input.trigger('focus')

      expect(wrapper.text()).toContain('move')
    })
  })
})
