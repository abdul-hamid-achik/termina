import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import Scoreboard from '../../../app/components/game/Scoreboard.vue'
import { mockPointer, restorePointer } from './helpers/pointer'
import type { TeamState } from '../../../shared/types/game'

interface EntryOverrides {
  [key: string]: unknown
}

function makePlayer(id: string, team: 'radiant' | 'dire', overrides: EntryOverrides = {}) {
  return {
    id,
    name: `Player ${id}`,
    heroId: 'echo',
    team,
    kills: 2,
    deaths: 1,
    assists: 3,
    gold: 1200,
    level: 7,
    items: ['healing_salve', 'iron_branch', null, null, null, null] as (string | null)[],
    alive: true,
    respawnTick: null,
    fogged: false,
    ...overrides,
  }
}

function makeTeam(id: 'radiant' | 'dire'): TeamState {
  return { id, kills: 5, towerKills: 2, gold: 6000, glyphUsedTick: null }
}

function mountScoreboard(players = defaultPlayers()) {
  return mount(Scoreboard, {
    props: {
      players,
      teams: { radiant: makeTeam('radiant'), dire: makeTeam('dire') },
      currentTick: 30,
      currentPlayerId: 'r1',
    },
    global: { stubs: { HeroAvatar: true } },
  })
}

function defaultPlayers() {
  return [
    makePlayer('r1', 'radiant'),
    makePlayer('r2', 'radiant'),
    makePlayer('d1', 'dire'),
    makePlayer('d2', 'dire', { fogged: true, items: [] }),
  ]
}

afterEach(() => {
  restorePointer()
})

describe('Scoreboard', () => {
  it('renders both team blocks with all players', () => {
    mockPointer(false)
    const wrapper = mountScoreboard()

    expect(wrapper.find('[data-testid="scoreboard-team-radiant"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="scoreboard-team-dire"]').exists()).toBe(true)
    expect(wrapper.findAll('.scoreboard__player-row')).toHaveLength(4)
    expect(wrapper.find('.scoreboard__player-row--self').exists()).toBe(true)
  })

  it('item slots no longer rely on title attributes (invisible on touch)', () => {
    mockPointer(false)
    const wrapper = mountScoreboard()

    const slots = wrapper.findAll('.scoreboard__item-slot')
    expect(slots.length).toBeGreaterThan(0)
    for (const slot of slots) {
      expect(slot.attributes('title')).toBeUndefined()
    }
  })

  describe('tap-to-expand items', () => {
    it('clicking a row expands full item names as text', async () => {
      mockPointer(true)
      const wrapper = mountScoreboard()

      await wrapper.find('[data-testid="scoreboard-row-r1"]').trigger('click')

      const expanded = wrapper.find('[data-testid="scoreboard-items-r1"]')
      expect(expanded.exists()).toBe(true)
      expect(expanded.text()).toContain('Healing Salve')
      expect(expanded.text()).toContain('Iron Branch')
    })

    it('clicking the row again collapses it', async () => {
      mockPointer(true)
      const wrapper = mountScoreboard()

      await wrapper.find('[data-testid="scoreboard-row-r1"]').trigger('click')
      await wrapper.find('[data-testid="scoreboard-row-r1"]').trigger('click')

      expect(wrapper.find('[data-testid="scoreboard-items-r1"]').exists()).toBe(false)
    })

    it('expanding another row collapses the first', async () => {
      mockPointer(true)
      const wrapper = mountScoreboard()

      await wrapper.find('[data-testid="scoreboard-row-r1"]').trigger('click')
      await wrapper.find('[data-testid="scoreboard-row-d1"]').trigger('click')

      expect(wrapper.find('[data-testid="scoreboard-items-r1"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="scoreboard-items-d1"]').exists()).toBe(true)
    })

    it('fogged players expand to an unknown placeholder', async () => {
      mockPointer(true)
      const wrapper = mountScoreboard()

      await wrapper.find('[data-testid="scoreboard-row-d2"]').trigger('click')

      expect(wrapper.find('[data-testid="scoreboard-items-d2"]').text()).toContain(
        'Unknown (fogged)',
      )
    })

    it('a player without items expands to "No items"', async () => {
      mockPointer(true)
      const players = [
        makePlayer('r1', 'radiant', { items: [null, null, null, null, null, null] }),
        makePlayer('d1', 'dire'),
      ]
      const wrapper = mountScoreboard(players)

      await wrapper.find('[data-testid="scoreboard-row-r1"]').trigger('click')

      expect(wrapper.find('[data-testid="scoreboard-items-r1"]').text()).toContain('No items')
    })

    it('also works with a mouse (fine pointer)', async () => {
      mockPointer(false)
      const wrapper = mountScoreboard()

      await wrapper.find('[data-testid="scoreboard-row-r1"]').trigger('click')

      expect(wrapper.find('[data-testid="scoreboard-items-r1"]').exists()).toBe(true)
    })
  })

  describe('footer hint', () => {
    it('says "Hold TAB" on fine pointers', () => {
      mockPointer(false)
      const wrapper = mountScoreboard()

      expect(wrapper.find('[data-testid="scoreboard-hint"]').text()).toBe('Hold TAB')
    })

    it('says "tap outside to close" on coarse pointers', () => {
      mockPointer(true)
      const wrapper = mountScoreboard()

      expect(wrapper.find('[data-testid="scoreboard-hint"]').text()).toBe('tap outside to close')
    })
  })
})
