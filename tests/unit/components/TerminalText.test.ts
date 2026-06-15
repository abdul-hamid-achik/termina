import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TerminalText from '../../../app/components/ui/TerminalText.vue'

function mountText(props: Record<string, unknown> = {}, slot = 'system online') {
  return mount(TerminalText, { props, slots: { default: slot } })
}

describe('TerminalText', () => {
  it('renders the slot content inside a mono span', () => {
    const wrapper = mountText({}, 'system online')

    const span = wrapper.find('span')
    expect(span.text()).toBe('system online')
    expect(span.classes()).toContain('font-mono')
  })

  it('is neither bold nor dim by default', () => {
    const wrapper = mountText()

    const span = wrapper.find('span')
    expect(span.classes()).not.toContain('font-bold')
    expect(span.classes()).not.toContain('opacity-60')
    // no inline color style applied when color is omitted
    expect(span.attributes('style')).toBeUndefined()
  })

  it('applies bold styling when bold is set', () => {
    const wrapper = mountText({ bold: true })

    expect(wrapper.find('span').classes()).toContain('font-bold')
  })

  it('applies dim styling when dim is set', () => {
    const wrapper = mountText({ dim: true })

    expect(wrapper.find('span').classes()).toContain('opacity-60')
  })

  it('can be both bold and dim at once', () => {
    const wrapper = mountText({ bold: true, dim: true })

    const span = wrapper.find('span')
    expect(span.classes()).toContain('font-bold')
    expect(span.classes()).toContain('opacity-60')
  })

  describe('color', () => {
    // NOTE: the component renders `color: rgb(var(--color-<x>, <x>))` inline.
    // happy-dom treats that as an invalid CSS value and drops the style attr,
    // so we assert the prop is accepted and content still renders rather than
    // probing an attribute happy-dom won't keep.
    it('accepts a color prop and still renders the slot content', () => {
      const wrapper = mountText({ color: 'radiant' }, 'colored text')

      const span = wrapper.find('span')
      expect(span.text()).toBe('colored text')
      expect(span.classes()).toContain('font-mono')
    })

    it('combines a color with bold + dim modifiers', () => {
      const wrapper = mountText({ color: 'dire', bold: true, dim: true }, 'danger')

      const span = wrapper.find('span')
      expect(span.text()).toBe('danger')
      expect(span.classes()).toContain('font-bold')
      expect(span.classes()).toContain('opacity-60')
    })
  })
})
