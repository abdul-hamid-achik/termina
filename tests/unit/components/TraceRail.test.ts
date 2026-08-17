import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TraceRail from '~~/app/components/game/TraceRail.vue'
import { buildTrace } from '~~/app/components/game/traceModel'
import type { TerminalState, TeamId } from '~~/shared/types/game'

const TERMINALS: Record<TeamId, TerminalState> = {
  chaff: { team: 'chaff', integ: 6000, maxInteg: 6000, alive: true, vulnerable: false },
  audit: { team: 'audit', integ: 4200, maxInteg: 6000, alive: true, vulnerable: true },
}

function mountRail(
  playerZone = 'coldstore-t2-chaff',
  contacts: Parameters<typeof buildTrace>[0]['contacts'] = [],
  playerTeam: TeamId = 'chaff',
  visibleZoneIds?: readonly string[],
) {
  const trace = buildTrace({
    playerZone,
    playerTeam,
    contacts,
    terminals: TERMINALS,
    visibleZoneIds,
  })
  return mount(TraceRail, { props: { trace } })
}

describe('TraceRail', () => {
  it('renders the current route as hop depth', () => {
    const wrapper = mountRail('coldstore-t2-chaff')
    expect(wrapper.get('[data-testid="trace-current"]').text()).toContain('hop 2/8')
  })

  it('skips blind other-route lines in compact mode', () => {
    const wrapper = mount(TraceRail, {
      props: {
        compact: true,
        trace: buildTrace({
          playerZone: 'coldstore-t2-chaff',
          playerTeam: 'chaff',
          contacts: [],
          terminals: TERMINALS,
        }),
      },
    })
    expect(wrapper.get('[data-testid="trace-current"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="trace-route-seawall"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="trace-route-shallows"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="trace-terminals"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="trace-current"]').text()).toMatch(/CHF/)
  })

  it('skips quiet other-route lines in compact mode even when they have vision', () => {
    const wrapper = mount(TraceRail, {
      props: {
        compact: true,
        trace: buildTrace({
          playerZone: 'coldstore-t2-chaff',
          playerTeam: 'chaff',
          contacts: [],
          terminals: TERMINALS,
          visibleZoneIds: ['seawall-t1-chaff', 'shallows-t1-chaff'],
        }),
      },
    })
    expect(wrapper.find('[data-testid="trace-route-seawall"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="trace-route-shallows"]').exists()).toBe(false)
  })

  it('renders one line per other route', () => {
    const wrapper = mountRail('coldstore-t2-chaff')
    expect(wrapper.find('[data-testid="trace-route-seawall"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="trace-route-shallows"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="trace-route-coldstore"]').exists()).toBe(false)
  })

  it('renders the contacts list with hostile/friendly markers', () => {
    const wrapper = mountRail('coldstore-cross', [
      { id: 'e1', name: 'Enemy1', zone: 'coldstore-t1-audit', team: 'audit', alive: true },
      { id: 'a1', name: 'Ally1', zone: 'coldstore-cross', team: 'chaff', alive: true },
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

  it('uses terminal and player team identity for faction colors', () => {
    const wrapper = mountRail('coldstore-t2-audit', [], 'audit')
    expect(wrapper.get('[data-testid="trace-current"] span').classes()).toContain('text-audit')
    expect(wrapper.get('[data-testid="trace-terminal-chaff"]').classes()).toContain('text-chaff')
    expect(wrapper.get('[data-testid="trace-terminal-audit"]').classes()).toContain('text-audit')
  })

  it('reads off-route when the player is off all three routes', () => {
    const wrapper = mountRail('hollow')
    expect(wrapper.get('[data-testid="trace-current"]').text()).toContain('off route')
  })

  // The contact list used to paint `hostile ? text-audit : text-chaff`, which is
  // the faction palette used to mean friend/foe. For an AUDIT player that
  // rendered their own allies in the CHAFF colour and their enemies in their own
  // colour — inverted, and contradicting the terminals row in the same panel.
  it('colors a contact by its own faction, for players on either side', () => {
    const contacts: Parameters<typeof buildTrace>[0]['contacts'] = [
      { id: 'c1', name: 'ChaffOp', zone: 'coldstore-cross', team: 'chaff', alive: true },
      { id: 'a1', name: 'AuditOp', zone: 'coldstore-cross', team: 'audit', alive: true },
    ]
    for (const team of ['chaff', 'audit'] as TeamId[]) {
      const wrapper = mountRail('coldstore-cross', contacts, team)
      expect(wrapper.get('[data-testid="trace-contact-c1"]').classes()).toContain('text-chaff')
      expect(wrapper.get('[data-testid="trace-contact-a1"]').classes()).toContain('text-audit')
    }
  })

  // Absence of contacts is not safety. A route the team holds no vision on
  // reported "quiet" — identical to a warded, confirmed-empty one.
  it('says no feed for an unseen route and clear only for seen ground', () => {
    const blind = mountRail('coldstore-t2-chaff', [], 'chaff', [])
    expect(blind.get('[data-testid="trace-route-seawall-status"]').text()).toContain('no feed')
    expect(blind.get('[data-testid="trace-route-seawall-status"]').text()).not.toContain('clear')

    const seen = mountRail('coldstore-t2-chaff', [], 'chaff', [
      'seawall-t1-chaff',
      'seawall-t2-chaff',
    ])
    expect(seen.get('[data-testid="trace-route-seawall-status"]').text()).toContain('clear')
  })

  it('reports hostiles on the route the player is standing on', () => {
    const wrapper = mountRail(
      'coldstore-cross',
      [{ id: 'e1', name: 'Enemy1', zone: 'coldstore-cross', team: 'audit', alive: true }],
      'chaff',
      ['coldstore-cross'],
    )
    expect(wrapper.get('[data-testid="trace-route-coldstore-status"]').text()).toContain(
      '1 hostile',
    )
  })

  // The depth bar drew a fixed two-glyph tail, so the ground still ahead of you
  // looked identical at hop 1/8 and hop 7/8.
  it('draws a depth bar whose tail shrinks as the player advances', () => {
    const tailOf = (zone: string) => {
      const text = mountRail(zone).get('[data-testid="trace-current"]').text()
      return text.slice(text.indexOf('├┤') + 2).replace(/[^┄]/g, '').length
    }
    const early = tailOf('coldstore-t3-chaff')
    const late = tailOf('coldstore-t2-audit')
    expect(early).toBeGreaterThan(late)
  })
})
