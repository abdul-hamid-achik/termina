import { describe, it, expect } from 'vitest'
import {
  MAP_ROWS,
  ancientForZone,
  ancientLabel,
  buildAdjacentZones,
  cellText,
  compactIndicators,
  zoneAriaLabel,
  zoneShortCode,
  zoneTeam,
} from '../../../app/components/game/asciiMapModel'
import type { ZoneDisplay } from '../../../app/components/game/asciiMapModel'
import type { AncientState } from '../../../shared/types/game'
import { ZONE_IDS } from '../../../shared/constants/zones'

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

    it('shows a skull when destroyed', () => {
      expect(ancientLabel(makeAncient({ hp: 0, alive: false }))).toBe('☠')
    })

    it('returns null when there is no ancient', () => {
      expect(ancientLabel(null)).toBeNull()
      expect(ancientLabel(undefined)).toBeNull()
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
      expect(cellText(zone, makeAncient({ hp: 3000, maxHp: 6000 }))).toContain('◈50%')
    })

    it('shows a skull for a destroyed ancient', () => {
      const zone = makeZone({ id: 'dire-base', name: 'Dire Base' })
      expect(cellText(zone, makeAncient({ team: 'dire', hp: 0, alive: false }))).toContain('◈☠')
    })

    it('shows the ancient through fog (global info, like towers)', () => {
      const zone = makeZone({ id: 'dire-base', name: 'Dire Base', fogged: true })
      const text = cellText(zone, makeAncient({ team: 'dire', hp: 3000, maxHp: 6000 }))
      expect(text).toContain('◈50%')
      expect(text).toContain('?')
    })

    it('is unchanged for zones without an ancient', () => {
      const zone = makeZone({ playerHere: true, enemyCount: 2, creepCount: 3 })
      expect(cellText(zone)).toBe('▲ RAD T1 ►YOU !2E c3')
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
  })

  describe('zoneAriaLabel', () => {
    it('describes a living ancient', () => {
      const zone = makeZone({ id: 'radiant-base', name: 'Radiant Base' })
      expect(zoneAriaLabel(zone, makeAncient({ hp: 3000, maxHp: 6000 }))).toContain(
        'ancient at 50%',
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

    it('shows the ancient core with team color', () => {
      const zone = makeZone({ id: 'dire-base', name: 'Dire Base' })
      const inds = compactIndicators(zone, makeAncient({ team: 'dire', hp: 3000, maxHp: 6000 }))
      expect(inds).toContainEqual({ text: '◈ CORE 50%', cls: 'text-dire' })
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
  })
})
