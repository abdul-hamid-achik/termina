import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TargetDummy from '~~/app/components/heroes/TargetDummy.vue'

function mountDummy(props: Record<string, unknown> = {}) {
  return mount(TargetDummy, {
    props: { name: 'Target Dummy', integ: 1000, maxInteg: 1000, ...props },
  })
}

describe('TargetDummy', () => {
  it('renders the name and current/max hp', () => {
    const wrapper = mountDummy({ integ: 720, maxInteg: 1000 })

    const text = wrapper.text()
    expect(text).toContain('Target Dummy')
    expect(text).toContain('720 / 1000 hp')
  })

  it('sizes the bar to the hp percentage', () => {
    const wrapper = mountDummy({ integ: 250, maxInteg: 1000 })
    const bar = wrapper.find('[data-testid="target-dummy-bar"]')
    expect(bar.attributes('style')).toContain('width: 25%')
  })

  it('clamps the bar between 0 and 100%', () => {
    const over = mountDummy({ integ: 1500, maxInteg: 1000 })
    expect(over.find('[data-testid="target-dummy-bar"]').attributes('style')).toContain(
      'width: 100%',
    )

    const under = mountDummy({ integ: -50, maxInteg: 1000 })
    expect(under.find('[data-testid="target-dummy-bar"]').attributes('style')).toContain(
      'width: 0%',
    )
  })

  describe('health colour', () => {
    it('is chaff above 50%', () => {
      expect(
        mountDummy({ integ: 800 }).find('[data-testid="target-dummy-bar"]').classes(),
      ).toContain('bg-chaff')
    })
    it('is scrip between 26% and 50%', () => {
      expect(
        mountDummy({ integ: 400 }).find('[data-testid="target-dummy-bar"]').classes(),
      ).toContain('bg-gold')
    })
    it('is audit at 25% or below', () => {
      expect(
        mountDummy({ integ: 200 }).find('[data-testid="target-dummy-bar"]').classes(),
      ).toContain('bg-audit')
    })
    it('pins the boundaries: exactly 50% is scrip, exactly 25% is audit', () => {
      expect(
        mountDummy({ integ: 500, maxInteg: 1000 })
          .find('[data-testid="target-dummy-bar"]')
          .classes(),
      ).toContain('bg-gold')
      expect(
        mountDummy({ integ: 250, maxInteg: 1000 })
          .find('[data-testid="target-dummy-bar"]')
          .classes(),
      ).toContain('bg-audit')
    })
  })

  it('handles maxInteg=0 without NaN (0% width, DESTROYED)', () => {
    const wrapper = mountDummy({ integ: 0, maxInteg: 0 })
    expect(wrapper.find('[data-testid="target-dummy-bar"]').attributes('style')).toContain(
      'width: 0%',
    )
    expect(wrapper.text()).toContain('DESTROYED')
  })

  it('shows DESTROYED when hp reaches zero', () => {
    const wrapper = mountDummy({ integ: 0 })
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

  describe('control status chips', () => {
    it('renders a chip per active control with its label + cycles left', () => {
      const wrapper = mountDummy({
        statuses: [
          { label: 'STUNNED', ticksLeft: 2 },
          { label: 'SLOW 30%', ticksLeft: 3 },
        ],
      })
      const chips = wrapper.find('[data-testid="target-dummy-statuses"]')
      expect(chips.exists()).toBe(true)
      expect(chips.text()).toContain('STUNNED · 2c')
      expect(chips.text()).toContain('SLOW 30% · 3c')
    })

    it('hides the status row when there are no controls', () => {
      expect(mountDummy().find('[data-testid="target-dummy-statuses"]').exists()).toBe(false)
      expect(
        mountDummy({ statuses: [] }).find('[data-testid="target-dummy-statuses"]').exists(),
      ).toBe(false)
    })
  })
})
