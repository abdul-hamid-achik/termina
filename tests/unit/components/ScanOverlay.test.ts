import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ScanOverlay from '~~/app/components/game/ScanOverlay.vue'
import { buildTrace } from '~~/app/components/game/traceModel'
import type { TerminalState, TeamId } from '~~/shared/types/game'

const TERMINALS: Record<TeamId, TerminalState> = {
  chaff: { team: 'chaff', integ: 6000, maxInteg: 6000, alive: true, vulnerable: false },
  audit: { team: 'audit', integ: 6000, maxInteg: 6000, alive: true, vulnerable: false },
}

function mountOverlay(mode: 'map' | 'scan' = 'scan') {
  return mount(ScanOverlay, {
    props: {
      mode,
      zoneName: 'Rookery Anchor',
      readout: ['MAP · You are @ Rookery Anchor. Reachable: Rookery Terminal'],
      moves: [
        {
          id: 'rookery-terminal',
          name: 'Rookery Terminal',
          playerHere: false,
          allies: [],
          enemyCount: 0,
          fogged: false,
        },
      ],
      attacks: mode === 'scan' ? [{ cmd: 'attack wave:0', label: 'STRIP' }] : [],
      trace: buildTrace({
        playerZone: 'rookery-anchor',
        playerTeam: 'chaff',
        contacts: [],
        terminals: TERMINALS,
      }),
    },
    global: { stubs: { TraceRail: { template: '<div data-testid="trace-rail" />' } } },
  })
}

describe('ScanOverlay', () => {
  it('titles the overlay after the verb that opened it', () => {
    expect(mountOverlay('map').text()).toContain('MAP')
    expect(mountOverlay('scan').text()).toContain('SCAN')
  })

  it('emits move <zone> when a hop is clicked', async () => {
    const wrapper = mountOverlay('map')
    await wrapper.get('[data-testid="scan-move-rookery-terminal"]').trigger('click')
    expect(wrapper.emitted('command')).toEqual([['move rookery-terminal']])
  })

  it('offers attack chips only on scan', () => {
    expect(mountOverlay('scan').find('[data-testid="scan-attack-attack wave:0"]').exists()).toBe(
      true,
    )
    expect(mountOverlay('map').find('[data-testid="scan-attack-attack wave:0"]').exists()).toBe(
      false,
    )
  })

  it('closes from the button', async () => {
    const wrapper = mountOverlay()
    await wrapper.get('[data-testid="scan-overlay-close"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
