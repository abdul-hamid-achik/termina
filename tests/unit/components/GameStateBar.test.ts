import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import GameStateBar from '~~/app/components/game/GameStateBar.vue'

const baseProps = {
  tick: 42,
  gameTime: '02:48',
  gold: 1234,
  kills: 3,
  deaths: 1,
  assists: 5,
}

// HeroPortrait is Nuxt-auto-imported; stub it so resolution warnings stay quiet
function mountBar(props: Record<string, unknown>) {
  return mount(GameStateBar, {
    props: props as InstanceType<typeof GameStateBar>['$props'],
    global: { stubs: { HeroPortrait: true } },
  })
}

describe('GameStateBar', () => {
  it('renders core stats', () => {
    const wrapper = mountBar(baseProps)

    expect(wrapper.text()).toContain('42')
    expect(wrapper.text()).toContain('02:48')
    expect(wrapper.text()).toContain('1,234')
  })

  describe('tick countdown', () => {
    it('renders NO countdown — the theater header is the game’s single clock', () => {
      // Four simultaneous countdowns was a legibility complaint; the bar keeps
      // only the tick number.
      const wrapper = mountBar(baseProps)
      expect(wrapper.find('[data-testid="tick-countdown"]').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('next tick')
    })
  })

  describe('day/night tooltip (new-player clarity)', () => {
    const titles = (w: ReturnType<typeof mountBar>) =>
      w.findAll('[title]').map((el) => el.attributes('title') ?? '')

    it('explains full vision by day', () => {
      const wrapper = mountBar({ ...baseProps, timeOfDay: 'day', dayNightTick: 5 })
      expect(wrapper.text()).toContain('Day')
      expect(titles(wrapper).some((t) => t.includes('full vision'))).toBe(true)
    })

    it('explains reduced vision at night', () => {
      const wrapper = mountBar({ ...baseProps, timeOfDay: 'night', dayNightTick: 5 })
      expect(wrapper.text()).toContain('Night')
      expect(titles(wrapper).some((t) => t.includes('vision is reduced'))).toBe(true)
    })
  })

  describe('macro strip', () => {
    const teams = {
      chaff: { id: 'chaff', kills: 12, iceKills: 3, gold: 0, hardenUsedTick: null },
      audit: { id: 'audit', kills: 8, iceKills: 1, gold: 0, hardenUsedTick: null },
    }
    const ancients = {
      chaff: { team: 'chaff', integ: 6000, maxInteg: 6000, alive: true, vulnerable: false },
      audit: { team: 'audit', integ: 3000, maxInteg: 6000, alive: true, vulnerable: true },
    }

    it('is hidden without team data', () => {
      expect(mountBar(baseProps).find('[data-testid="macro-strip"]').exists()).toBe(false)
    })

    it('shows team score, net-worth lead, ice, and Core INTEG', () => {
      const w = mountBar({
        ...baseProps,
        teams,
        ancients,
        netWorthChaff: 12000,
        netWorthAudit: 8000,
      })
      const strip = w.find('[data-testid="macro-strip"]')
      expect(strip.exists()).toBe(true)
      expect(strip.text()).toContain('12') // chaff kills
      expect(strip.text()).toContain('8') // audit kills
      const lead = w.find('[data-testid="networth-lead"]')
      expect(lead.text()).toContain('RAD')
      expect(lead.text()).toContain('4.0k')
      expect(strip.text()).toContain('50%') // audit core at half
    })
  })
})
