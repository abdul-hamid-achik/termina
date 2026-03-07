import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CombatLog from '../../../app/components/game/CombatLog.vue'

interface LogEvent {
  tick: number
  text: string
  type: 'damage' | 'healing' | 'kill' | 'gold' | 'system' | 'ability'
  killerHeroId?: string
  victimHeroId?: string
}

function makeEvent(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    tick: 1,
    text: 'Test event',
    type: 'system',
    ...overrides,
  }
}

describe('CombatLog', () => {
  describe('accessibility', () => {
    it('should have text prefix for event type', () => {
      const events = [
        makeEvent({ type: 'damage', text: 'Player1 dealt 50 damage' }),
        makeEvent({ type: 'healing', text: 'Player1 healed for 30' }),
        makeEvent({ type: 'kill', text: 'Player1 killed Player2' }),
        makeEvent({ type: 'gold', text: 'Player1 earned 100g' }),
      ]
      const wrapper = mount(CombatLog, { props: { events } })

      const eventElements = wrapper.findAll('[data-testid="log-event"]')
      expect(eventElements[0]?.text()).toContain('[DAMAGE]')
      expect(eventElements[1]?.text()).toContain('[HEAL]')
      expect(eventElements[2]?.text()).toContain('[KILL]')
      expect(eventElements[3]?.text()).toContain('[GOLD]')
    })

    it('should be readable by screen readers', () => {
      const events = [makeEvent({ type: 'kill', text: 'Player1 killed Player2' })]
      const wrapper = mount(CombatLog, { props: { events } })

      const event = wrapper.find('[data-testid="log-event"]')
      expect(event.attributes('aria-label')).toBeDefined()
    })

    it('should have aria-live region for new events', () => {
      const events = [makeEvent()]
      const wrapper = mount(CombatLog, { props: { events } })

      const liveRegion = wrapper.find('[aria-live="polite"]')
      expect(liveRegion.exists()).toBe(true)
    })
  })

  describe('event display', () => {
    it('should display tick number', () => {
      const events = [makeEvent({ tick: 42 })]
      const wrapper = mount(CombatLog, { props: { events } })

      expect(wrapper.text()).toContain('[T42]')
    })

    it('should color events by type', () => {
      const events = [makeEvent({ type: 'damage' }), makeEvent({ type: 'healing' })]
      const wrapper = mount(CombatLog, { props: { events } })

      const damageEvent = wrapper.find('.border-l-damage')
      const healEvent = wrapper.find('.border-l-healing')

      expect(damageEvent.exists()).toBe(true)
      expect(healEvent.exists()).toBe(true)
    })

    it('should show empty state when no events', () => {
      const wrapper = mount(CombatLog, { props: { events: [] } })

      expect(wrapper.text()).toContain('awaiting events')
    })
  })
})
