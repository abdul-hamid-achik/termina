import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ScrambleText from '~~/app/components/ui/ScrambleText.vue'
import MarqueeStrip from '~~/app/components/ui/MarqueeStrip.vue'
import ParallaxLayer from '~~/app/components/ui/ParallaxLayer.vue'

/**
 * The landing page's three motion primitives. Every assertion here is about the
 * promise each one makes to a user who cannot or does not want to see motion —
 * that is the part that silently rots, because the animation itself is obvious
 * on screen the moment it breaks and the accessibility contract is not.
 */

/** Drive `prefers-reduced-motion` for a mount. */
function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion: reduce'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
}

beforeEach(() => stubReducedMotion(false))
afterEach(() => vi.unstubAllGlobals())

describe('ScrambleText', () => {
  const TEXT = '>_ where every command is a kill'

  it('exposes the REAL string to assistive tech, never the churn', () => {
    // The DOM genuinely contains random glyphs for most of this component's
    // runtime, so every visual copy is aria-hidden and one readable copy is
    // carried in a visually-hidden span.
    //
    // This used to assert `aria-label` on the wrapper. That attribute was
    // present and did nothing: `aria-label` is ignored on an element with a
    // generic role, so with both children aria-hidden the component contributed
    // NOTHING to the accessibility tree — Chrome's tree showed the landing
    // page's headline and subhead as empty paragraphs. The assertion has to be
    // "there is readable text", not "the attribute is set".
    const wrapper = mount(ScrambleText, { props: { text: TEXT } })

    const readable = wrapper
      .findAll('span')
      .filter((s) => s.attributes('aria-hidden') !== 'true' && s.text() === TEXT)
    expect(readable.length, 'no non-aria-hidden element carries the real string').toBe(1)
    // ...and it must be clipped (sr-only), not `visibility: hidden`, which would
    // take it back out of the accessibility tree.
    expect(readable[0]!.classes()).toContain('sr-only')

    for (const span of wrapper.findAll('span span')) {
      if (span.classes().includes('sr-only')) continue
      expect(span.attributes('aria-hidden')).toBe('true')
    }
  })

  it('renders the final text immediately under prefers-reduced-motion', () => {
    stubReducedMotion(true)
    const wrapper = mount(ScrambleText, { props: { text: TEXT } })
    expect(wrapper.text()).toContain(TEXT)
  })

  it('reserves the final width so settling characters cannot reflow the line', () => {
    // An invisible copy of the full string holds the box open. Without it the
    // element grows as characters lock in and everything below it shifts.
    const wrapper = mount(ScrambleText, { props: { text: TEXT } })
    const sizer = wrapper.find('span.invisible')
    expect(sizer.exists()).toBe(true)
    expect(sizer.text()).toBe(TEXT)
  })

  it('uses a monospace, tabular box', () => {
    // A proportional font re-flows on every frame as glyphs swap, which reads
    // as jitter rather than as decoding.
    const cls = mount(ScrambleText, { props: { text: TEXT } }).classes()
    expect(cls).toContain('font-mono')
    expect(cls).toContain('tabular-nums')
  })

  it('stays on one reserved line by default, and wraps at spaces when asked', () => {
    const single = mount(ScrambleText, { props: { text: TEXT } })
    expect(single.classes()).toContain('whitespace-pre')
    expect(single.classes()).not.toContain('whitespace-pre-wrap')

    const wrapping = mount(ScrambleText, { props: { text: TEXT, wrap: true } })
    expect(wrapping.classes()).toContain('whitespace-pre-wrap')
    expect(wrapping.classes()).not.toContain('whitespace-pre')
  })
})

describe('MarqueeStrip', () => {
  const ITEMS = ['move coldstore-cross', 'attack wave:0', 'cast q']

  it('duplicates the content EXACTLY twice', () => {
    // The track translates by -50%, so the loop is only seamless if the second
    // copy is byte-identical and there are exactly two.
    const wrapper = mount(MarqueeStrip, { props: { items: ITEMS } })
    const lists = wrapper.findAll('ul')
    expect(lists).toHaveLength(2)
    expect(lists[0]!.text()).toBe(lists[1]!.text())
  })

  it('is hidden from assistive tech — it is duplicated, decorative content', () => {
    const wrapper = mount(MarqueeStrip, { props: { items: ITEMS } })
    expect(wrapper.attributes('aria-hidden')).toBe('true')
  })

  it('renders every item it is given', () => {
    const text = mount(MarqueeStrip, { props: { items: ITEMS } }).text()
    for (const item of ITEMS) expect(text).toContain(item)
  })

  it('takes its duration from the prop rather than a hardcoded value', () => {
    const wrapper = mount(MarqueeStrip, { props: { items: ITEMS, duration: 12 } })
    expect(wrapper.find('.marquee__track').attributes('style')).toContain('12s')
  })
})

describe('ParallaxLayer', () => {
  it('derives its travel from depth — a far layer moves less than a near one', () => {
    // The whole illusion is that distant things move less. If these ever came
    // out equal the scene would be flat.
    const far = mount(ParallaxLayer, { props: { depth: 0.15, distance: 100 } })
    const near = mount(ParallaxLayer, { props: { depth: 0.5, distance: 100 } })
    expect(far.attributes('style')).toContain('15px')
    expect(near.attributes('style')).toContain('50px')
  })

  it('renders its slot content', () => {
    const wrapper = mount(ParallaxLayer, { slots: { default: '<p>layer content</p>' } })
    expect(wrapper.text()).toContain('layer content')
  })
})
