import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TerminalPanel from '../../../app/components/ui/TerminalPanel.vue'

function mountPanel(props: Record<string, unknown> = {}, slot = '<p class="body">content</p>') {
  return mount(TerminalPanel, { props, slots: { default: slot } })
}

describe('TerminalPanel', () => {
  it('renders default-slot content', () => {
    const wrapper = mountPanel({}, '<p class="body">hello world</p>')

    expect(wrapper.find('.body').exists()).toBe(true)
    expect(wrapper.text()).toContain('hello world')
  })

  describe('title header', () => {
    it('renders the title (uppercased) with the ASCII frame chars when provided', () => {
      const wrapper = mountPanel({ title: 'War Room' })

      expect(wrapper.text()).toContain('War Room')
      // ASCII corner glyphs of the header frame
      expect(wrapper.text()).toContain('┌─')
      expect(wrapper.text()).toContain('─┐')
    })

    it('omits the header entirely when no title is given', () => {
      const wrapper = mountPanel()

      expect(wrapper.text()).not.toContain('┌─')
      // header bar element should not be present
      expect(wrapper.find('.border-b').exists()).toBe(false)
    })
  })

  describe('variants', () => {
    it('uses the plain border by default', () => {
      const wrapper = mountPanel()

      const root = wrapper.find('div')
      expect(root.classes()).toContain('border-border')
      expect(root.classes()).not.toContain('border-border-glow')
      expect(root.classes()).not.toContain('border-dire')
    })

    it('applies the highlight glow for the highlight variant', () => {
      const wrapper = mountPanel({ variant: 'highlight' })

      const root = wrapper.find('div')
      expect(root.classes()).toContain('border-border-glow')
      expect(root.classes()).toContain('shadow-glow-highlight')
    })

    it('applies the dire border for the danger variant', () => {
      const wrapper = mountPanel({ variant: 'danger' })

      expect(wrapper.find('div').classes()).toContain('border-dire')
    })
  })
})
