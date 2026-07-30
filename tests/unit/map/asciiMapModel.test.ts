import { describe, it, expect } from 'vitest'
import {
  MAP_ROWS,
  ONE_LANE_MAP_ROWS,
  TWO_LANE_MAP_ROWS,
  mapRowsFor,
  colHeadersFor,
  shortColHeadersFor,
  gridColsClass,
  riverDividerRows,
  compactRiverDividerRow,
  ancientForZone,
  ancientLabel,
  ancientStatusLabel,
  buildAdjacentZones,
  buildRouteMarkers,
  towerPips,
  cellText,
  compactIndicators,
  miniOverviewCell,
  zoneAriaLabel,
  zoneRecordLabel,
  zoneShortCode,
  zoneTeam,
} from '~~/app/components/game/asciiMapModel'
import type { ZoneDisplay } from '~~/app/components/game/asciiMapModel'
import type { AncientState } from '~~/shared/types/game'
import { ZONE_IDS } from '~~/shared/constants/zones'

function makeZone(overrides: Partial<ZoneDisplay> = {}): ZoneDisplay {
  return {
    id: 'mid-t1-rad',
    name: 'Mid Lane T1 (Radiant)',
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

describe('asciiMapModel', () => {
  describe('MAP_ROWS', () => {
    it('covers every zone exactly once', () => {
      const placed = MAP_ROWS.flat().filter((id): id is string => id !== null)
      expect([...placed].sort()).toEqual([...ZONE_IDS].sort())
    })
  })

  describe('zoneShortCode', () => {
    it('codes bases and fountains', () => {
      expect(zoneShortCode('radiant-base')).toBe('RB')
      expect(zoneShortCode('radiant-fountain')).toBe('RF')
      expect(zoneShortCode('dire-base')).toBe('DB')
      expect(zoneShortCode('dire-fountain')).toBe('DF')
    })

    it('codes lanes as lane letter + tier', () => {
      expect(zoneShortCode('top-t1-rad')).toBe('T1')
      expect(zoneShortCode('mid-t2-dire')).toBe('M2')
      expect(zoneShortCode('bot-t3-rad')).toBe('B3')
    })

    it('codes rivers, runes, jungle, and roshan', () => {
      expect(zoneShortCode('top-river')).toBe('TR')
      expect(zoneShortCode('mid-river')).toBe('MR')
      expect(zoneShortCode('bot-river')).toBe('BR')
      expect(zoneShortCode('rune-top')).toBe('RN')
      expect(zoneShortCode('rune-bot')).toBe('RN')
      expect(zoneShortCode('jungle-dire-bot')).toBe('JG')
      expect(zoneShortCode('roshan-pit')).toBe('ROS')
    })

    it('produces 2-3 char codes for every mapped zone', () => {
      for (const id of ZONE_IDS) {
        const code = zoneShortCode(id)
        expect(code.length, `code for ${id}`).toBeGreaterThanOrEqual(2)
        expect(code.length, `code for ${id}`).toBeLessThanOrEqual(3)
      }
    })

    it('falls back to a 3-char uppercase slice for an unrecognized zone id', () => {
      expect(zoneShortCode('foobar')).toBe('FOO')
    })
  })

  describe('zoneTeam', () => {
    it('reads the territory owner from the zone graph', () => {
      expect(zoneTeam('jungle-rad-top')).toBe('radiant')
      expect(zoneTeam('bot-t1-dire')).toBe('dire')
      expect(zoneTeam('mid-river')).toBe('neutral')
    })

    it('defaults unknown zones to neutral', () => {
      expect(zoneTeam('not-a-zone')).toBe('neutral')
    })
  })

  describe('ancientForZone', () => {
    const ancients = {
      radiant: makeAncient({ team: 'radiant' }),
      dire: makeAncient({ team: 'dire' }),
    }

    it('maps base zones to their ancient', () => {
      expect(ancientForZone('radiant-base', ancients)).toBe(ancients.radiant)
      expect(ancientForZone('dire-base', ancients)).toBe(ancients.dire)
    })

    it('returns null for non-base zones and missing ancients', () => {
      expect(ancientForZone('mid-river', ancients)).toBeNull()
      expect(ancientForZone('radiant-base', null)).toBeNull()
      expect(ancientForZone('radiant-base', undefined)).toBeNull()
    })
  })

  describe('ancientLabel', () => {
    it('shows HP percentage while alive', () => {
      expect(ancientLabel(makeAncient({ hp: 4980, maxHp: 6000 }))).toBe('83%')
      expect(ancientLabel(makeAncient())).toBe('100%')
    })

    it('shows a razed marker (not ☠ — that is Roshan) when destroyed', () => {
      // bare ✗; callers prepend ◈ → ◈✗
      expect(ancientLabel(makeAncient({ hp: 0, alive: false }))).toBe('✗')
    })

    it('returns null when there is no ancient', () => {
      expect(ancientLabel(null)).toBeNull()
      expect(ancientLabel(undefined)).toBeNull()
    })

    it('shows 0% rather than dividing by a zero maxHp', () => {
      expect(ancientLabel(makeAncient({ hp: 0, maxHp: 0 }))).toBe('0%')
    })
  })

  describe('buildAdjacentZones', () => {
    it('returns adjacent zone displays in topology order', () => {
      const zones = [
        makeZone({ id: 'mid-river' }),
        makeZone({ id: 'mid-t2-rad' }),
        makeZone({ id: 'top-t1-rad' }), // not adjacent to mid-t1-rad
      ]
      const result = buildAdjacentZones('mid-t1-rad', zones)
      expect(result.map((z) => z.id)).toEqual(['mid-t2-rad', 'mid-river'])
    })

    it('skips adjacent zones missing from the display list', () => {
      const zones = [makeZone({ id: 'mid-river' })]
      const result = buildAdjacentZones('mid-t1-rad', zones)
      expect(result.map((z) => z.id)).toEqual(['mid-river'])
    })

    it('returns empty for an unknown player zone', () => {
      expect(buildAdjacentZones('not-a-zone', [makeZone()])).toEqual([])
      expect(buildAdjacentZones('', [makeZone()])).toEqual([])
    })
  })

  describe('cellText', () => {
    it('appends the ancient HP indicator on base zones', () => {
      const zone = makeZone({ id: 'radiant-base', name: 'Radiant Base' })
      expect(cellText(zone, makeAncient({ hp: 3000, maxHp: 6000 }))).toContain('◈LOCKED 50%')
    })

    it('names the core as EXPOSED once it can actually be attacked', () => {
      const zone = makeZone({ id: 'radiant-base', name: 'Radiant Base' })
      const text = cellText(zone, makeAncient({ hp: 6000, maxHp: 6000, vulnerable: true }))
      expect(text).toContain('◈EXPOSED 100%')
      expect(text).not.toContain('LOCKED')
    })

    it('shows a razed marker for a destroyed Mainframe', () => {
      const zone = makeZone({ id: 'dire-base', name: 'Dire Base' })
      expect(cellText(zone, makeAncient({ team: 'dire', hp: 0, alive: false }))).toContain('◈✗')
    })

    it('shows the ancient through fog (global info, like towers)', () => {
      const zone = makeZone({ id: 'dire-base', name: 'Dire Base', fogged: true })
      const text = cellText(zone, makeAncient({ team: 'dire', hp: 3000, maxHp: 6000 }))
      expect(text).toContain('◈LOCKED 50%')
      expect(text).toContain('?')
    })

    it('shows the tower through fog too — towers reach every client unfiltered', () => {
      // REGRESSION: the desktop grid returned from the fog branch BEFORE pushing
      // the tower indicator, so the one renderer a desktop player looks at was
      // also the only one that hid the objective it was global information about.
      const zone = makeZone({
        id: 'mid-t2-dire',
        fogged: true,
        tower: { team: 'dire', alive: true, tier: 2, hp: 600, maxHp: 900 },
      })
      const text = cellText(zone)
      expect(text).toContain('▲▲·')
      expect(text.endsWith('?')).toBe(true)
    })

    it('is unchanged for zones without an ancient', () => {
      const zone = makeZone({ playerHere: true, enemyCount: 2, creepCount: 3 })
      expect(cellText(zone)).toBe('▲ RAD T1 ►YOU !2E c3')
    })

    it('names visible enemies when few enough to fit the dense cell, else counts', () => {
      // 1-2 named enemies → "who is here" (parity with the mobile cards).
      const named = makeZone({ id: 'mid-t1-rad', enemyCount: 2, enemyNames: ['Axe', 'Lina'] })
      expect(cellText(named)).toContain('!Axe,Lina')
      // 3+ would overflow the single-line cell → fall back to a count.
      const many = makeZone({
        id: 'mid-t1-rad',
        enemyCount: 3,
        enemyNames: ['Axe', 'Lina', 'Dawn'],
      })
      expect(cellText(many)).toContain('!3E')
    })

    it('shows the dead-tower glyph, ally count, and neutral-camp count', () => {
      const zone = makeZone({
        tower: { team: 'radiant', alive: false, tier: 1, hp: 0, maxHp: 600 },
        allies: ['a1', 'a2'],
        neutralCount: 3,
      })
      const text = cellText(zone)
      expect(text).toContain('✗') // razed tower
      expect(text).toContain('+2A') // two allies in zone
      expect(text).toContain('☘ 3') // three neutral creeps
    })

    it('marks own-team ward coverage with a vision glyph', () => {
      expect(cellText(makeZone({ wardCount: 1 }))).toContain('◉')
      expect(cellText(makeZone({ wardCount: 0 }))).not.toContain('◉')
    })

    it('flags a live rune with its type', () => {
      expect(cellText(makeZone({ id: 'rune-top', runeType: 'haste' }))).toContain('✦haste')
      expect(cellText(makeZone({ id: 'rune-top' }))).not.toContain('✦')
    })

    it('flags Roshan up vs respawning', () => {
      expect(
        cellText(makeZone({ id: 'roshan-pit', roshan: { alive: true, respawnIn: 0 } })),
      ).toContain('UP')
      expect(
        cellText(makeZone({ id: 'roshan-pit', roshan: { alive: false, respawnIn: 45 } })),
      ).toContain('↻45c')
    })

    it('labels each zone category with its glyphed name (a bare zone is just the name)', () => {
      const name = (id: string) => cellText(makeZone({ id }))
      expect(name('mid-t3-rad')).toBe('▲ RAD T3')
      expect(name('mid-t3-dire')).toBe('▼ DIRE T3')
      expect(name('mid-t2-rad')).toBe('▲ RAD T2')
      expect(name('mid-t2-dire')).toBe('▼ DIRE T2')
      expect(name('mid-t1-rad')).toBe('▲ RAD T1')
      expect(name('mid-t1-dire')).toBe('▼ DIRE T1')
      expect(name('top-river')).toBe('≈ RIVER ≈')
      expect(name('roshan-pit')).toBe('☠ ROSHAN')
      expect(name('rune-top')).toBe('◆ RUNE')
      expect(name('jungle-rad-top')).toBe('☘ JUNGLE')
    })

    it('falls back to an 8-char uppercase slice for an uncategorized zone id', () => {
      // No real zone reaches this branch (all categorize), but it guards the fallback.
      expect(cellText(makeZone({ id: 'mystery-zone' }))).toBe('MYSTERY-')
    })

    it('RENAME GUARD: labels come from the zone record, never the id string', () => {
      // Regression for the substring-parser trap: a zone id carrying NO side
      // semantics (the renamed world) must still label by team/type/tier. The
      // old includes('radiant') ladder rendered this whole column DIRE.
      expect(
        zoneRecordLabel({
          id: 'seawall-ice-1-chf',
          type: 'lane',
          team: 'radiant',
          tower: true,
          tier: 1,
        }),
      ).toBe('▲ RAD T1')
      expect(
        zoneRecordLabel({
          id: 'coldstore-ice-3-aud',
          type: 'lane',
          team: 'dire',
          tower: true,
          tier: 3,
        }),
      ).toBe('▼ DIRE T3')
      expect(zoneRecordLabel({ id: 'rookery-terminal', type: 'base', team: 'radiant' })).toBe(
        '★ RAD',
      )
      expect(zoneRecordLabel({ id: 'landing-terminal', type: 'base', team: 'dire' })).toBe('★ DIRE')
      expect(zoneRecordLabel({ id: 'silt-north', type: 'jungle', team: 'neutral' })).toBe(
        '☘ JUNGLE',
      )
      expect(zoneRecordLabel({ id: 'the-crossing', type: 'river', team: 'neutral' })).toBe(
        '≈ RIVER ≈',
      )
    })

    it('marks a standing tower with HP pips', () => {
      const zone = makeZone({
        id: 'mid-t1-rad',
        tower: { team: 'radiant', alive: true, tier: 1, hp: 200, maxHp: 900 },
      })
      expect(cellText(zone)).toContain('▲··')
    })
  })

  describe('towerPips', () => {
    it('scales three pips with remaining HP', () => {
      const at = (hp: number) =>
        towerPips({ team: 'radiant', alive: true, tier: 1, hp, maxHp: 900 })
      expect(at(900)).toBe('▲▲▲')
      expect(at(700)).toBe('▲▲▲')
      expect(at(600)).toBe('▲▲·')
      expect(at(301)).toBe('▲▲·')
      expect(at(300)).toBe('▲··')
      expect(at(1)).toBe('▲··')
    })

    it('never empties the pips while the tower still stands', () => {
      // A standing tower must not render identically to a razed one — the whole
      // point of the readout is "can I take this now".
      expect(towerPips({ team: 'dire', alive: true, tier: 3, hp: 0, maxHp: 900 })).toBe('▲··')
    })

    it('falls back to full pips when the server sent no usable HP', () => {
      expect(towerPips({ team: 'dire', alive: true, tier: 3 })).toBe('▲▲▲')
      // A zero maxHp would divide to NaN and render an EMPTY cell — worse than
      // saying nothing, since an empty slot reads as "no tower here".
      expect(towerPips({ team: 'dire', alive: true, tier: 3, hp: 0, maxHp: 0 })).toBe('▲▲▲')
    })

    it('marks a razed tower with the razed glyph, not pips', () => {
      expect(towerPips({ team: 'radiant', alive: false, tier: 1, hp: 0, maxHp: 900 })).toBe('✗')
    })
  })

  describe('ancientStatusLabel', () => {
    it('names whether the core can be attacked yet', () => {
      expect(ancientStatusLabel(makeAncient({ hp: 6000, maxHp: 6000 }))).toBe('LOCKED 100%')
      expect(ancientStatusLabel(makeAncient({ hp: 3000, maxHp: 6000, vulnerable: true }))).toBe(
        'EXPOSED 50%',
      )
    })

    it('drops the lock state once the core is razed', () => {
      expect(ancientStatusLabel(makeAncient({ hp: 0, alive: false }))).toBe('✗')
    })

    it('returns null when there is no ancient', () => {
      expect(ancientStatusLabel(null)).toBeNull()
      expect(ancientStatusLabel(undefined)).toBeNull()
    })
  })

  describe('buildRouteMarkers', () => {
    it('numbers every hop and flags the destination', () => {
      const markers = buildRouteMarkers('radiant-fountain', 'mid-t1-rad')
      // radiant-fountain → radiant-base → mid-t3-rad → mid-t2-rad → mid-t1-rad
      expect(markers.get('radiant-base')).toBe('1')
      expect(markers.get('mid-t3-rad')).toBe('2')
      expect(markers.get('mid-t2-rad')).toBe('3')
      expect(markers.get('mid-t1-rad')).toBe('⌖')
      // The zone you are standing in is never part of the drawn route.
      expect(markers.has('radiant-fountain')).toBe(false)
    })

    it('marks a single-hop walk as the destination outright', () => {
      const markers = buildRouteMarkers('mid-t1-rad', 'mid-river')
      expect([...markers]).toEqual([['mid-river', '⌖']])
    })

    it('draws nothing without a destination, or when already there', () => {
      expect(buildRouteMarkers('mid-river', null).size).toBe(0)
      expect(buildRouteMarkers('mid-river', undefined).size).toBe(0)
      expect(buildRouteMarkers('mid-river', 'mid-river').size).toBe(0)
      expect(buildRouteMarkers('', 'mid-river').size).toBe(0)
    })

    it('routes through the game map only, matching the hops the server will take', () => {
      const oneLane = new Set(ONE_LANE_MAP_ROWS.flat().filter((id): id is string => id !== null))
      // Off the one-lane map rune-top is unreachable, so no route is drawn at all
      // rather than one running through zones this game does not contain.
      expect(buildRouteMarkers('mid-river', 'rune-top', (id) => oneLane.has(id)).size).toBe(0)
      expect(buildRouteMarkers('mid-river', 'rune-top').get('rune-top')).toBe('⌖')
    })
  })

  describe('zoneAriaLabel', () => {
    it('describes a living ancient and whether it is attackable', () => {
      const zone = makeZone({ id: 'radiant-base', name: 'Radiant Base' })
      expect(zoneAriaLabel(zone, makeAncient({ hp: 3000, maxHp: 6000 }))).toContain(
        'ancient locked at 50%',
      )
      expect(
        zoneAriaLabel(zone, makeAncient({ hp: 3000, maxHp: 6000, vulnerable: true })),
      ).toContain('ancient exposed at 50%')
    })

    it('announces tower state, which is global info a fogged cell still carries', () => {
      expect(
        zoneAriaLabel(
          makeZone({
            fogged: true,
            tower: { team: 'dire', alive: true, tier: 2, hp: 450, maxHp: 900 },
          }),
        ),
      ).toContain('tier 2 tower standing at 50 percent')
      expect(zoneAriaLabel(makeZone({ tower: { team: 'dire', alive: false, tier: 2 } }))).toContain(
        'tier 2 tower destroyed',
      )
    })

    it('describes a destroyed ancient', () => {
      const zone = makeZone({ id: 'dire-base', name: 'Dire Base' })
      expect(zoneAriaLabel(zone, makeAncient({ team: 'dire', alive: false }))).toContain(
        'ancient destroyed',
      )
    })

    it('describes presence, allies, enemies, and fog for a non-ancient zone', () => {
      const zone = makeZone({ playerHere: true, allies: ['a1'], enemyCount: 2, fogged: true })
      const label = zoneAriaLabel(zone)
      expect(label).toContain('you are here')
      expect(label).toContain('1 allies')
      expect(label).toContain('2 enemies')
      expect(label).toContain('fogged')
    })

    it('announces ward coverage for screen readers', () => {
      expect(zoneAriaLabel(makeZone({ wardCount: 1 }))).toContain('warded')
      expect(zoneAriaLabel(makeZone({ wardCount: 0 }))).not.toContain('warded')
    })

    it('announces a live rune for screen readers', () => {
      expect(zoneAriaLabel(makeZone({ runeType: 'dd' }))).toContain('dd rune available')
    })

    it('announces Roshan state for screen readers', () => {
      expect(zoneAriaLabel(makeZone({ roshan: { alive: true, respawnIn: 0 } }))).toContain(
        'Roshan alive',
      )
      expect(zoneAriaLabel(makeZone({ roshan: { alive: false, respawnIn: 30 } }))).toContain(
        'Roshan respawns in 30c',
      )
    })
  })

  describe('compactIndicators', () => {
    it('shows tower HP and team glyph', () => {
      const zone = makeZone({
        tower: { team: 'radiant', alive: true, tier: 2, hp: 340, maxHp: 600 },
      })
      const inds = compactIndicators(zone)
      expect(inds[0]).toEqual({ text: '▲ T2 340/600', cls: 'text-radiant' })
    })

    it('shows destroyed towers as down', () => {
      const zone = makeZone({ tower: { team: 'dire', alive: false, tier: 1 } })
      const inds = compactIndicators(zone)
      expect(inds[0]).toEqual({ text: '✗ T1 down', cls: 'text-text-dim' })
    })

    it('colors a live dire tower and uses plural/singular unit forms correctly', () => {
      const zone = makeZone({
        tower: { team: 'dire', alive: true, tier: 3, hp: 500, maxHp: 1000 },
        allies: ['a1', 'a2'], // plural → "allies"
        creepCount: 2, // plural → "creeps"
        neutralCount: 1, // singular → "neutral"
      })
      const inds = compactIndicators(zone)
      const texts = inds.map((i) => i.text)
      expect(inds[0]).toEqual({ text: '▼ T3 500/1000', cls: 'text-dire' })
      expect(texts).toContain('+2 allies')
      expect(texts).toContain('2 creeps')
      expect(texts).toContain('☘ 1 neutral')
    })

    it('shows the ancient core with team color', () => {
      const zone = makeZone({ id: 'dire-base', name: 'Dire Base' })
      const inds = compactIndicators(zone, makeAncient({ team: 'dire', hp: 3000, maxHp: 6000 }))
      expect(inds).toContainEqual({ text: '◈ CORE LOCKED 50%', cls: 'text-dire' })
    })

    it('hides unit info for fogged zones but keeps global info', () => {
      const zone = makeZone({
        fogged: true,
        enemyCount: 3,
        tower: { team: 'radiant', alive: true, tier: 1 },
      })
      const inds = compactIndicators(zone)
      expect(inds.map((i) => i.text)).toEqual(['▲ T1', '? no vision'])
    })

    it('pluralizes unit counts', () => {
      const zone = makeZone({ allies: ['echo'], enemyCount: 2, creepCount: 1, neutralCount: 3 })
      const texts = compactIndicators(zone).map((i) => i.text)
      expect(texts).toContain('+1 ally')
      expect(texts).toContain('!2 enemies')
      expect(texts).toContain('1 creep')
      expect(texts).toContain('☘ 3 neutrals')
    })

    it('names enemies when known instead of just a count', () => {
      const zone = makeZone({ enemyCount: 2, enemyNames: ['Razor', 'Lina'] })
      const texts = compactIndicators(zone).map((i) => i.text)
      expect(texts).toContain('! Razor, Lina')
      expect(texts).not.toContain('!2 enemies')
    })

    it('reports clear when there is nothing to show', () => {
      const inds = compactIndicators(makeZone())
      expect(inds).toEqual([{ text: 'clear', cls: 'text-text-dim' }])
    })

    it('shows a ward-coverage chip (singular and plural)', () => {
      expect(compactIndicators(makeZone({ wardCount: 1 })).map((i) => i.text)).toContain('◉ warded')
      expect(compactIndicators(makeZone({ wardCount: 2 })).map((i) => i.text)).toContain(
        '◉ 2 wards',
      )
    })

    it('shows a live-rune chip with its type', () => {
      expect(
        compactIndicators(makeZone({ id: 'rune-top', runeType: 'haste' })).map((i) => i.text),
      ).toContain('✦ haste rune')
    })

    it('shows a Roshan chip (up vs respawn countdown)', () => {
      expect(
        compactIndicators(
          makeZone({ id: 'roshan-pit', roshan: { alive: true, respawnIn: 0 } }),
        ).map((i) => i.text),
      ).toContain('☠ Roshan UP')
      expect(
        compactIndicators(
          makeZone({ id: 'roshan-pit', roshan: { alive: false, respawnIn: 60 } }),
        ).map((i) => i.text),
      ).toContain('☠ Roshan ↻ 60c')
    })
  })

  describe('map layout selection (mapRowsFor / colHeadersFor)', () => {
    it('defaults to the full 5v5 grid', () => {
      expect(mapRowsFor(undefined)).toBe(MAP_ROWS)
      expect(mapRowsFor('default_5v5')).toBe(MAP_ROWS)
      expect(colHeadersFor(undefined)).toEqual([
        'SEAWALL',
        'CHAFF SILT',
        'COLDSTORE',
        'AUDIT SILT',
        'SHALLOWS',
      ])
    })

    it('renders the one-lane map as a single mid-lane column of the 11 zones', () => {
      const rows = mapRowsFor('one_lane')
      expect(rows).toBe(ONE_LANE_MAP_ROWS)
      expect(rows).toHaveLength(11)
      expect(rows.every((r) => r.length === 1)).toBe(true) // single column
      const zones = rows.flat()
      expect(zones[0]).toBe('radiant-fountain')
      expect(zones[zones.length - 1]).toBe('dire-fountain')
      expect(zones).toContain('mid-river')
      // No off-lane zones leak into the layout.
      expect(zones.some((z) => z?.startsWith('top-') || z?.startsWith('bot-'))).toBe(false)
      expect(colHeadersFor('one_lane')).toEqual(['COLDSTORE'])
    })

    it('renders the two-lane map with top + mid lanes, jungle, rune, and roshan', () => {
      const rows = mapRowsFor('two_lane')
      expect(rows).toBe(TWO_LANE_MAP_ROWS)
      expect(rows).toHaveLength(11)
      // 4-column grid.
      expect(rows.every((r) => r.length === 4)).toBe(true)
      const zones = rows.flat().filter((z): z is string => z !== null)
      // Endpoints.
      expect(zones[0]).toBe('radiant-fountain')
      expect(zones[zones.length - 1]).toBe('dire-fountain')
      // Top + mid lanes present.
      for (const id of ['top-t3-rad', 'top-river', 'top-t3-dire', 'mid-river', 'mid-t1-dire']) {
        expect(zones, `expected ${id} in two_lane layout`).toContain(id)
      }
      // Objectives present.
      expect(zones).toContain('rune-top')
      expect(zones).toContain('roshan-pit')
      // Bot lane entirely absent.
      expect(zones.some((z) => z.startsWith('bot-'))).toBe(false)
      expect(zones.some((z) => z.startsWith('rune-bot'))).toBe(false)
      expect(colHeadersFor('two_lane')).toEqual([
        'SEAWALL',
        'CHAFF SILT',
        'COLDSTORE',
        'AUDIT SILT',
      ])
    })
  })

  describe('shortColHeadersFor (mini-overview headers)', () => {
    it('shortens the 5v5 headers, collapsing both jungles to JG', () => {
      expect(shortColHeadersFor(undefined)).toEqual(['SEA', 'SILT', 'COLD', 'SILT', 'SHA'])
    })

    it('derives from the active layout for one_lane and two_lane', () => {
      expect(shortColHeadersFor('one_lane')).toEqual(['COLD'])
      expect(shortColHeadersFor('two_lane')).toEqual(['SEA', 'SILT', 'COLD', 'SILT'])
    })

    it('always matches the layout column count (never a hardcoded 5)', () => {
      for (const mapId of [undefined, 'one_lane', 'two_lane', 'default_5v5']) {
        expect(shortColHeadersFor(mapId)).toHaveLength(mapRowsFor(mapId)[0]!.length)
      }
    })
  })

  describe('miniOverviewCell', () => {
    it('shows the bare short code with territory color for an empty zone', () => {
      const cell = miniOverviewCell('mid-t2-dire', makeZone({ id: 'mid-t2-dire' }), null)
      expect(cell.code).toBe('M2')
      expect(cell.tower).toBeNull()
      expect(cell.marks).toBe('')
      expect(cell.classes).toContain('text-dire')
      expect(cell.classes).toContain('bg-bg-primary/60')
    })

    it('prefixes ► and highlights the cell where the player is', () => {
      const cell = miniOverviewCell('mid-t1-rad', makeZone({ playerHere: true }), null)
      expect(cell.code).toBe('►M1')
      expect(cell.classes).toEqual(expect.arrayContaining(['bg-self/30', 'font-bold']))
    })

    it('appends a team-colored ▲ for a standing tower', () => {
      const rad = miniOverviewCell(
        'mid-t1-rad',
        makeZone({ tower: { team: 'radiant', alive: true, tier: 1 } }),
        null,
      )
      expect(rad.tower).toEqual({ glyph: '▲', cls: 'text-radiant' })
      const dire = miniOverviewCell(
        'mid-t1-dire',
        makeZone({ id: 'mid-t1-dire', tower: { team: 'dire', alive: true, tier: 1 } }),
        null,
      )
      expect(dire.tower).toEqual({ glyph: '▲', cls: 'text-dire' })
    })

    it('appends a dim ✗ for a razed tower', () => {
      const cell = miniOverviewCell(
        'mid-t1-rad',
        makeZone({ tower: { team: 'radiant', alive: false, tier: 1 } }),
        null,
      )
      expect(cell.tower).toEqual({ glyph: '✗', cls: 'text-text-dim' })
    })

    it('shows a standing tower through fog (global info)', () => {
      const cell = miniOverviewCell(
        'mid-t2-dire',
        makeZone({
          id: 'mid-t2-dire',
          fogged: true,
          tower: { team: 'dire', alive: true, tier: 2 },
        }),
        null,
      )
      expect(cell.tower).toEqual({ glyph: '▲', cls: 'text-dire' })
      expect(cell.classes).toContain('opacity-40')
    })

    it('marks enemies and a razed mainframe after the code', () => {
      const cell = miniOverviewCell(
        'dire-base',
        makeZone({ id: 'dire-base', enemyCount: 2 }),
        makeAncient({ team: 'dire', alive: false }),
      )
      expect(cell.code).toBe('DB')
      expect(cell.marks).toBe('◈✗!')
    })

    it('handles zones missing from the display list', () => {
      const cell = miniOverviewCell('roshan-pit', undefined, null)
      expect(cell.code).toBe('ROS')
      expect(cell.tower).toBeNull()
      expect(cell.marks).toBe('')
      expect(cell.classes).toContain('text-text-dim')
      expect(cell.classes).toContain('bg-bg-primary/60')
    })
  })

  describe('grid layout helpers', () => {
    it('gridColsClass matches each layout column count', () => {
      expect(gridColsClass(MAP_ROWS)).toBe('grid-cols-5')
      expect(gridColsClass(TWO_LANE_MAP_ROWS)).toBe('grid-cols-4')
      expect(gridColsClass(ONE_LANE_MAP_ROWS)).toBe('grid-cols-1')
    })

    it('riverDividerRows reproduces the 5v5 {3,5} band and frames each layout river', () => {
      expect([...riverDividerRows(MAP_ROWS)].sort((a, b) => a - b)).toEqual([3, 5])
      for (const rows of [TWO_LANE_MAP_ROWS, ONE_LANE_MAP_ROWS]) {
        const idx = rows.findIndex((r) => r.some((z) => z?.includes('-river')))
        expect([...riverDividerRows(rows)].sort((a, b) => a - b)).toEqual([idx - 1, idx])
      }
    })

    it('compactRiverDividerRow is the first river row (4 for 5v5)', () => {
      expect(compactRiverDividerRow(MAP_ROWS)).toBe(4)
      expect(compactRiverDividerRow(TWO_LANE_MAP_ROWS)).toBe(
        TWO_LANE_MAP_ROWS.findIndex((r) => r.some((z) => z?.includes('-river'))),
      )
    })
  })
})
