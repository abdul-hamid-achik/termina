import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import GameStateBar from '../../../app/components/game/GameStateBar.vue'

const baseProps = {
  tick: 42,
  gameTime: '02:48',
  gold: 1234,
  kills: 3,
  deaths: 1,
  assists: 5,
}

// HeroAvatar is Nuxt-auto-imported; stub it so resolution warnings stay quiet
function mountBar(props: Record<string, unknown>) {
  return mount(GameStateBar, {
    props: props as InstanceType<typeof GameStateBar>['$props'],
    global: { stubs: { HeroAvatar: true } },
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
    it('shows the countdown in seconds when nextTickIn is provided', () => {
      const wrapper = mountBar({ ...baseProps, nextTickIn: 2400 })

      const countdown = wrapper.find('[data-testid="tick-countdown"]')
      expect(countdown.exists()).toBe(true)
      expect(countdown.text()).toContain('next tick')
      expect(countdown.text()).toContain('2.4s')
    })

    it('renders a fuller bar with more time remaining', () => {
      const nearlyFull = mountBar({ ...baseProps, nextTickIn: 4000 })
      const nearlyEmpty = mountBar({ ...baseProps, nextTickIn: 400 })

      const fullBar = nearlyFull.find('[data-testid="tick-countdown"]').text()
      const emptyBar = nearlyEmpty.find('[data-testid="tick-countdown"]').text()

      const count = (s: string, ch: string) => s.split(ch).length - 1
      expect(count(fullBar, '█')).toBeGreaterThan(count(emptyBar, '█'))
    })

    it('shows 0.0s when the tick is due', () => {
      const wrapper = mountBar({ ...baseProps, nextTickIn: 0 })

      expect(wrapper.find('[data-testid="tick-countdown"]').text()).toContain('0.0s')
    })

    it('hides the countdown when nextTickIn is not provided', () => {
      const wrapper = mountBar(baseProps)

      expect(wrapper.find('[data-testid="tick-countdown"]').exists()).toBe(false)
    })
  })

  describe('macro strip', () => {
    const teams = {
      radiant: { id: 'radiant', kills: 12, towerKills: 3, gold: 0, glyphUsedTick: null },
      dire: { id: 'dire', kills: 8, towerKills: 1, gold: 0, glyphUsedTick: null },
    }
    const ancients = {
      radiant: { team: 'radiant', hp: 6000, maxHp: 6000, alive: true, vulnerable: false },
      dire: { team: 'dire', hp: 3000, maxHp: 6000, alive: true, vulnerable: true },
    }

    it('is hidden without team data', () => {
      expect(mountBar(baseProps).find('[data-testid="macro-strip"]').exists()).toBe(false)
    })

    it('shows team score, net-worth lead, towers, and Core HP', () => {
      const w = mountBar({
        ...baseProps,
        teams,
        ancients,
        netWorthRadiant: 12000,
        netWorthDire: 8000,
      })
      const strip = w.find('[data-testid="macro-strip"]')
      expect(strip.exists()).toBe(true)
      expect(strip.text()).toContain('12') // radiant kills
      expect(strip.text()).toContain('8') // dire kills
      const lead = w.find('[data-testid="networth-lead"]')
      expect(lead.text()).toContain('RAD')
      expect(lead.text()).toContain('4.0k')
      expect(strip.text()).toContain('50%') // dire core at half
    })
  })
})
