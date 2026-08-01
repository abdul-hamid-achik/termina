import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import StreamLine from '~~/app/components/game/StreamLine.vue'

/**
 * The decode effect on a feed line.
 *
 * The whole risk of this component is that it makes the game HARDER to read for
 * the sake of looking good — so every assertion here is about the text surviving
 * the effect, not about the effect happening.
 */
function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion: reduce'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
}

beforeEach(() => {
  stubReducedMotion(false)
  vi.stubGlobal('requestAnimationFrame', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('StreamLine', () => {
  const TEXT = 'Echo SIGKILLd Daemon for 240'

  /**
   * Drives the component's frame loop by hand.
   *
   * The first version of these tests just mounted and asserted — and passed
   * with the layering DELETED, because the animation never actually started
   * under the test's stubs. A decode test that never decodes proves nothing, so
   * the callback is captured and invoked here.
   */
  function mountRunning(text = TEXT) {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb)
      return frames.length
    })
    // The component times itself against `performance.now()`, so frames must be
    // stamped on the same clock — passing a raw 0 makes elapsed time NEGATIVE
    // and the decode reads as already over. The clock is FROZEN so the maths is
    // exact: with a live clock, however long `mount` happens to take is added to
    // every offset, which silently advanced the decode and made a cap assertion
    // pass on an uncapped component.
    const t0 = 1_000_000
    vi.spyOn(performance, 'now').mockReturnValue(t0)
    const wrapper = mount(StreamLine, { props: { text } })
    return {
      wrapper,
      /** @param offset ms since mount */
      step: (offset: number) => frames[frames.length - 1]?.(t0 + offset),
      frames,
    }
  }

  it('renders the REAL text from the very first frame', () => {
    const wrapper = mount(StreamLine, { props: { text: TEXT } })
    expect(wrapper.text()).toContain(TEXT)
  })

  it('keeps the real text in the DOM while the churn is on screen', async () => {
    // The churn is an overlay, never a replacement: a screen reader, a text
    // search and the e2e suite must all see the final line even mid-animation.
    const { wrapper, step, frames } = mountRunning()
    expect(
      frames.length,
      'the decode never started — this test would prove nothing',
    ).toBeGreaterThan(0)

    step(0) // first frame: the tail is fully scrambled
    await wrapper.vm.$nextTick()

    const overlay = wrapper.find('[aria-hidden="true"]')
    expect(overlay.exists(), 'no churn layer rendered').toBe(true)
    expect(
      overlay.text(),
      'the overlay is showing the finished text, so nothing is decoding',
    ).not.toBe(TEXT)
    // ...and the real line is still there underneath, unchanged.
    expect(wrapper.text()).toContain(TEXT)
  })

  it('settles to exactly the real text and stops', async () => {
    const { wrapper, step } = mountRunning()
    step(0)
    await wrapper.vm.$nextTick()
    step(10_000) // well past the duration
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[aria-hidden="true"]').exists(), 'the churn never cleared').toBe(false)
    expect(wrapper.text()).toContain(TEXT)
  })

  it('leaves the head of the line legible immediately', async () => {
    // Only the tail is ever scrambled, so a player skimming for "who hit me" is
    // never made to wait for an animation.
    const long = 'Kernel took 180 kinetic from Daemon in Coldstore T1'
    const { wrapper, step } = mountRunning(long)
    step(0)
    await wrapper.vm.$nextTick()
    const overlay = wrapper.find('[aria-hidden="true"]').text()
    expect(overlay.startsWith(long.slice(0, 12))).toBe(true)
  })

  it('animates nothing at all under prefers-reduced-motion', () => {
    stubReducedMotion(true)
    const raf = vi.fn()
    vi.stubGlobal('requestAnimationFrame', raf)
    const wrapper = mount(StreamLine, { props: { text: TEXT } })
    expect(raf, 'a frame loop was started despite reduced motion').not.toHaveBeenCalled()
    expect(wrapper.text()).toContain(TEXT)
    expect(wrapper.find('[aria-hidden="true"]').exists()).toBe(false)
  })

  it('does nothing for an empty line', () => {
    const raf = vi.fn()
    vi.stubGlobal('requestAnimationFrame', raf)
    mount(StreamLine, { props: { text: '' } })
    expect(raf).not.toHaveBeenCalled()
  })

  it('cleans up its frame loop on unmount', () => {
    const cancel = vi.fn()
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 42),
    )
    vi.stubGlobal('cancelAnimationFrame', cancel)
    mount(StreamLine, { props: { text: TEXT } }).unmount()
    expect(cancel, 'the feed would leak one RAF per line').toHaveBeenCalled()
  })

  it('decodes once on mount and never re-runs for a line already on screen', () => {
    // Re-scrambling history every cycle would make the log unreadable. The
    // component has no watcher on `text` — mounting is the only trigger.
    const raf = vi.fn()
    vi.stubGlobal('requestAnimationFrame', raf)
    const wrapper = mount(StreamLine, { props: { text: TEXT } })
    const callsAfterMount = raf.mock.calls.length
    expect(callsAfterMount).toBeGreaterThan(0)
    wrapper.setProps({ text: 'a completely different line' })
    expect(raf.mock.calls.length).toBe(callsAfterMount)
  })
})
