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
  ITEM_CLASS_PRIMERS,
  ACTION_LABELS,
  CURRENCY,
  WAVE_UNIT_LABELS,
  CAMP_LABELS,
  cycleFrameLine,
} from '~~/shared/constants/world'
import { ITEM_CATEGORIES } from '~~/shared/constants/items'

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
      'orphan',
      'stub',
      'warden',
      'watchdog',
      'zombie',
    ])
  })

  it('labels the structure tiers, wards, actions and currency', () => {
    expect(STRUCTURE_LABELS.ice[3]).toBe('BLACK ICE')
    expect(STRUCTURE_LABELS.terminal).toBe('Terminal')
    expect(OBJECTIVE_LABELS.tenant).toBe('THE TENANT')
    expect(OBJECTIVE_LABELS.backup).toBe('BACKUP')
    expect(WARD_LABELS).toEqual({ camtap: 'CAMTAP', sniffer: 'SNIFFER' })
    expect(ACTION_LABELS).toEqual({ harden: 'HARDEN', burn: 'BURN' })
    expect(CURRENCY.label).toBe('scrip')
  })
})

describe('ITEM_CLASS_PRIMERS', () => {
  /**
   * The primers are a SECOND table keyed by category id, which is exactly the
   * shape that drifts: adding a sixth cyberware class, or renaming one, leaves
   * this file silently behind and the page renders an empty explanation with no
   * error anywhere. WARD_LABELS drifted this way and went unnoticed for months —
   * it was keyed `observer`/`sentry` while the engine emitted `camtap`/`sniffer`,
   * so every lookup missed.
   */
  it('covers every item class, and invents none', () => {
    const classes = ITEM_CATEGORIES.map((c) => c.id).sort()
    expect(Object.keys(ITEM_CLASS_PRIMERS).sort()).toEqual(classes)
  })

  it('every primer says both what it IS and when to buy it', () => {
    for (const [id, primer] of Object.entries(ITEM_CLASS_PRIMERS)) {
      expect(primer.where.trim().length, `${id} has no fiction`).toBeGreaterThan(20)
      expect(primer.buyWhen.trim().length, `${id} does not answer "when"`).toBeGreaterThan(20)
    }
  })

  it('answers a different question than the category blurb', () => {
    // The blurb is a shelf label ("carried weapons and attachments"); the primer
    // is the decision. If they were the same string the section would be noise.
    for (const category of ITEM_CATEGORIES) {
      const primer = ITEM_CLASS_PRIMERS[category.id]!
      expect(primer.buyWhen).not.toBe(category.blurb)
      expect(primer.where).not.toBe(category.blurb)
    }
  })
})
