import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AsciiMap from '../../../app/components/game/AsciiMap.vue'
import type { ZoneDisplay } from '../../../app/components/game/asciiMapModel'
import type { AncientState } from '../../../shared/types/game'

function makeZone(overrides: Partial<ZoneDisplay> = {}): ZoneDisplay {
  return {
    id: 'mid-t1-rad',
    name: 'Radiant Mid T1',
    playerHere: false,
    allies: [],
    enemyCount: 0,
    fogged: false,
    ...overrides,
  }
}

function makeAncient(overrides: Partial<AncientState> = {}): AncientState {
  return {
    team: 'radiant',
    hp: 6000,
    maxHp: 6000,
    alive: true,
    vulnerable: false,
    ...overrides,
  }
}

describe('AsciiMap', () => {
  describe('accessibility', () => {
    it('should have role="grid" on map container', () => {
      const zones = [makeZone()]
      const wrapper = mount(AsciiMap, {
        props: { zones, playerZone: 'mid-t1-rad' },
      })

      const grid = wrapper.find('[role="grid"]')
      expect(grid.exists()).toBe(true)
    })

    it('should have role="gridcell" on each zone cell', () => {
      const zones = [makeZone({ id: 'mid-t1-rad' }), makeZone({ id: 'top-t1-rad' })]
      const wrapper = mount(AsciiMap, {
        props: { zones, playerZone: 'mid-t1-rad' },
      })

      const cells = wrapper.findAll('[role="gridcell"]')
      expect(cells.length).toBeGreaterThanOrEqual(2)
    })

    it('should have aria-label on each zone cell', () => {
      const zones = [
        makeZone({ id: 'mid-t1-rad', name: 'Radiant Mid T1', allies: ['echo'], enemyCount: 1 }),
      ]
      const wrapper = mount(AsciiMap, {
        props: { zones, playerZone: 'mid-t1-rad' },
      })

      const cell = wrapper.find('[role="gridcell"]')
      expect(cell.attributes('aria-label')).toContain('Radiant Mid T1')
    })

    it('should describe zone content in aria-label', () => {
      const zones = [
        makeZone({
          id: 'mid-t1-rad',
          name: 'Radiant Mid T1',
          allies: ['echo', 'sentry'],
          enemyCount: 2,
          playerHere: true,
        }),
      ]
      const wrapper = mount(AsciiMap, {
        props: { zones, playerZone: 'mid-t1-rad' },
      })

      const cell = wrapper.find('[role="gridcell"]')
      const label = cell.attributes('aria-label')
      expect(label).toContain('2 allies')
      expect(label).toContain('2 enemies')
      expect(label).toContain('you')
    })

    it('should be keyboard navigable with arrow keys', async () => {
      const zones = [makeZone({ id: 'radiant-fountain' }), makeZone({ id: 'mid-t1-rad' })]
      const wrapper = mount(AsciiMap, {
        props: { zones, playerZone: 'radiant-fountain' },
      })

      expect(wrapper.vm.focusedZoneId).toBe(null)

      const grid = wrapper.find('[role="grid"]')
      await grid.trigger('keydown', { key: 'ArrowRight' })

      expect(wrapper.vm.focusedZoneId).toBe('radiant-fountain')

      await grid.trigger('keydown', { key: 'ArrowRight' })
      expect(wrapper.vm.focusedZoneId).toBe('mid-t1-rad')
    })

    it('should announce zone updates to screen readers', async () => {
      const zones = [makeZone({ id: 'mid-t1-rad', enemyCount: 0 })]
      const wrapper = mount(AsciiMap, {
        props: { zones, playerZone: 'mid-t1-rad' },
      })

      await wrapper.setProps({
        zones: [makeZone({ id: 'mid-t1-rad', enemyCount: 2 })],
      })

      const liveRegion = wrapper.find('[aria-live="polite"]')
      expect(liveRegion.exists()).toBe(true)
    })
  })

  describe('zone display', () => {
    it('should show fogged zones with reduced opacity', () => {
      const zones = [makeZone({ fogged: true })]
      const wrapper = mount(AsciiMap, {
        props: { zones, playerZone: 'mid-t1-rad' },
      })

      const cell = wrapper.find('[role="gridcell"]')
      expect(cell.classes()).toContain('opacity-40')
    })

    it('should highlight player zone', () => {
      const zones = [makeZone({ id: 'mid-t1-rad', playerHere: true })]
      const wrapper = mount(AsciiMap, {
        props: { zones, playerZone: 'mid-t1-rad' },
      })

      const cell = wrapper.find('[role="gridcell"]')
      expect(cell.classes()).toContain('bg-self/20')
    })

    it('should highlight zones with enemies', () => {
      const zones = [makeZone({ enemyCount: 2 })]
      const wrapper = mount(AsciiMap, {
        props: { zones, playerZone: 'mid-t1-rad' },
      })

      const cell = wrapper.find('[role="gridcell"]')
      expect(cell.classes()).toContain('text-dire')
    })
  })

  describe('compact mode (mobile)', () => {
    function compactZones(): ZoneDisplay[] {
      return [
        makeZone({ id: 'mid-t1-rad', name: 'Mid Lane T1 (Radiant)', playerHere: true }),
        makeZone({ id: 'mid-t2-rad', name: 'Mid Lane T2 (Radiant)', allies: ['echo'] }),
        makeZone({ id: 'mid-river', name: 'Mid River Crossing', enemyCount: 1 }),
      ]
    }

    function mountCompact() {
      return mount(AsciiMap, {
        props: {
          zones: compactZones(),
          playerZone: 'mid-t1-rad',
          forceMode: 'compact' as const,
        },
      })
    }

    it('renders the current zone as a card instead of the full grid', () => {
      const wrapper = mountCompact()

      expect(wrapper.find('[role="grid"]').exists()).toBe(false)
      const current = wrapper.find('[data-testid="compact-current-zone"]')
      expect(current.exists()).toBe(true)
      expect(current.text()).toContain('Mid Lane T1 (Radiant)')
      expect(current.text()).toContain('►YOU')
    })

    it('renders a tappable card per adjacent zone with a visible move affordance', () => {
      const wrapper = mountCompact()

      const cards = wrapper.findAll('[data-testid="compact-adjacent-zone"]')
      // mid-t1-rad is adjacent to mid-t2-rad and mid-river
      expect(cards.length).toBe(2)
      for (const card of cards) {
        expect(card.text()).toContain('TAP TO MOVE')
        expect(card.attributes('aria-label')).toMatch(/^Move to /)
      }
      expect(cards[0]!.text()).toContain('Mid Lane T2 (Radiant)')
      expect(cards[1]!.text()).toContain('Mid River Crossing')
    })

    it('emits zoneClick with the zone id when a card is tapped', async () => {
      const wrapper = mountCompact()

      await wrapper.find('[data-testid="compact-adjacent-zone"]').trigger('click')

      expect(wrapper.emitted('zoneClick')).toEqual([['mid-t2-rad']])
    })

    it('recenters on the player zone as they move', async () => {
      const wrapper = mountCompact()

      await wrapper.setProps({
        playerZone: 'mid-river',
        zones: [
          makeZone({ id: 'mid-t1-rad', name: 'Mid Lane T1 (Radiant)' }),
          makeZone({ id: 'mid-river', name: 'Mid River Crossing', playerHere: true }),
        ],
      })

      expect(wrapper.find('[data-testid="compact-current-zone"]').text()).toContain(
        'Mid River Crossing',
      )
      const cards = wrapper.findAll('[data-testid="compact-adjacent-zone"]')
      // Only mid-t1-rad of mid-river's neighbors is in the display list
      expect(cards.length).toBe(1)
      expect(cards[0]!.text()).toContain('Mid Lane T1 (Radiant)')
    })

    it('toggles the mini overview grid with abbreviated zone codes', async () => {
      const wrapper = mountCompact()

      expect(wrapper.find('[data-testid="mini-overview"]').exists()).toBe(false)

      await wrapper.find('[data-testid="overview-toggle"]').trigger('click')

      const overview = wrapper.find('[data-testid="mini-overview"]')
      expect(overview.exists()).toBe(true)
      expect(overview.text()).toContain('ROS') // roshan pit code
      expect(overview.text()).toContain('►M1') // player marker on current zone
      expect(overview.text()).toContain('MR!') // enemy marker on mid river

      await wrapper.find('[data-testid="overview-toggle"]').trigger('click')
      expect(wrapper.find('[data-testid="mini-overview"]').exists()).toBe(false)
    })

    it('keeps the full grid when forced to full mode', () => {
      const wrapper = mount(AsciiMap, {
        props: {
          zones: compactZones(),
          playerZone: 'mid-t1-rad',
          forceMode: 'full' as const,
        },
      })

      expect(wrapper.find('[role="grid"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="compact-current-zone"]').exists()).toBe(false)
    })
  })

  describe('ancient (core) display', () => {
    const ancients = {
      radiant: makeAncient({ team: 'radiant', hp: 3000, maxHp: 6000 }),
      dire: makeAncient({ team: 'dire', hp: 0, alive: false }),
    }
    const baseZones = () => [
      makeZone({ id: 'radiant-base', name: 'Radiant Base', playerHere: true }),
      makeZone({ id: 'dire-base', name: 'Dire Base', fogged: true }),
    ]

    it('shows ancient HP% and skull on base cells in the full grid', () => {
      const wrapper = mount(AsciiMap, {
        props: {
          zones: baseZones(),
          playerZone: 'radiant-base',
          ancients,
          forceMode: 'full' as const,
        },
      })

      const cells = wrapper.findAll('[role="gridcell"]')
      expect(cells.length).toBe(2)
      expect(cells[0]!.text()).toContain('◈50%')
      expect(cells[0]!.attributes('aria-label')).toContain('ancient at 50%')
      expect(cells[1]!.text()).toContain('◈☠')
      expect(cells[1]!.attributes('aria-label')).toContain('ancient destroyed')
    })

    it('shows the core on the current zone card in compact mode', () => {
      const wrapper = mount(AsciiMap, {
        props: {
          zones: baseZones(),
          playerZone: 'radiant-base',
          ancients,
          forceMode: 'compact' as const,
        },
      })

      expect(wrapper.find('[data-testid="compact-current-zone"]').text()).toContain('◈ CORE 50%')
    })
  })
})
