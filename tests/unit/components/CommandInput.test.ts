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

    it('stays editable when canAct is false (pre-typing during the wait)', () => {
      const wrapper = mount(CommandInput, {
        props: { canAct: false },
      })

      const input = wrapper.find('input')
      expect(input.attributes('disabled')).toBeUndefined()
    })

    it('emits submit while canAct is false so the parent can buffer it', async () => {
      const wrapper = mount(CommandInput, {
        props: { canAct: false },
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

    it('shows the buffered command notice', () => {
      const wrapper = mount(CommandInput, {
        props: { canAct: false, bufferedCommand: 'cast q' },
      })

      const notice = wrapper.find('[data-testid="buffered-command"]')
      expect(notice.exists()).toBe(true)
      expect(notice.text()).toContain('cast q')
      expect(notice.text()).toContain('next tick')
    })

    it('shows the pending command in the placeholder while waiting', () => {
      const wrapper = mount(CommandInput, {
        props: { canAct: false, pendingCommand: 'move mid-river' },
      })

      const input = wrapper.find('input')
      expect(input.attributes('placeholder')).toContain('move mid-river')
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
