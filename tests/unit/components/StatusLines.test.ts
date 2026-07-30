import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import StatusLines from '~~/app/components/game/StatusLines.vue'
import { buildTrace } from '~~/app/components/game/traceModel'
import type { AncientState, TeamId } from '~~/shared/types/game'

const ANCIENTS: Record<TeamId, AncientState> = {
  chaff: { team: 'chaff', integ: 6000, maxInteg: 6000, alive: true, vulnerable: false },
  audit: { team: 'audit', integ: 6000, maxInteg: 6000, alive: true, vulnerable: false },
}

function mountLines(over: Partial<Parameters<typeof mount>[0]> = {}) {
  const trace = buildTrace({
    playerZone: 'mid-t2-chaff',
    playerTeam: 'chaff',
    contacts: [],
    ancients: ANCIENTS,
  })
  return mount(StatusLines, {
    props: {
      trace,
      hpFraction: 0.8,
      alive: true,
      netLead: 'CHF +1.2k',
      nextTickIn: 3,
      tick: 240,
      canAct: true,
      enemyCount: 0,
      allyHeadcount: 1,
      enemyIcePresent: false,
      hasReadyAbility: true,
      ...(over.props as object | undefined),
    },
  })
}

describe('StatusLines', () => {
  it('renders the hop status line (route, threat, recommendation)', () => {
    const wrapper = mountLines()
    const hop = wrapper.get('[data-testid="status-hop"]').text()
    expect(hop).toContain('hop 2/8')
    expect(hop).toContain('CLEAR')
  })

  it('renders the net lead', () => {
    expect(mountLines().get('[data-testid="status-net"]').text()).toContain('CHF +1.2k')
  })

  it('renders the tick clock with AWAITING ORDERS when the player can act', () => {
    expect(mountLines().get('[data-testid="status-clock"]').text()).toContain('AWAITING ORDERS')
  })

  it('renders the resolving countdown when the player already acted', () => {
    const wrapper = mountLines({ props: { canAct: false, nextTickIn: 2 } })
    expect(wrapper.get('[data-testid="status-clock"]').text()).toContain('resolving in 2s')
  })

  it('reads off route when the player is off all three routes', () => {
    const trace = buildTrace({
      playerZone: 'hollow',
      playerTeam: 'chaff',
      contacts: [],
      ancients: ANCIENTS,
    })
    const wrapper = mount(StatusLines, {
      props: {
        trace,
        hpFraction: 1,
        alive: true,
        netLead: 'even',
        nextTickIn: 3,
        tick: 240,
        canAct: true,
        enemyCount: 0,
        allyHeadcount: 1,
        enemyIcePresent: false,
        hasReadyAbility: true,
      },
    })
    expect(wrapper.get('[data-testid="status-hop"]').text()).toContain('off route')
  })
})
