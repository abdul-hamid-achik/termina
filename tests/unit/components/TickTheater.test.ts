import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TickTheater from '../../../app/components/game/TickTheater.vue'
import type { CombatLine } from '../../../app/utils/combatLog'

const CombatLogStub = {
  name: 'CombatLog',
  props: ['events'],
  template: '<div data-testid="combat-log-stub" :data-count="events.length" />',
}

function mountTheater(props: Partial<Record<string, unknown>> = {}) {
  return mount(TickTheater, {
    props: {
      events: [] as CombatLine[],
      status: 'AWAITING ORDERS',
      bar: '████░░░░',
      tickImminent: false,
      nextTickIn: 2500,
      isAlive: true,
      canAct: true,
      pulseKey: 0,
      ...props,
    },
    global: { stubs: { CombatLog: CombatLogStub } },
  })
}

describe('TickTheater', () => {
  it('renders the status label and the tick countdown', () => {
    const wrapper = mountTheater({ status: 'AWAITING ORDERS', nextTickIn: 2500 })

    const header = wrapper.find('[data-testid="theater-header"]')
    expect(header.exists()).toBe(true)
    expect(header.text()).toContain('AWAITING ORDERS')
    // 2500ms → T-2.5s
    expect(header.text()).toContain('T-2.5s')
  })

  it('forwards events to the combat log', () => {
    const events = [
      { tick: 1, text: 'a', type: 'system' },
      { tick: 1, text: 'b', type: 'damage' },
    ] as CombatLine[]
    const wrapper = mountTheater({ events })

    expect(wrapper.find('[data-testid="combat-log-stub"]').attributes('data-count')).toBe('2')
  })

  it('uses the dire color for the status when the hero is down', () => {
    const wrapper = mountTheater({ isAlive: false, status: 'DOWN' })
    const label = wrapper.find('[data-testid="theater-header"] span')
    expect(label.classes()).toContain('text-dire')
  })

  it('warns (text-warn) on the status label when a tick is imminent and the player can act', () => {
    const wrapper = mountTheater({ isAlive: true, canAct: true, tickImminent: true })
    const label = wrapper.find('[data-testid="theater-header"] span')
    expect(label.classes()).toContain('text-warn')
  })
})
