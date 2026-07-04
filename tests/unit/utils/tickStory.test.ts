import { describe, it, expect } from 'vitest'
import { digestFarmNoise, buildTickStoryView, type CombatLine } from '../../../app/utils/combatLog'

/** Shorthand line factory. */
function line(overrides: Partial<CombatLine> & { text: string }): CombatLine {
  return { tick: 1, type: 'damage', ...overrides }
}

describe('digestFarmNoise', () => {
  it('folds all farm-tagged lines of a tick into one dim summary', () => {
    const out = digestFarmNoise([
      line({ text: 'Kernel hit a creep for 60', salience: 'ally', farmKind: 'hit' }),
      line({ text: 'Ping hit a creep for 55', salience: 'ally', farmKind: 'hit' }),
      line({
        text: 'You last-hit a melee creep (+38g)',
        type: 'gold',
        salience: 'mine-out',
        farmKind: 'lasthit',
        goldAmount: 38,
      }),
      line({
        text: 'Kernel last-hit a ranged creep (+45g)',
        type: 'gold',
        salience: 'ally',
        farmKind: 'lasthit',
        goldAmount: 45,
      }),
      line({
        text: 'Echo cleared a kobold camp in Radiant Jungle (North)',
        type: 'gold',
        salience: 'ally',
        farmKind: 'camp',
      }),
      line({ text: 'a kill happened', type: 'kill', salience: 'world' }),
    ])

    const farm = out.filter((l) => l.type === 'farm')
    expect(farm).toHaveLength(1)
    expect(farm[0]!.text).toBe('farm: you +38g (1 last-hit) · team 1 creep, 1 camp')
    // Untagged lines survive untouched.
    expect(out.some((l) => l.text === 'a kill happened')).toBe(true)
    // No raw farm line survives.
    expect(out.some((l) => l.farmKind)).toBe(false)
  })

  it('notes visible enemy farming without counting it as team farm', () => {
    const out = digestFarmNoise([
      line({ text: 'Thread hit a creep for 161', salience: 'world', farmKind: 'hit' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.text).toBe('farm: enemy farming in sight')
  })

  it('attributes visible ENEMY camp clears and denies to enemy, never to team', () => {
    const out = digestFarmNoise([
      line({ text: 'Thread cleared a camp', type: 'gold', salience: 'world', farmKind: 'camp' }),
      line({ text: 'Thread denied a creep', type: 'system', salience: 'world', farmKind: 'deny' }),
      line({
        text: 'Kernel last-hit a creep (+40g)',
        type: 'gold',
        salience: 'ally',
        farmKind: 'lasthit',
      }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.text).toBe('farm: team 1 creep · enemy 1 camp, 1 deny')
  })

  it('marks the digest mine-out when it carries MY rewards (so the ME filter keeps it)', () => {
    const mine = digestFarmNoise([
      line({
        text: 'You last-hit a creep (+38g)',
        type: 'gold',
        salience: 'mine-out',
        farmKind: 'lasthit',
        goldAmount: 38,
      }),
    ])
    expect(mine[0]!.salience).toBe('mine-out')

    const others = digestFarmNoise([
      line({
        text: 'Kernel last-hit a creep (+40g)',
        type: 'gold',
        salience: 'ally',
        farmKind: 'lasthit',
      }),
    ])
    expect(others[0]!.salience).toBe('world')
  })

  it('produces one summary per tick, in tick order', () => {
    const out = digestFarmNoise([
      line({ tick: 1, text: 'a', salience: 'ally', farmKind: 'hit' }),
      line({
        tick: 1,
        text: 'lh',
        type: 'gold',
        salience: 'ally',
        farmKind: 'lasthit',
      }),
      line({ tick: 2, text: 'b', salience: 'ally', farmKind: 'hit' }),
      line({
        tick: 2,
        text: 'lh2',
        type: 'gold',
        salience: 'ally',
        farmKind: 'lasthit',
      }),
    ])
    expect(out.map((l) => [l.tick, l.type])).toEqual([
      [1, 'farm'],
      [2, 'farm'],
    ])
  })

  it('emits no summary for a tick with only untagged lines', () => {
    const out = digestFarmNoise([line({ text: 'You hit Kernel for 84', salience: 'mine-out' })])
    expect(out).toHaveLength(1)
    expect(out[0]!.type).toBe('damage')
  })
})

describe('buildTickStoryView', () => {
  it('orders a tick: my lines first, kills/objectives next, farm digest last', () => {
    const out = buildTickStoryView([
      line({ text: 'ally chip', salience: 'ally' }),
      line({ text: 'enemy farm', salience: 'world', farmKind: 'hit' }),
      line({ text: 'kill line', type: 'kill', salience: 'world' }),
      line({ text: 'rune grabbed', type: 'objective', salience: 'ally' }),
      line({ text: 'hit ON me', salience: 'mine-in' }),
      line({ text: 'my hit', salience: 'mine-out' }),
    ])
    expect(out.map((l) => l.text)).toEqual([
      'hit ON me',
      'my hit',
      'kill line',
      'rune grabbed',
      'ally chip',
      'farm: enemy farming in sight',
    ])
  })

  it('folds ally farm hits with no outcome to nothing (quiet beat, not a summary)', () => {
    const out = buildTickStoryView([
      line({ text: 'team farm', salience: 'ally', farmKind: 'hit' }),
      line({ text: 'kill line', type: 'kill', salience: 'world' }),
    ])
    expect(out.map((l) => l.text)).toEqual(['kill line'])
  })

  it('never reorders across ticks', () => {
    const out = buildTickStoryView([
      line({ tick: 2, text: 'later kill', type: 'kill' }),
      line({ tick: 1, text: 'early chip', salience: 'world' }),
    ])
    expect(out.map((l) => l.text)).toEqual(['early chip', 'later kill'])
  })

  it('keeps original order within the same priority band (stable)', () => {
    const out = buildTickStoryView([
      line({ text: 'first world line', salience: 'world' }),
      line({ text: 'second world line', salience: 'world' }),
    ])
    expect(out.map((l) => l.text)).toEqual(['first world line', 'second world line'])
  })
})
