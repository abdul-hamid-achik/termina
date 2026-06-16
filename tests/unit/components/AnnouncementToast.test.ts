import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import AnnouncementToast from '../../../app/components/game/AnnouncementToast.vue'

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
      props: { text: 'Not enough mana', seq: 0, durationMs: 2000 },
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
      props: { text: 'Roshan can only be attacked from the pit', seq: 1, level: 'warning' },
    })
    await wrapper.setProps({ seq: 2 })
    let box = wrapper.find('.announcement-toast > div')
    expect(box.classes()).toContain('text-warn')

    // An info message ("Reconnected", "Joined game") must read neutral, not amber.
    await wrapper.setProps({ text: 'Reconnected to game', level: 'info', seq: 3 })
    box = wrapper.find('.announcement-toast > div')
    expect(box.classes()).toContain('text-self')
    expect(box.classes()).not.toContain('text-warn')

    // Errors read dire, with the synthetic [ERROR] prefix stripped from display.
    await wrapper.setProps({ text: '[ERROR] Connection lost', level: 'error', seq: 4 })
    box = wrapper.find('.announcement-toast > div')
    expect(box.classes()).toContain('text-dire')
    expect(wrapper.text()).toContain('Connection lost')
    expect(wrapper.text()).not.toContain('[ERROR]')
  })

  it('keeps the on-screen toast colour even if the level prop changes before the next seq', async () => {
    const wrapper = mount(AnnouncementToast, {
      props: { text: 'Not enough mana', seq: 1, level: 'warning' },
    })
    await wrapper.setProps({ seq: 2 }) // shows the warning
    // The parent updates level for the NEXT (not-yet-fired) announcement.
    await wrapper.setProps({ level: 'info' })
    // The visible toast is still the amber warning — its level was snapshotted.
    expect(wrapper.find('.announcement-toast > div').classes()).toContain('text-warn')
  })
})
