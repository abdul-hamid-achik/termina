import { describe, it, expect } from 'vitest'
import { buffLabel, buffKind, isInternalBuff, displayBuffs } from '../../../app/utils/buffs'

const buff = (id: string, stacks = 1, ticksRemaining = 3) => ({ id, stacks, ticksRemaining })

describe('buffLabel', () => {
  it('maps known effect ids to readable names', () => {
    expect(buffLabel('magic_immune')).toBe('Magic Immune')
    expect(buffLabel('veil_discord')).toBe('Discord')
    expect(buffLabel('silver_edge_invis')).toBe('Invisible')
    expect(buffLabel('stun')).toBe('Stunned')
  })

  it('title-cases unknown ids as a fallback', () => {
    expect(buffLabel('some_new_effect')).toBe('Some New Effect')
    expect(buffLabel('bkb')).toBe('Bkb')
  })

  it('splits camelCase in unknown ids so future engine ids degrade readably', () => {
    expect(buffLabel('someNewEffect')).toBe('Some New Effect')
    expect(buffLabel('futureMarker_dot')).toBe('Future Marker Dot')
  })

  it('maps the engine camelCase ids from the audit to readable names', () => {
    expect(buffLabel('heapGrowth')).toBe('Heap Growth')
    expect(buffLabel('attackReduction')).toBe('Timeout')
    expect(buffLabel('antiHeal')).toBe('Invalidate')
    expect(buffLabel('defenseBuff')).toBe('Fortify')
    expect(buffLabel('voidZone_dot')).toBe('Void Zone')
  })
})

describe('buffKind', () => {
  it('classifies survival/steroid effects as positive', () => {
    expect(buffKind('magic_immune')).toBe('positive')
    expect(buffKind('stack_overflow_buff')).toBe('positive')
  })

  it('classifies disables / amps / DoTs as negative', () => {
    expect(buffKind('stun')).toBe('negative')
    expect(buffKind('veil_discord')).toBe('negative')
    expect(buffKind('inject_dot')).toBe('negative')
  })

  it('classifies vision/utility and unknown effects as neutral', () => {
    expect(buffKind('tp_channeling')).toBe('neutral')
    expect(buffKind('cyclone')).toBe('neutral')
    expect(buffKind('some_new_effect')).toBe('neutral')
  })

  it('classifies dmz as positive (the Firewall caster’s own shield-bomb)', () => {
    expect(buffKind('dmz')).toBe('positive')
  })

  it('classifies deadlock as a positive self-buff, not a disable', () => {
    expect(buffKind('deadlock')).toBe('positive')
    expect(buffLabel('deadlock')).toBe('Deadlock')
  })
})

describe('isInternalBuff', () => {
  it('flags item-cooldown markers and the tp destination pair', () => {
    expect(isInternalBuff('item_cd_dagon')).toBe(true)
    expect(isInternalBuff('item_cd_black_king_bar')).toBe(true)
    expect(isInternalBuff('tp_destination')).toBe(true)
  })

  it('flags engine bookkeeping markers (target/tick trackers, counters, flags)', () => {
    for (const id of [
      'deadlockZone',
      'stealthIdle',
      'patternCacheTarget',
      'patternCacheTick',
      'resonanceTarget',
      'voidDrain',
      'closureCasts',
      'inCombat',
    ]) {
      expect(isInternalBuff(id), id).toBe(true)
    }
  })

  it('does not flag real player-facing effects', () => {
    expect(isInternalBuff('magic_immune')).toBe(false)
    expect(isInternalBuff('tp_channeling')).toBe(false)
    expect(isInternalBuff('stun')).toBe(false)
    expect(isInternalBuff('deadlock')).toBe(false) // the visible buff, not deadlockZone
    expect(isInternalBuff('resonance')).toBe(false) // the visible buff, not resonanceTarget
  })
})

describe('displayBuffs', () => {
  it('drops internal bookkeeping markers from the strip', () => {
    const out = displayBuffs([
      buff('magic_immune', 1, 4),
      buff('item_cd_black_king_bar', 1, 25),
      buff('tp_destination', 1, 4),
      buff('stealthIdle', 37, 99),
      buff('inCombat', 2, 2),
      buff('resonanceTarget', 30, 5),
    ])
    expect(out.map((b) => b.id)).toEqual(['magic_immune'])
  })

  it('maps label + kind and preserves a finite countdown', () => {
    const [b] = displayBuffs([buff('veil_discord', 25, 4)])
    expect(b).toMatchObject({ label: 'Discord', kind: 'negative', ticks: 4 })
  })

  it('hides magnitude-encoding stacks (returns 1 so no count chip renders)', () => {
    // veil_discord's 25 is an amp %, shield's 300 is shield HP — not counts.
    const out = displayBuffs([buff('veil_discord', 25, 4), buff('shield', 300, 6)])
    expect(out.map((b) => b.stacks)).toEqual([1, 1])
  })

  it('shows stacks only for ids where they are a true count (showStacks)', () => {
    const out = displayBuffs([
      buff('heapGrowth', 12, 999),
      buff('resonance', 30, 30),
      buff('hopCount', 3, 5),
    ])
    expect(out.map((b) => b.stacks)).toEqual([12, 30, 3])
  })

  it('nulls the countdown for permanent-flagged buffs even with a finite tick counter', () => {
    // overwatch is re-applied every tick; resonance's 30t is a refresh-on-attack window.
    const out = displayBuffs([buff('overwatch', 2, 2), buff('resonance', 30, 30)])
    expect(out.map((b) => b.ticks)).toEqual([null, null])
  })

  it('nulls the countdown for near-permanent auras (>= 999t)', () => {
    const [b] = displayBuffs([buff('power_treads_attack', 15, 999)])
    expect(b!.label).toBe('Treads: Attack')
    expect(b!.ticks).toBeNull()
    expect(b!.stacks).toBe(1) // treads' 15 is the stat bonus, not a count
  })

  it('returns an empty list when every buff is internal', () => {
    expect(displayBuffs([buff('item_cd_dagon', 1, 18)])).toEqual([])
  })
})
