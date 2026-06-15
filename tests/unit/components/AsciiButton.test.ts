import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AsciiButton from '../../../app/components/ui/AsciiButton.vue'

function mountButton(props: Record<string, unknown> = {}) {
  return mount(AsciiButton, { props: { label: 'Start', ...props } })
}

describe('AsciiButton', () => {
  it('renders the uppercased label wrapped in ASCII brackets', () => {
    const wrapper = mountButton({ label: 'Start' })

    // label is rendered verbatim in the DOM; CSS uppercases it visually
    expect(wrapper.text()).toContain('Start')
    // the decorative brackets are present as their own spans
    const spans = wrapper.findAll('span')
    expect(spans[0]!.text()).toBe('[')
    expect(spans.at(-1)!.text()).toBe(']')
  })

  it('emits a click event with the MouseEvent when enabled', async () => {
    const wrapper = mountButton()

    await wrapper.find('button').trigger('click')

    const emitted = wrapper.emitted('click')
    expect(emitted).toHaveLength(1)
    expect(emitted![0]![0]).toBeInstanceOf(MouseEvent)
  })

  it('emits one click per trigger', async () => {
    const wrapper = mountButton()

    await wrapper.find('button').trigger('click')
    await wrapper.find('button').trigger('click')

    expect(wrapper.emitted('click')).toHaveLength(2)
  })

  describe('disabled', () => {
    it('sets the native disabled attribute and disabled styling', () => {
      const wrapper = mountButton({ disabled: true })

      const button = wrapper.find('button')
      expect(button.attributes('disabled')).toBeDefined()
      expect(button.classes()).toContain('opacity-35')
      expect(button.classes()).toContain('pointer-events-none')
    })

    it('is not disabled by default', () => {
      const wrapper = mountButton()

      const button = wrapper.find('button')
      expect(button.attributes('disabled')).toBeUndefined()
      expect(button.classes()).toContain('cursor-pointer')
    })
  })

  describe('variants', () => {
    it('applies radiant border styling for the primary variant', () => {
      const wrapper = mountButton({ variant: 'primary' })

      const button = wrapper.find('button')
      expect(button.classes()).toContain('border-radiant')
      // bracket spans pick up the radiant accent colour
      expect(wrapper.findAll('span')[0]!.classes()).toContain('text-radiant')
    })

    it('applies dire border styling for the danger variant', () => {
      const wrapper = mountButton({ variant: 'danger' })

      const button = wrapper.find('button')
      expect(button.classes()).toContain('border-dire')
      expect(wrapper.findAll('span')[0]!.classes()).toContain('text-dire')
    })

    it('applies transparent border for the ghost variant', () => {
      const wrapper = mountButton({ variant: 'ghost' })

      expect(wrapper.find('button').classes()).toContain('border-transparent')
    })

    it('falls back to the default (border-border) styling with no variant', () => {
      const wrapper = mountButton()

      const button = wrapper.find('button')
      expect(button.classes()).toContain('border-border')
      // default brackets use the dim accent rather than radiant/dire
      expect(wrapper.findAll('span')[0]!.classes()).toContain('text-text-dim')
    })
  })
})
