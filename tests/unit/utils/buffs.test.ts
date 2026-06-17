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
})

describe('isInternalBuff', () => {
  it('flags item-cooldown markers and the tp destination pair', () => {
    expect(isInternalBuff('item_cd_dagon')).toBe(true)
    expect(isInternalBuff('item_cd_black_king_bar')).toBe(true)
    expect(isInternalBuff('tp_destination')).toBe(true)
  })

  it('does not flag real player-facing effects', () => {
    expect(isInternalBuff('magic_immune')).toBe(false)
    expect(isInternalBuff('tp_channeling')).toBe(false)
    expect(isInternalBuff('stun')).toBe(false)
  })
})

describe('displayBuffs', () => {
  it('drops internal bookkeeping markers from the strip', () => {
    const out = displayBuffs([
      buff('magic_immune', 1, 4),
      buff('item_cd_black_king_bar', 1, 25),
      buff('tp_destination', 1, 4),
    ])
    expect(out.map((b) => b.id)).toEqual(['magic_immune'])
  })

  it('maps label + kind + stacks and preserves a finite countdown', () => {
    const [b] = displayBuffs([buff('veil_discord', 25, 4)])
    expect(b).toMatchObject({ label: 'Discord', kind: 'negative', stacks: 25, ticks: 4 })
  })

  it('nulls the countdown for near-permanent auras (>= 999t)', () => {
    const [b] = displayBuffs([buff('power_treads_attack', 15, 999)])
    expect(b!.label).toBe('Treads: Attack')
    expect(b!.ticks).toBeNull()
  })

  it('returns an empty list when every buff is internal', () => {
    expect(displayBuffs([buff('item_cd_dagon', 1, 18)])).toEqual([])
  })
})
