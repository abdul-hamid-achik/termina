import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import Scoreboard from '~~/app/components/game/Scoreboard.vue'
import { mockPointer, restorePointer } from './helpers/pointer'
import type { TeamState } from '~~/shared/types/game'

interface EntryOverrides {
  [key: string]: unknown
}

function makePlayer(id: string, team: 'chaff' | 'audit', overrides: EntryOverrides = {}) {
  return {
    id,
    name: `Player ${id}`,
    heroId: 'echo',
    team,
    kills: 2,
    deaths: 1,
    assists: 3,
    scrip: 1200,
    level: 7,
    items: ['trauma_patch', 'scrap_lot', null, null, null, null] as (string | null)[],
    alive: true,
    respawnCycle: null,
    fogged: false,
    ...overrides,
  }
}

function makeTeam(id: 'chaff' | 'audit'): TeamState {
  return { id, kills: 5, iceKills: 2, scrip: 6000, hardenUsedCycle: null }
}

function mountScoreboard(players = defaultPlayers()) {
  return mount(Scoreboard, {
    props: {
      players,
      teams: { chaff: makeTeam('chaff'), audit: makeTeam('audit') },
      currentCycle: 30,
      currentPlayerId: 'r1',
    },
    global: { stubs: { HeroPortrait: true } },
  })
}

function defaultPlayers() {
  return [
    makePlayer('r1', 'chaff'),
    makePlayer('r2', 'chaff'),
    makePlayer('d1', 'audit'),
    makePlayer('d2', 'audit', { fogged: true, items: [] }),
  ]
}

afterEach(() => {
  restorePointer()
})

describe('Scoreboard', () => {
  it('renders both team blocks with all players', () => {
    mockPointer(false)
    const wrapper = mountScoreboard()

    expect(wrapper.find('[data-testid="scoreboard-team-chaff"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="scoreboard-team-audit"]').exists()).toBe(true)
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
      expect(expanded.text()).toContain('Trauma Patch')
      expect(expanded.text()).toContain('Scrap Lot')
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
        makePlayer('r1', 'chaff', { items: [null, null, null, null, null, null] }),
        makePlayer('d1', 'audit'),
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

  describe('AFK bot-takeover badge', () => {
    it('shows an [AI] tag for a bot-controlled (AFK) player', () => {
      const wrapper = mountScoreboard([
        makePlayer('r1', 'chaff', { aiControlled: true }),
        makePlayer('d1', 'audit'),
      ])
      const row = wrapper.get('[data-testid="scoreboard-row-r1"]')
      expect(row.find('.scoreboard__ai-tag').exists()).toBe(true)
      expect(row.text()).toContain('[AI]')
    })

    it('does not show the tag for a normal player', () => {
      const wrapper = mountScoreboard([makePlayer('r1', 'chaff'), makePlayer('d1', 'audit')])
      expect(
        wrapper.get('[data-testid="scoreboard-row-r1"]').find('.scoreboard__ai-tag').exists(),
      ).toBe(false)
    })
  })

  describe('dead players + scrip formatting', () => {
    it('shows a respawn countdown and the dead row style for a dead player', () => {
      const wrapper = mountScoreboard([
        makePlayer('r1', 'chaff', { alive: false, respawnCycle: 45 }), // tick 30 → 15t
        makePlayer('d1', 'audit'),
      ])
      const row = wrapper.get('[data-testid="scoreboard-row-r1"]')
      expect(row.classes()).toContain('scoreboard__player-row--dead')
      expect(row.text()).toContain('15t')
    })

    it('shows DEAD with no countdown when the respawn tick is unknown', () => {
      const wrapper = mountScoreboard([
        makePlayer('r1', 'chaff', { alive: false, respawnCycle: null }),
        makePlayer('d1', 'audit'),
      ])
      expect(wrapper.get('[data-testid="scoreboard-row-r1"]').text()).toContain('DEAD')
    })

    it('abbreviates scrip of 10k+ as k', () => {
      const wrapper = mountScoreboard([
        makePlayer('r1', 'chaff', { scrip: 15_000 }),
        makePlayer('d1', 'audit'),
      ])
      expect(wrapper.get('[data-testid="scoreboard-row-r1"]').text()).toContain('15.0k')
    })
  })
})
