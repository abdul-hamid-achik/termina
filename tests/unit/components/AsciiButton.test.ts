import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AsciiButton from '~~/app/components/ui/AsciiButton.vue'

// NuxtLink is a Nuxt auto-import global, unavailable to a plain
// @vitejs/plugin-vue mount — stub it as the plain anchor it renders in the
// real app (the established pattern for this project's component tests).
const NuxtLinkStub = {
  name: 'NuxtLink',
  props: ['to'],
  template: '<a :href="to"><slot /></a>',
}

function mountButton(props: Record<string, unknown> = {}) {
  return mount(AsciiButton, {
    props: { label: 'Start', ...props },
    global: { stubs: { NuxtLink: NuxtLinkStub } },
  })
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

  describe('touch targets (coarse pointers)', () => {
    it('carries the touch-target class so coarse pointers get a 44px min box', () => {
      // Actual sizing comes from the `@media (pointer: coarse)` rule on
      // .touch-target in terminal.css — jsdom/happy-dom don't evaluate media
      // queries, so this asserts the class hook, not computed layout.
      const wrapper = mountButton()
      expect(wrapper.find('button').classes()).toContain('touch-target')
    })
  })

  describe('`to` (navigation, no nested interactive)', () => {
    it('renders as an anchor, never a <button>, when `to` is set', () => {
      const wrapper = mountButton({ to: '/learn' })

      const link = wrapper.find('a')
      expect(link.exists()).toBe(true)
      expect(link.attributes('href')).toBe('/learn')
      expect(wrapper.find('button').exists()).toBe(false)
    })

    it('still renders the bracketed label and touch-target class as a link', () => {
      const wrapper = mountButton({ to: '/lobby', label: 'ENTER' })
      const link = wrapper.get('a')
      expect(link.classes()).toContain('touch-target')
      expect(wrapper.text()).toContain('ENTER')
    })

    it('degrades a disabled link to inert text, not a focusable no-op anchor', () => {
      // A disabled link has nowhere valid to point; rendering <a> anyway would
      // leave a focusable control that does nothing, which is its own trap.
      const wrapper = mountButton({ to: '/lobby', disabled: true })

      expect(wrapper.find('a').exists()).toBe(false)
      expect(wrapper.find('button').exists()).toBe(false)
      const root = wrapper.find('span[aria-disabled="true"]')
      expect(root.exists()).toBe(true)
    })

    it('falls back to a real <button> when `to` is omitted', () => {
      const wrapper = mountButton()
      expect(wrapper.find('button').exists()).toBe(true)
      expect(wrapper.find('a').exists()).toBe(false)
    })
  })

  describe('variants', () => {
    it('applies chaff border styling for the primary variant', () => {
      const wrapper = mountButton({ variant: 'primary' })

      const button = wrapper.find('button')
      expect(button.classes()).toContain('border-chaff')
      // bracket spans pick up the chaff accent colour
      expect(wrapper.findAll('span')[0]!.classes()).toContain('text-chaff')
    })

    it('applies audit border styling for the danger variant', () => {
      const wrapper = mountButton({ variant: 'danger' })

      const button = wrapper.find('button')
      expect(button.classes()).toContain('border-audit')
      expect(wrapper.findAll('span')[0]!.classes()).toContain('text-audit')
    })

    it('applies transparent border for the ghost variant', () => {
      const wrapper = mountButton({ variant: 'ghost' })

      expect(wrapper.find('button').classes()).toContain('border-transparent')
    })

    it('falls back to the default (border-border) styling with no variant', () => {
      const wrapper = mountButton()

      const button = wrapper.find('button')
      expect(button.classes()).toContain('border-border')
      // default brackets use the dim accent rather than chaff/audit
      expect(wrapper.findAll('span')[0]!.classes()).toContain('text-text-dim')
    })
  })
})
