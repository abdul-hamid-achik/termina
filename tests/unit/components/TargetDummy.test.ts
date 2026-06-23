import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TargetDummy from '../../../app/components/heroes/TargetDummy.vue'

function mountDummy(props: Record<string, unknown> = {}) {
  return mount(TargetDummy, { props: { name: 'Target Dummy', hp: 1000, maxHp: 1000, ...props } })
}

describe('TargetDummy', () => {
  it('renders the name and current/max hp', () => {
    const wrapper = mountDummy({ hp: 720, maxHp: 1000 })

    const text = wrapper.text()
    expect(text).toContain('Target Dummy')
    expect(text).toContain('720 / 1000 hp')
  })

  it('sizes the bar to the hp percentage', () => {
    const wrapper = mountDummy({ hp: 250, maxHp: 1000 })
    const bar = wrapper.find('[data-testid="target-dummy-bar"]')
    expect(bar.attributes('style')).toContain('width: 25%')
  })

  it('clamps the bar between 0 and 100%', () => {
    const over = mountDummy({ hp: 1500, maxHp: 1000 })
    expect(over.find('[data-testid="target-dummy-bar"]').attributes('style')).toContain(
      'width: 100%',
    )

    const under = mountDummy({ hp: -50, maxHp: 1000 })
    expect(under.find('[data-testid="target-dummy-bar"]').attributes('style')).toContain(
      'width: 0%',
    )
  })

  describe('health colour', () => {
    it('is radiant above 50%', () => {
      expect(mountDummy({ hp: 800 }).find('[data-testid="target-dummy-bar"]').classes()).toContain(
        'bg-radiant',
      )
    })
    it('is gold between 26% and 50%', () => {
      expect(mountDummy({ hp: 400 }).find('[data-testid="target-dummy-bar"]').classes()).toContain(
        'bg-gold',
      )
    })
    it('is dire at 25% or below', () => {
      expect(mountDummy({ hp: 200 }).find('[data-testid="target-dummy-bar"]').classes()).toContain(
        'bg-dire',
      )
    })
    it('pins the boundaries: exactly 50% is gold, exactly 25% is dire', () => {
      expect(
        mountDummy({ hp: 500, maxHp: 1000 }).find('[data-testid="target-dummy-bar"]').classes(),
      ).toContain('bg-gold')
      expect(
        mountDummy({ hp: 250, maxHp: 1000 }).find('[data-testid="target-dummy-bar"]').classes(),
      ).toContain('bg-dire')
    })
  })

  it('handles maxHp=0 without NaN (0% width, DESTROYED)', () => {
    const wrapper = mountDummy({ hp: 0, maxHp: 0 })
    expect(wrapper.find('[data-testid="target-dummy-bar"]').attributes('style')).toContain(
      'width: 0%',
    )
    expect(wrapper.text()).toContain('DESTROYED')
  })

  it('shows DESTROYED when hp reaches zero', () => {
    const wrapper = mountDummy({ hp: 0 })
    expect(wrapper.text()).toContain('DESTROYED')
    expect(wrapper.text()).not.toContain('/ 1000 hp')
  })

  it('surfaces active DoT stacks, pluralised', () => {
    expect(mountDummy({ dots: 1 }).text()).toContain('1 damage-over-time stack active')
    expect(mountDummy({ dots: 3 }).text()).toContain('3 damage-over-time stacks active')
  })

  it('hides the DoT line when there are none', () => {
    expect(mountDummy({ dots: 0 }).text()).not.toContain('damage-over-time')
    expect(mountDummy().text()).not.toContain('damage-over-time')
  })
})
