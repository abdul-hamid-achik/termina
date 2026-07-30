import { describe, it, expect } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import AsciiMap from '~~/app/components/game/AsciiMap.vue'
import type { ZoneDisplay } from '~~/app/components/game/asciiMapModel'
import type { AncientState } from '~~/shared/types/game'

function makeZone(overrides: Partial<ZoneDisplay> = {}): ZoneDisplay {
  return {
    id: 'mid-t1-rad',
    name: 'Chaff Mid T1',
    playerHere: false,
    allies: [],
    enemyCount: 0,
    fogged: false,
    ...overrides,
  }
}

function makeAncient(overrides: Partial<AncientState> = {}): AncientState {
  return {
    team: 'chaff',
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
        makeZone({ id: 'mid-t1-rad', name: 'Chaff Mid T1', allies: ['echo'], enemyCount: 1 }),
      ]
      const wrapper = mount(AsciiMap, {
        props: { zones, playerZone: 'mid-t1-rad' },
      })

      const cell = wrapper.find('[role="gridcell"]')
      expect(cell.attributes('aria-label')).toContain('Chaff Mid T1')
    })

    it('should describe zone content in aria-label', () => {
      const zones = [
        makeZone({
          id: 'mid-t1-rad',
          name: 'Chaff Mid T1',
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

    it('navigates the visual grid with arrow keys, skipping null gaps', async () => {
      const zones = [makeZone({ id: 'chaff-fountain' }), makeZone({ id: 'mid-t1-rad' })]
      const wrapper = mount(AsciiMap, {
        props: { zones, playerZone: 'chaff-fountain' },
      })

      expect(wrapper.vm.focusedZoneId).toBe(null)

      const grid = wrapper.find('[role="grid"]')
      // First arrow enters at the first real zone (the top row leads with a gap).
      await grid.trigger('keydown', { key: 'ArrowRight' })
      expect(wrapper.vm.focusedZoneId).toBe('chaff-fountain')

      // Top row is [_, chaff-fountain, _, chaff-base, _] — Right skips the
      // null gap to the next real cell (grid order, not data order).
      await grid.trigger('keydown', { key: 'ArrowRight' })
      expect(wrapper.vm.focusedZoneId).toBe('chaff-base')

      // Down moves a row and lands on the nearest real zone to that column,
      // proving the step is grid-derived (not a hardcoded ±5).
      await grid.trigger('keydown', { key: 'ArrowDown' })
      expect(wrapper.vm.focusedZoneId).toBe('mid-t3-rad')
    })

    it('moves real DOM focus to the navigated cell (so its aria-label is announced)', async () => {
      const wrapper = mount(AsciiMap, {
        attachTo: document.body,
        props: { zones: [makeZone({ id: 'chaff-fountain' })], playerZone: 'chaff-fountain' },
      })

      const grid = wrapper.find('[role="grid"]')
      await grid.trigger('keydown', { key: 'ArrowRight' })
      await nextTick() // the .focus() runs in a nextTick after focusedZoneId updates

      const active = document.activeElement as HTMLElement | null
      expect(active?.getAttribute('data-zone-cell')).toBe('chaff-fountain')
      wrapper.unmount()
    })

    it('keeps grid navigation from also walking the hero', async () => {
      // GameScreen listens for bare arrows on `window` and turns each into a
      // move order. Without stopPropagation, tabbing to the map and browsing it
      // with the arrows would queue a move on every press.
      const escaped: string[] = []
      const spy = (e: Event) => escaped.push((e as KeyboardEvent).key)
      window.addEventListener('keydown', spy)

      const wrapper = mount(AsciiMap, {
        attachTo: document.body,
        props: { zones: [makeZone({ id: 'chaff-fountain' })], playerZone: 'chaff-fountain' },
      })
      const grid = wrapper.find('[role="grid"]')
      for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp']) {
        await grid.trigger('keydown', { key })
      }

      expect(escaped).toEqual([])

      // Unhandled keys still reach the page — the map only claims the arrows.
      await grid.trigger('keydown', { key: 's' })
      expect(escaped).toEqual(['s'])

      window.removeEventListener('keydown', spy)
      wrapper.unmount()
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
      expect(cell.classes()).toContain('text-audit')
    })
  })

  describe('compact mode (mobile)', () => {
    function compactZones(): ZoneDisplay[] {
      return [
        makeZone({ id: 'mid-t1-rad', name: 'Mid Lane T1 (Chaff)', playerHere: true }),
        makeZone({ id: 'mid-t2-rad', name: 'Mid Lane T2 (Chaff)', allies: ['echo'] }),
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
      expect(current.text()).toContain('Mid Lane T1 (Chaff)')
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
      expect(cards[0]!.text()).toContain('Mid Lane T2 (Chaff)')
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
          makeZone({ id: 'mid-t1-rad', name: 'Mid Lane T1 (Chaff)' }),
          makeZone({ id: 'mid-river', name: 'Mid River Crossing', playerHere: true }),
        ],
      })

      expect(wrapper.find('[data-testid="compact-current-zone"]').text()).toContain(
        'Mid River Crossing',
      )
      const cards = wrapper.findAll('[data-testid="compact-adjacent-zone"]')
      // Only mid-t1-rad of mid-river's neighbors is in the display list
      expect(cards.length).toBe(1)
      expect(cards[0]!.text()).toContain('Mid Lane T1 (Chaff)')
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

    it('renders column headers, side labels, and the code legend in the mini overview', async () => {
      const wrapper = mountCompact()
      await wrapper.find('[data-testid="overview-toggle"]').trigger('click')

      const text = wrapper.find('[data-testid="mini-overview"]').text()
      // Short column headers derived from the 5v5 layout (silts collapse to SILT).
      expect(text).toContain('SEA')
      expect(text).toContain('COLD')
      expect(text).toContain('SHA')
      expect(text).toContain('SILT')
      // Side labels marking the two halves of the map.
      expect(text).toContain('CHAFF ▲')
      expect(text).toContain('AUDIT ▼')
      // The legend line explains the zone codes.
      expect(text).toContain('T1-3 tower zones')
      expect(text).toContain('JG jungle')
      expect(text).toContain('RN rune')
      expect(text).toContain('ROS Roshan')
      expect(text).toContain('RF/RB fountain/base')
      expect(text).toContain('▲ tower up · ✗ razed')
    })

    it('shows tower state glyphs in the mini overview lane cells', async () => {
      const zones = [
        makeZone({
          id: 'mid-t1-rad',
          playerHere: true,
          tower: { team: 'chaff', alive: false, tier: 1 },
        }),
        makeZone({ id: 'mid-t1-audit', tower: { team: 'audit', alive: true, tier: 1 } }),
      ]
      const wrapper = mount(AsciiMap, {
        props: { zones, playerZone: 'mid-t1-rad', forceMode: 'compact' as const },
      })
      await wrapper.find('[data-testid="overview-toggle"]').trigger('click')

      const overview = wrapper.find('[data-testid="mini-overview"]')
      // Razed chaff tower on the player's cell (✗ after the code), live audit tower (▲).
      expect(overview.text()).toContain('►M1✗')
      expect(overview.text()).toContain('M1▲')
      // The standing tower's glyph is team-colored.
      const auditGlyph = overview
        .findAll('span')
        .find((s) => s.text() === '▲' && s.classes().includes('text-audit'))
      expect(auditGlyph).toBeTruthy()
    })

    it('starts with the overview expanded when overviewOpen is set (stories)', () => {
      const wrapper = mount(AsciiMap, {
        props: {
          zones: compactZones(),
          playerZone: 'mid-t1-rad',
          forceMode: 'compact' as const,
          overviewOpen: true,
        },
      })
      expect(wrapper.find('[data-testid="mini-overview"]').exists()).toBe(true)
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
      chaff: makeAncient({ team: 'chaff', hp: 3000, maxHp: 6000 }),
      audit: makeAncient({ team: 'audit', hp: 0, alive: false }),
    }
    const baseZones = () => [
      makeZone({ id: 'chaff-base', name: 'Chaff Base', playerHere: true }),
      makeZone({ id: 'audit-base', name: 'Audit Base', fogged: true }),
    ]

    it('shows ancient HP% and skull on base cells in the full grid', () => {
      const wrapper = mount(AsciiMap, {
        props: {
          zones: baseZones(),
          playerZone: 'chaff-base',
          ancients,
          forceMode: 'full' as const,
        },
      })

      const cells = wrapper.findAll('[role="gridcell"]')
      expect(cells.length).toBe(2)
      expect(cells[0]!.text()).toContain('◈LOCKED 50%')
      expect(cells[0]!.attributes('aria-label')).toContain('ancient locked at 50%')
      expect(cells[1]!.text()).toContain('◈✗')
      expect(cells[1]!.attributes('aria-label')).toContain('ancient destroyed')
    })

    it('shows the core on the current zone card in compact mode', () => {
      const wrapper = mount(AsciiMap, {
        props: {
          zones: baseZones(),
          playerZone: 'chaff-base',
          ancients,
          forceMode: 'compact' as const,
        },
      })

      expect(wrapper.find('[data-testid="compact-current-zone"]').text()).toContain(
        '◈ CORE LOCKED 50%',
      )
    })
  })

  describe('full-grid interaction', () => {
    function mountFull(props: Record<string, unknown> = {}) {
      return mount(AsciiMap, {
        props: {
          zones: [
            makeZone({ id: 'mid-t1-rad', name: 'Chaff Mid T1' }),
            makeZone({ id: 'mid-river', name: 'Mid River' }),
            makeZone({ id: 'audit-base', name: 'Audit Base' }),
          ],
          playerZone: 'mid-t1-rad',
          forceMode: 'full' as const,
          ...props,
        },
      })
    }

    it('marks an adjacent zone clickable and emits zoneClick on click', async () => {
      const wrapper = mountFull()
      const cell = wrapper.find('[title^="mid-river"]')
      expect(cell.exists()).toBe(true)
      expect(cell.attributes('title')).toContain('click to move')
      await cell.trigger('click')
      expect(wrapper.emitted('zoneClick')).toEqual([['mid-river']])
    })

    it('emits for a distant zone too — auto-path makes every zone a travel order', async () => {
      const wrapper = mountFull()
      const cell = wrapper.find('[title^="audit-base"]')
      expect(cell.exists()).toBe(true)
      expect(cell.attributes('title')).toContain('click to travel')
      await cell.trigger('click')
      expect(wrapper.emitted('zoneClick')).toEqual([['audit-base']])
    })

    it('makes nothing clickable when the player has no zone', async () => {
      const wrapper = mountFull({ playerZone: '' })
      const cell = wrapper.find('[title^="mid-river"]')
      await cell.trigger('click')
      expect(wrapper.emitted('zoneClick')).toBeUndefined()
    })

    it('orients the grid: Chaff is the top of the board, Audit the bottom', () => {
      // The banner reads left-to-right ("CHAFF [MAP] AUDIT"), which says nothing
      // about which END of the grid each team holds.
      const text = mountFull().text()
      expect(text).toContain('CHAFF ▲')
      expect(text).toContain('AUDIT ▼')
    })

    it('decodes the fog glyph and the tower pips in the legend', () => {
      const text = mountFull().text()
      expect(text).toContain('? = No vision')
      expect(text).toContain('▲▲▲/✗ = Tower HP')
      expect(text).not.toContain('✓/✗ = Tower')
    })
  })

  describe('auto-path route (W2-8)', () => {
    // The full mid corridor, so the BFS has a real multi-hop route to draw.
    const CORRIDOR = ['chaff-base', 'mid-t3-rad', 'mid-t2-rad', 'mid-t1-rad', 'mid-river']

    function mountRoute(props: Record<string, unknown> = {}) {
      return mount(AsciiMap, {
        props: {
          zones: CORRIDOR.map((id) => makeZone({ id, name: id })),
          playerZone: 'chaff-base',
          forceMode: 'full' as const,
          ...props,
        },
      })
    }

    const markers = (w: ReturnType<typeof mountRoute>) =>
      Object.fromEntries(
        w.findAll('[data-route-marker]').map((s) => [s.attributes('data-route-marker'), s.text()]),
      )

    it('draws nothing when the hero is not walking', () => {
      expect(markers(mountRoute())).toEqual({})
      expect(markers(mountRoute({ moveTarget: null }))).toEqual({})
    })

    it('numbers each hop and targets the destination cell', () => {
      // A queued walk was previously invisible on the board — the hero just
      // drifted one zone per tick with nothing showing where it was headed.
      expect(markers(mountRoute({ moveTarget: 'mid-t1-rad' }))).toEqual({
        'mid-t3-rad': '1',
        'mid-t2-rad': '2',
        'mid-t1-rad': '⌖',
      })
    })

    it('routes only through the zones this game actually has', () => {
      // From mid-t1-rad the GLOBAL graph reaches rune-top in two hops, the first
      // of which (mid-river) IS on this board — so an unrestricted BFS would
      // draw a route toward a zone the game does not contain.
      const w = mountRoute({ playerZone: 'mid-t1-rad', moveTarget: 'rune-top' })
      expect(markers(w)).toEqual({})
    })

    it('announces the route to screen readers on the destination cell', () => {
      const w = mountRoute({ moveTarget: 'mid-t1-rad' })
      const label = (id: string) =>
        w.find(`[data-zone-cell="${id}"]`).attributes('aria-label') ?? ''
      expect(label('mid-t1-rad')).toContain('walk destination')
      expect(label('mid-t2-rad')).toContain('walk step 2')
      expect(label('chaff-base')).not.toContain('walk')
    })

    it('marks the route on the compact cards too (the desktop rail map is compact)', () => {
      const w = mountRoute({ forceMode: 'compact' as const, moveTarget: 'mid-t1-rad' })
      expect(markers(w)).toEqual({ 'mid-t3-rad': '1' })
      const card = w
        .findAll('[data-testid="compact-adjacent-zone"]')
        .find((c) => c.text().includes('mid-t3-rad'))
      expect(card?.attributes('aria-label')).toContain('walk step 1')
    })
  })
})

describe('compact overview cells expose a sizing hook', () => {
  // REGRESSION: the in-game rail clamps the board's cell height so it fits its
  // track instead of being scrolled. The first attempt targeted `.map-cell`,
  // which ONLY the full grid carries — the rail renders compact mode, so the
  // rule matched nothing, the board could not shrink, and Hero Status collapsed
  // to 0px beneath it. A source-grep test stayed green through all of that, so
  // this one asserts against the rendered DOM.
  it('renders .map-cell-compact cells the rail rule can target', () => {
    const wrapper = mount(AsciiMap, {
      props: {
        zones: [makeZone({ id: 'mid-river' }), makeZone({ id: 'mid-t1-rad' })],
        playerZone: 'mid-river',
        forceMode: 'compact',
        overviewOpen: true,
      },
    })
    expect(wrapper.findAll('.map-cell-compact').length).toBeGreaterThan(0)
  })
})
