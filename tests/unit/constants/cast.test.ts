import { describe, it, expect } from 'vitest'
import { CAST } from '~~/shared/constants/cast'
import { HERO_IDS } from '~~/shared/constants/heroes'

// The retired draft handles from the source note — a copy-paste slip would
// otherwise ship an old name.
const RETIRED = [
  'tally',
  'obit',
  'escrow',
  'vigil',
  'lintel',
  'double',
  'repo',
  'ballast',
  'seam',
  'cordon',
  'erase',
  'tempo',
  'stake',
  'lag',
  'rounds',
  'shunt',
  'quota',
  'sump',
]

describe('cast.ts — the eighteen operators', () => {
  it('has exactly one entry per hero id and no extras', () => {
    expect(Object.keys(CAST).sort()).toEqual([...HERO_IDS].sort())
  })

  it('every realName is unique and at least two words', () => {
    const names = Object.values(CAST).map((c) => c.realName)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) {
      expect(name.trim().split(/\s+/).length, `"${name}" is not a full name`).toBeGreaterThanOrEqual(2)
    }
  })

  it('every bio is at least 400 characters (a truncation would pass typecheck)', () => {
    for (const [id, c] of Object.entries(CAST)) {
      expect(c.bio.length, `${id} bio truncated`).toBeGreaterThanOrEqual(400)
    }
  })

  it('every handleRationale and kitReading is non-empty', () => {
    for (const [id, c] of Object.entries(CAST)) {
      expect(c.handleRationale.length, `${id} handleRationale`).toBeGreaterThan(0)
      expect(c.kitReading.length, `${id} kitReading`).toBeGreaterThan(0)
    }
  })

  it('no field USES a retired draft handle as a name', () => {
    // Canon bio prose may MENTION an old street nickname in passing
    // ("Runners call her Tally") — what may not happen is a retired handle
    // surfacing as the operator's NAME or being referenced as their handle.
    for (const [id, c] of Object.entries(CAST)) {
      for (const old of RETIRED) {
        expect(
          c.realName.toLowerCase().includes(old),
          `${id} realName mentions retired handle "${old}"`,
        ).toBe(false)
        expect(
          c.handleRationale.toLowerCase().includes(`called this one ${old}`),
          `${id} handleRationale uses retired handle "${old}"`,
        ).toBe(false)
      }
    }
  })

  it('origins follow the canon split (6 corp, 12 street)', () => {
    const corp = Object.values(CAST).filter((c) => c.origin === 'corp')
    expect(corp).toHaveLength(6)
  })
})
