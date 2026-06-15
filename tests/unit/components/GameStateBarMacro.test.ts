import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import GameStateBar from '../../../app/components/game/GameStateBar.vue'
import { makeTeamState, makeAncient } from '../../../app/stories/fixtures'

/**
 * Covers GameStateBar branches the existing test skips: the day/night clock
 * (formatTimeRemaining for both phases), the connection indicator's three
 * states, the net-worth "even"/dire-leader branches, and corePct's
 * missing-ancient guard.
 */

const baseProps = {
  tick: 42,
  gameTime: '02:48',
  gold: 1234,
  kills: 3,
  deaths: 1,
  assists: 5,
}

function mountBar(props: Record<string, unknown>) {
  return mount(GameStateBar, {
    props: { ...baseProps, ...props } as InstanceType<typeof GameStateBar>['$props'],
    global: { stubs: { HeroAvatar: true } },
  })
}

describe('GameStateBar day/night clock', () => {
  it('labels the daytime phase and renders the remaining-day clock', () => {
    // day: 300 total ticks * 4s; at dayNightTick 0 that's the full 20:00.
    const w = mountBar({ timeOfDay: 'day', dayNightTick: 0 })
    expect(w.text()).toContain('Day')
    expect(w.text()).toContain('20:00')
  })

  it('labels the night phase and renders the remaining-night clock', () => {
    // night: 240 total; at dayNightTick 236 -> 4 ticks left -> 16s -> 0:16.
    const w = mountBar({ timeOfDay: 'night', dayNightTick: 236 })
    expect(w.text()).toContain('Night')
    expect(w.text()).toContain('0:16')
  })

  it('omits the clock when dayNightTick is not provided', () => {
    const w = mountBar({ timeOfDay: 'day' })
    expect(w.text()).toContain('Day')
    // No "(m:ss)" parenthetical without a tick.
    expect(w.text()).not.toMatch(/\(\d+:\d{2}\)/)
  })
})

describe('GameStateBar connection indicator', () => {
  it('shows [RECONNECTING...] when reconnecting', () => {
    const w = mountBar({ reconnecting: true, connected: false })
    expect(w.text()).toContain('[RECONNECTING...]')
  })

  it('shows [ONLINE <latency>ms] when connected', () => {
    const w = mountBar({ connected: true, latency: 37 })
    expect(w.text()).toContain('[ONLINE 37ms]')
  })

  it('shows [OFFLINE] when neither connected nor reconnecting', () => {
    const w = mountBar({ connected: false, reconnecting: false })
    expect(w.text()).toContain('[OFFLINE]')
  })
})

describe('GameStateBar net-worth lead', () => {
  const teams = { radiant: makeTeamState('radiant'), dire: makeTeamState('dire') }

  it('shows "even" when net worth is tied', () => {
    const w = mountBar({ teams, netWorthRadiant: 5000, netWorthDire: 5000 })
    expect(w.find('[data-testid="networth-lead"]').text()).toContain('even')
  })

  it('shows a DIRE lead when dire is ahead', () => {
    const w = mountBar({ teams, netWorthRadiant: 4000, netWorthDire: 7500 })
    const lead = w.find('[data-testid="networth-lead"]')
    expect(lead.text()).toContain('DIRE')
    expect(lead.text()).toContain('+3.5k')
  })
})

describe('GameStateBar core HP', () => {
  it('renders Core percentages from ancient HP, flagging the vulnerable team', () => {
    const ancients = {
      radiant: makeAncient('radiant', { hp: 4500, maxHp: 4500, vulnerable: false }),
      dire: makeAncient('dire', { hp: 2250, maxHp: 4500, vulnerable: true }),
    }
    const w = mountBar({
      teams: { radiant: makeTeamState('radiant'), dire: makeTeamState('dire') },
      ancients,
    })
    const strip = w.find('[data-testid="macro-strip"]')
    expect(strip.text()).toContain('R 100%')
    expect(strip.text()).toContain('D 50%')
    // vulnerable dire core gets the urgent class
    expect(w.html()).toContain('text-warn')
  })

  it('omits the core readout when no ancients are supplied', () => {
    const w = mountBar({
      teams: { radiant: makeTeamState('radiant'), dire: makeTeamState('dire') },
    })
    expect(w.find('[data-testid="macro-strip"]').exists()).toBe(true)
    expect(w.text()).not.toContain('CORE')
  })
})
