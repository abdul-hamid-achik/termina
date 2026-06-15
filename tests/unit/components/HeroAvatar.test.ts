import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import HeroAvatar from '../../../app/components/avatars/HeroAvatar.vue'
import { SAMPLE_HEROES } from '../../../app/stories/fixtures'

function mountAvatar(props: { heroId: string; size?: number }) {
  return mount(HeroAvatar, { props, attachTo: document.body })
}

describe('HeroAvatar', () => {
  it('renders a bordered frame wrapping a canvas', () => {
    const wrapper = mountAvatar({ heroId: SAMPLE_HEROES.echo })

    const frame = wrapper.find('div')
    expect(frame.classes()).toContain('border')
    expect(wrapper.find('canvas').exists()).toBe(true)
    wrapper.unmount()
  })

  it('defaults to a 48px square frame and canvas', () => {
    const wrapper = mountAvatar({ heroId: SAMPLE_HEROES.echo })

    const frameStyle = wrapper.find('div').attributes('style') ?? ''
    expect(frameStyle).toContain('width: 48px')
    expect(frameStyle).toContain('height: 48px')

    const canvasStyle = wrapper.find('canvas').attributes('style') ?? ''
    expect(canvasStyle).toContain('width: 48px')
    expect(canvasStyle).toContain('height: 48px')
    wrapper.unmount()
  })

  it('honours a custom size on both the frame and canvas', () => {
    const wrapper = mountAvatar({ heroId: SAMPLE_HEROES.kernel, size: 96 })

    expect(wrapper.find('div').attributes('style')).toContain('width: 96px')
    expect(wrapper.find('canvas').attributes('style')).toContain('width: 96px')
    wrapper.unmount()
  })

  it('renders the canvas with pixelated image rendering', () => {
    const wrapper = mountAvatar({ heroId: SAMPLE_HEROES.echo })

    expect(wrapper.find('canvas').attributes('style')).toContain('image-rendering: pixelated')
    wrapper.unmount()
  })

  it('mounts without throwing for several real hero ids', () => {
    for (const id of [SAMPLE_HEROES.echo, SAMPLE_HEROES.daemon, SAMPLE_HEROES.cipher]) {
      const wrapper = mountAvatar({ heroId: id })
      expect(wrapper.find('canvas').exists()).toBe(true)
      wrapper.unmount()
    }
  })

  it('still renders the frame/canvas for an unknown hero id (draw bails gracefully)', () => {
    const wrapper = mountAvatar({ heroId: 'does_not_exist' })

    expect(wrapper.find('div').classes()).toContain('border')
    expect(wrapper.find('canvas').exists()).toBe(true)
    wrapper.unmount()
  })

  it('re-renders when the heroId prop changes', async () => {
    const wrapper = mountAvatar({ heroId: SAMPLE_HEROES.echo })

    await wrapper.setProps({ heroId: SAMPLE_HEROES.regex })

    // the canvas element survives the prop change and is still mounted
    expect(wrapper.find('canvas').exists()).toBe(true)
    wrapper.unmount()
  })
})
