import { describe, it, expect } from 'vitest'
import {
  CITY,
  DISTRICTS,
  ROUTES,
  CREWS,
  FACTION_META,
  STRUCTURE_LABELS,
  OBJECTIVE_LABELS,
  WARD_LABELS,
  ACTION_LABELS,
  CURRENCY,
  WAVE_UNIT_LABELS,
  CAMP_LABELS,
  cycleFrameLine,
} from '~~/shared/constants/world'

describe('world lexicon', () => {
  it('names the settled frame constants', () => {
    expect(CITY).toBe('TERMINA')
    expect(DISTRICTS).toEqual(['LANDING', 'ROOKERY', 'COLDSTORE', 'SHALLOWS'])
    expect(ROUTES).toEqual(['SEAWALL', 'COLDSTORE', 'SHALLOWS'])
    expect(CREWS).toEqual({ chaff: 'CHAFF', audit: 'AUDIT' })
  })

  it('renders the cycle frame line with the live tick seconds', () => {
    expect(cycleFrameLine(4)).toBe(
      'The city commits every instruction at once, 4s wide: one cycle.',
    )
  })

  it('covers every TeamId in FACTION_META (chaff/audit until the R1-05 sweep)', () => {
    // Keyed on the union AS IT IS so the R1-05 sweep touches only this file.
    expect(Object.keys(FACTION_META).sort()).toEqual(['audit', 'chaff'])
    expect(FACTION_META.chaff.label).toBe('CHAFF')
    expect(FACTION_META.audit.label).toBe('AUDIT')
    for (const meta of Object.values(FACTION_META)) {
      expect(meta.short.length).toBeGreaterThan(0)
      expect(meta.blurb.length).toBeGreaterThan(0)
    }
  })

  it('covers every wave role for both crews, asymmetrically', () => {
    const roles = ['line', 'sweep', 'breach'] as const
    for (const team of ['chaff', 'audit'] as const) {
      for (const role of roles) {
        expect(WAVE_UNIT_LABELS[team][role].length).toBeGreaterThan(0)
      }
    }
    // The whole point of the mapping: the crews do NOT share unit names.
    for (const role of roles) {
      expect(WAVE_UNIT_LABELS.chaff[role]).not.toBe(WAVE_UNIT_LABELS.audit[role])
    }
  })

  it('covers every cache type as a cache drop', () => {
    expect(Object.keys(OBJECTIVE_LABELS.cache).sort()).toEqual([
      'arcane',
      'dd',
      'haste',
      'invis',
      'regen',
    ])
  })

  it('covers the five neutral camps', () => {
    expect(Object.keys(CAMP_LABELS).sort()).toEqual([
      'ancient_dragon',
      'ancient_rock_golem',
      'centaur',
      'kobold',
      'ogre_mage',
    ])
  })

  it('labels the structure tiers, wards, actions and currency', () => {
    expect(STRUCTURE_LABELS.ice[3]).toBe('BLACK ICE')
    expect(STRUCTURE_LABELS.mainframe).toBe('Mainframe')
    expect(OBJECTIVE_LABELS.tenant).toBe('THE TENANT')
    expect(OBJECTIVE_LABELS.backup).toBe('BACKUP')
    expect(WARD_LABELS).toEqual({ observer: 'CAMTAP', sentry: 'SNIFFER' })
    expect(ACTION_LABELS).toEqual({ harden: 'HARDEN', burn: 'BURN' })
    expect(CURRENCY.label).toBe('scrip')
  })
})
