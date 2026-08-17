import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import GameStateBar from '~~/app/components/game/GameStateBar.vue'

vi.mock('~/composables/useAudio', () => ({
  useAudio: () => ({
    playSound: vi.fn(),
    startBed: vi.fn(),
    stopBed: vi.fn(),
    syncBed: vi.fn(),
  }),
}))
import { makeTeamState, makeTerminal } from '~~/app/stories/fixtures'

/**
 * Covers GameStateBar branches the existing test skips: the day/night clock
 * (formatTimeRemaining for both phases), the connection indicator's three
 * states, the net-worth "even"/audit-leader branches, and terminalPct's
 * missing-terminal guard.
 */

const baseProps = {
  cycle: 42,
  gameTime: '02:48',
  scrip: 1234,
  kills: 3,
  deaths: 1,
  assists: 5,
}

function mountBar(props: Record<string, unknown>) {
  return mount(GameStateBar, {
    props: { ...baseProps, ...props } as InstanceType<typeof GameStateBar>['$props'],
    global: { stubs: { HeroPortrait: true } },
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('GameStateBar day/night clock', () => {
  it('labels the daytime phase and renders the remaining-day clock', () => {
    // day: 300 total ticks * 4s; at dayNightCycle 0 that's the full 20:00.
    const w = mountBar({ timeOfDay: 'day', dayNightCycle: 0 })
    expect(w.text()).toContain('Day')
    expect(w.text()).toContain('20:00')
  })

  it('labels the night phase and renders the remaining-night clock', () => {
    // night: 240 total; at dayNightCycle 236 -> 4 cycles left -> 16s -> 0:16.
    const w = mountBar({ timeOfDay: 'night', dayNightCycle: 236 })
    expect(w.text()).toContain('Night')
    expect(w.text()).toContain('0:16')
  })

  it('omits the clock when dayNightCycle is not provided', () => {
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
  const teams = { chaff: makeTeamState('chaff'), audit: makeTeamState('audit') }

  it('shows "even" when net worth is tied', () => {
    const w = mountBar({ teams, netWorthChaff: 5000, netWorthAudit: 5000 })
    expect(w.find('[data-testid="networth-lead"]').text()).toContain('even')
  })

  it('shows an AUD lead when audit is ahead', () => {
    const w = mountBar({ teams, netWorthChaff: 4000, netWorthAudit: 7500 })
    const lead = w.find('[data-testid="networth-lead"]')
    expect(lead.text()).toContain('AUD')
    expect(lead.text()).toContain('+3.5k')
  })
})

describe('GameStateBar core INTEG', () => {
  it('renders Terminal percentages from terminal INTEG, flagging the vulnerable team', () => {
    const terminals = {
      chaff: makeTerminal('chaff', { integ: 4500, maxInteg: 4500, vulnerable: false }),
      audit: makeTerminal('audit', { integ: 2250, maxInteg: 4500, vulnerable: true }),
    }
    const w = mountBar({
      teams: { chaff: makeTeamState('chaff'), audit: makeTeamState('audit') },
      terminals,
    })
    const strip = w.find('[data-testid="macro-strip"]')
    expect(strip.text()).toContain('CHF 100%')
    expect(strip.text()).toContain('AUD 50%')
    // vulnerable audit Terminal gets the urgent class
    expect(w.html()).toContain('text-warn')
  })

  it('drops the macro row in compact (cut) mode', () => {
    const w = mountBar({
      compact: true,
      teams: { chaff: makeTeamState('chaff'), audit: makeTeamState('audit') },
      timeOfDay: 'day',
      dayNightCycle: 0,
    })
    expect(w.find('[data-testid="macro-strip"]').exists()).toBe(false)
    expect(w.text()).toContain('Day')
    expect(w.text()).not.toContain('20:00')
  })

  it('omits the Terminal readout when no terminals are supplied', () => {
    const w = mountBar({
      teams: { chaff: makeTeamState('chaff'), audit: makeTeamState('audit') },
    })
    expect(w.find('[data-testid="macro-strip"]').exists()).toBe(true)
    expect(w.text()).not.toContain('TERMINAL')
  })
})
