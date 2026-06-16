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

  it('styles a warning amber and an [ERROR] dire, stripping the prefix', async () => {
    const wrapper = mount(AnnouncementToast, {
      props: { text: 'Roshan can only be attacked from the pit', seq: 1 },
    })
    // (seq started at 1, so bump to trigger)
    await wrapper.setProps({ seq: 2 })
    let box = wrapper.find('.announcement-toast > div')
    expect(box.classes()).toContain('text-warn')
    expect(box.classes()).not.toContain('text-dire')

    await wrapper.setProps({ text: '[ERROR] Connection lost', seq: 3 })
    box = wrapper.find('.announcement-toast > div')
    expect(box.classes()).toContain('text-dire')
    expect(wrapper.text()).toContain('Connection lost')
    expect(wrapper.text()).not.toContain('[ERROR]') // prefix stripped from display
  })
})
