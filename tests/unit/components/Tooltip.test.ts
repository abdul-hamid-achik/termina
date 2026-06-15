import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import { TooltipProvider } from 'reka-ui'
import Tooltip from '../../../app/components/ui/Tooltip.vue'

/**
 * reka-ui's TooltipRoot must live under a TooltipProvider, and its content is
 * portalled + hover/focus-gated (exactly how the live app + the story wrap it).
 * This harness mirrors that: a zero-delay provider around the Tooltip with a
 * focusable trigger in the default slot so we can open it deterministically.
 */
function mountTooltip(props: { text: string; position?: string }) {
  const Harness = defineComponent({
    setup() {
      return () =>
        h(TooltipProvider, { delayDuration: 0 }, () =>
          h(Tooltip, props, () => h('button', { class: 'trg' }, 'hover me')),
        )
    },
  })
  return mount(Harness, { attachTo: document.body })
}

/** Drive the reka hover/focus open sequence and let the popper settle. */
async function openTooltip(wrapper: ReturnType<typeof mountTooltip>) {
  const trigger = wrapper.find('.trg')
  for (const ev of ['pointerenter', 'pointermove', 'focus']) {
    await trigger.trigger(ev)
    await nextTick()
  }
  await new Promise((r) => setTimeout(r, 30))
  await nextTick()
}

/** The portalled content carries the data-side attr; the inner role=tooltip the text. */
function contentNode(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-side]')
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Tooltip', () => {
  it('renders the trigger slot content', () => {
    const wrapper = mountTooltip({ text: 'Tooltip on top' })

    const trigger = wrapper.find('.trg')
    expect(trigger.exists()).toBe(true)
    expect(trigger.text()).toBe('hover me')
    wrapper.unmount()
  })

  it('does not show the tooltip text until the trigger is activated', () => {
    const wrapper = mountTooltip({ text: 'Hidden until hover' })

    expect(document.body.textContent).not.toContain('Hidden until hover')
    wrapper.unmount()
  })

  it('reveals the tooltip text once hovered/focused', async () => {
    const wrapper = mountTooltip({ text: 'Casts Pulse — 90 mana' })

    await openTooltip(wrapper)

    expect(document.body.textContent).toContain('Casts Pulse — 90 mana')
    wrapper.unmount()
  })

  it('uses the top side by default', async () => {
    const wrapper = mountTooltip({ text: 'default side' })

    await openTooltip(wrapper)

    expect(contentNode()).not.toBeNull()
    expect(contentNode()!.getAttribute('data-side')).toBe('top')
    wrapper.unmount()
  })

  it('passes the position prop through to the content side', async () => {
    const wrapper = mountTooltip({ text: 'on the right', position: 'right' })

    await openTooltip(wrapper)

    expect(contentNode()!.getAttribute('data-side')).toBe('right')
    wrapper.unmount()
  })

  it('renders the bottom side when requested', async () => {
    const wrapper = mountTooltip({ text: 'below', position: 'bottom' })

    await openTooltip(wrapper)

    expect(contentNode()!.getAttribute('data-side')).toBe('bottom')
    wrapper.unmount()
  })
})
