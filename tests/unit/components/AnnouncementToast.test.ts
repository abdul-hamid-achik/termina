import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import AnnouncementToast from '~~/app/components/game/AnnouncementToast.vue'

describe('AnnouncementToast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('stays hidden until a new announcement arrives (seq bump)', () => {
    const wrapper = mount(AnnouncementToast, {
      props: { text: 'Target is not in your zone', seq: 0 },
    })
    // seq 0 = nothing has happened yet — no toast on mount.
    expect(wrapper.find('.announcement-toast').exists()).toBe(false)
  })

  it('shows the message when seq increments, then auto-hides after the duration', async () => {
    const wrapper = mount(AnnouncementToast, {
      props: { text: 'Target is not in your zone', seq: 0, durationMs: 3000 },
    })

    await wrapper.setProps({ seq: 1 })
    expect(wrapper.find('.announcement-toast').exists()).toBe(true)
    expect(wrapper.text()).toContain('Target is not in your zone')

    vi.advanceTimersByTime(3001)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.announcement-toast').exists()).toBe(false)
  })

  it('a repeated identical message re-shows the toast (monotonic seq, not text diff)', async () => {
    const wrapper = mount(AnnouncementToast, {
      props: { text: 'Not enough BW', seq: 0, durationMs: 2000 },
    })

    await wrapper.setProps({ seq: 1 })
    vi.advanceTimersByTime(2001)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.announcement-toast').exists()).toBe(false)

    // Same text, next seq — the player spammed the same invalid action.
    await wrapper.setProps({ seq: 2 })
    expect(wrapper.find('.announcement-toast').exists()).toBe(true)
  })

  it('colours each severity from the level prop (info is NOT an amber warning)', async () => {
    const wrapper = mount(AnnouncementToast, {
      props: { text: 'Tenant can only be attacked from the pit', seq: 1, level: 'warning' },
    })
    await wrapper.setProps({ seq: 2 })
    let box = wrapper.find('.announcement-toast > div')
    expect(box.classes()).toContain('text-warn')

    // An info message ("Reconnected", "Joined game") must read neutral, not amber.
    await wrapper.setProps({ text: 'Reconnected to game', level: 'info', seq: 3 })
    box = wrapper.find('.announcement-toast > div')
    expect(box.classes()).toContain('text-self')
    expect(box.classes()).not.toContain('text-warn')

    // Errors read audit, with the synthetic [ERROR] prefix stripped from display.
    await wrapper.setProps({ text: '[ERROR] Connection lost', level: 'error', seq: 4 })
    box = wrapper.find('.announcement-toast > div')
    expect(box.classes()).toContain('text-audit')
    expect(wrapper.text()).toContain('Connection lost')
    expect(wrapper.text()).not.toContain('[ERROR]')
  })

  it('renders the objective severity as scrip with a ★ icon', async () => {
    const wrapper = mount(AnnouncementToast, {
      props: { text: 'Tenant has been slain!', seq: 1, level: 'objective' },
    })
    await wrapper.setProps({ seq: 2 })
    const box = wrapper.find('.announcement-toast > div')
    expect(box.classes()).toContain('text-gold')
    expect(box.classes()).toContain('border-gold')
    expect(wrapper.text()).toContain('★')
    expect(wrapper.text()).toContain('Tenant has been slain!')
  })

  it('renders the kill severity as audit with a ✕ icon', async () => {
    const wrapper = mount(AnnouncementToast, {
      props: { text: 'First Blood!', seq: 1, level: 'kill' },
    })
    await wrapper.setProps({ seq: 2 })
    const box = wrapper.find('.announcement-toast > div')
    expect(box.classes()).toContain('text-audit')
    expect(wrapper.text()).toContain('✕')
  })

  it('keeps the on-screen toast colour even if the level prop changes before the next seq', async () => {
    const wrapper = mount(AnnouncementToast, {
      props: { text: 'Not enough BW', seq: 1, level: 'warning' },
    })
    await wrapper.setProps({ seq: 2 }) // shows the warning
    // The parent updates level for the NEXT (not-yet-fired) announcement.
    await wrapper.setProps({ level: 'info' })
    // The visible toast is still the amber warning — its level was snapshotted.
    expect(wrapper.find('.announcement-toast > div').classes()).toContain('text-warn')
  })

  // Playtest 3: "! No waves in this zone to attack" sat in the header long
  // after the order it was about. It is about its own moment: it clears once the
  // clock is two cycles on, or the moment the next order is accepted.
  describe('clears when its moment is over', () => {
    const LONG = 60_000 // the timer alone would keep it up

    it('two cycles after it arrived', async () => {
      const w = mount(AnnouncementToast, {
        props: { text: 'No waves in this zone to attack', seq: 0, durationMs: LONG, cycle: 10 },
      })
      await w.setProps({ seq: 1 })
      await w.setProps({ cycle: 11 })
      expect(w.find('.announcement-toast').exists()).toBe(true)
      await w.setProps({ cycle: 12 })
      expect(w.find('.announcement-toast').exists()).toBe(false)
    })

    it('a toast arriving later counts from its own cycle', async () => {
      const w = mount(AnnouncementToast, {
        props: { text: 'a', seq: 0, durationMs: LONG, cycle: 10 },
      })
      await w.setProps({ seq: 1 })
      await w.setProps({ cycle: 13 })
      await w.setProps({ text: 'b', seq: 2 })
      await w.setProps({ cycle: 14 })
      expect(w.find('.announcement-toast').exists()).toBe(true)
    })

    it('on the next accepted order', async () => {
      const w = mount(AnnouncementToast, {
        props: { text: 'No waves in this zone to attack', seq: 0, durationMs: LONG, clearKey: 0 },
      })
      await w.setProps({ seq: 1 })
      await w.setProps({ clearKey: 1 })
      expect(w.find('.announcement-toast').exists()).toBe(false)
    })
  })
})

// Round 5: a hidden toast stayed in the DOM for minutes as
// `toast-pop-leave-active toast-pop-leave-from` — Vue's CSS leave waits on
// requestAnimationFrame, which never runs in a background/automation tab. The
// REAL <Transition> (VTU stubs it by default, which would pass either way).
describe('AnnouncementToast leave transition', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // A tab that never paints: rAF callbacks never run.
    vi.stubGlobal('requestAnimationFrame', () => 0)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function shownThenHidden(reduceMotion: boolean) {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: reduceMotion && q.includes('prefers-reduced-motion'),
      media: q,
    }))
    const wrapper = mount(AnnouncementToast, {
      props: { text: 'Target is not in your zone', seq: 0, durationMs: 1000 },
      global: { stubs: { transition: false } },
      attachTo: document.body,
    })
    await wrapper.setProps({ seq: 1 })
    expect(wrapper.find('.announcement-toast').exists()).toBe(true)
    vi.advanceTimersByTime(1001)
    await wrapper.vm.$nextTick()
    return wrapper
  }

  it('removes the node once the leave time has passed, with no animation frame', async () => {
    const wrapper = await shownThenHidden(false)
    vi.advanceTimersByTime(500)
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.announcement-toast')).toBeNull()
    wrapper.unmount()
  })

  it('removes it at once under reduced motion', async () => {
    const wrapper = await shownThenHidden(true)
    expect(document.querySelector('.announcement-toast')).toBeNull()
    wrapper.unmount()
  })
})
