import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TraceRail from '~~/app/components/game/TraceRail.vue'
import { buildTrace } from '~~/app/components/game/traceModel'
import type { TerminalState, TeamId } from '~~/shared/types/game'

const ANCIENTS: Record<TeamId, TerminalState> = {
  chaff: { team: 'chaff', integ: 6000, maxInteg: 6000, alive: true, vulnerable: false },
  audit: { team: 'audit', integ: 4200, maxInteg: 6000, alive: true, vulnerable: true },
}

function mountRail(
  playerZone = 'mid-t2-chaff',
  contacts: Parameters<typeof buildTrace>[0]['contacts'] = [],
) {
  const trace = buildTrace({
    playerZone,
    playerTeam: 'chaff',
    contacts,
    terminals: ANCIENTS,
  })
  return mount(TraceRail, { props: { trace } })
}

describe('TraceRail', () => {
  it('renders the current route as hop depth', () => {
    const wrapper = mountRail('mid-t2-chaff')
    expect(wrapper.get('[data-testid="trace-current"]').text()).toContain('hop 2/8')
  })

  it('renders one line per other route', () => {
    const wrapper = mountRail('mid-t2-chaff')
    expect(wrapper.find('[data-testid="trace-route-top"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="trace-route-bot"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="trace-route-mid"]').exists()).toBe(false)
  })

  it('renders the contacts list with hostile/friendly markers', () => {
    const wrapper = mountRail('mid-river', [
      { id: 'e1', name: 'Enemy1', zone: 'mid-t1-audit', team: 'audit', alive: true },
      { id: 'a1', name: 'Ally1', zone: 'mid-river', team: 'chaff', alive: true },
    ])
    expect(wrapper.get('[data-testid="trace-contact-e1"]').text()).toContain('✕')
    expect(wrapper.get('[data-testid="trace-contact-a1"]').text()).toContain('○')
  })

  it('renders both terminals with hp and vulnerability', () => {
    const wrapper = mountRail()
    const chaff = wrapper.get('[data-testid="trace-terminal-chaff"]')
    expect(chaff.text()).toContain('6000/6000')
    const audit = wrapper.get('[data-testid="trace-terminal-audit"]')
    expect(audit.text()).toContain('4200/6000')
    expect(audit.text()).toContain('⚠')
  })

  it('reads off-route when the player is off all three routes', () => {
    const wrapper = mountRail('hollow')
    expect(wrapper.get('[data-testid="trace-current"]').text()).toContain('off route')
  })
})
