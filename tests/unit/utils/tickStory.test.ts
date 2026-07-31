import { describe, it, expect } from 'vitest'
import {
  digestFarmNoise,
  buildTickStoryView,
  buildTickRecaps,
  collapseStructureDamage,
  type CombatLine,
} from '~~/app/utils/combatLog'

/** Shorthand line factory. */
function line(overrides: Partial<CombatLine> & { text: string }): CombatLine {
  return { cycle: 1, type: 'damage', ...overrides }
}

describe('digestFarmNoise', () => {
  it('folds all farm-tagged lines of a cycle into one dim summary', () => {
    const out = digestFarmNoise([
      line({ text: 'Kernel hit a wave for 60', salience: 'ally', farmKind: 'hit' }),
      line({ text: 'Ping hit a wave for 55', salience: 'ally', farmKind: 'hit' }),
      line({
        text: 'You last-hit a line wave (+38sc)',
        type: 'scrip',
        salience: 'mine-out',
        farmKind: 'lasthit',
        scripAmount: 38,
      }),
      line({
        text: 'Kernel last-hit a sweep wave (+45sc)',
        type: 'scrip',
        salience: 'ally',
        farmKind: 'lasthit',
        scripAmount: 45,
      }),
      line({
        text: 'Echo cleared a stub camp in Chaff Jungle (North)',
        type: 'scrip',
        salience: 'ally',
        farmKind: 'camp',
      }),
      line({ text: 'a kill happened', type: 'kill', salience: 'world' }),
    ])

    const farm = out.filter((l) => l.type === 'farm')
    expect(farm).toHaveLength(1)
    expect(farm[0]!.text).toBe('farm: you +38sc (1 last-hit) · team 1 wave, 1 camp')
    // Untagged lines survive untouched.
    expect(out.some((l) => l.text === 'a kill happened')).toBe(true)
    // No raw farm line survives.
    expect(out.some((l) => l.farmKind)).toBe(false)
  })

  it('notes visible enemy farming without counting it as team farm', () => {
    const out = digestFarmNoise([
      line({ text: 'Thread hit a wave for 161', salience: 'world', farmKind: 'hit' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.text).toBe('farm: enemy farming in sight')
  })

  it('attributes visible ENEMY camp clears and burns to enemy, never to team', () => {
    const out = digestFarmNoise([
      line({ text: 'Thread cleared a camp', type: 'scrip', salience: 'world', farmKind: 'camp' }),
      line({ text: 'Thread burned a wave', type: 'system', salience: 'world', farmKind: 'burn' }),
      line({
        text: 'Kernel last-hit a wave (+40sc)',
        type: 'scrip',
        salience: 'ally',
        farmKind: 'lasthit',
      }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.text).toBe('farm: team 1 wave · enemy 1 camp, 1 burn')
  })

  it('marks the digest mine-out when it carries MY rewards (so the ME filter keeps it)', () => {
    const mine = digestFarmNoise([
      line({
        text: 'You last-hit a wave (+38sc)',
        type: 'scrip',
        salience: 'mine-out',
        farmKind: 'lasthit',
        scripAmount: 38,
      }),
    ])
    expect(mine[0]!.salience).toBe('mine-out')

    const others = digestFarmNoise([
      line({
        text: 'Kernel last-hit a wave (+40sc)',
        type: 'scrip',
        salience: 'ally',
        farmKind: 'lasthit',
      }),
    ])
    expect(others[0]!.salience).toBe('world')
  })

  it('produces one summary per cycle, in cycle order', () => {
    const out = digestFarmNoise([
      line({ cycle: 1, text: 'a', salience: 'ally', farmKind: 'hit' }),
      line({
        cycle: 1,
        text: 'lh',
        type: 'scrip',
        salience: 'ally',
        farmKind: 'lasthit',
      }),
      line({ cycle: 2, text: 'b', salience: 'ally', farmKind: 'hit' }),
      line({
        cycle: 2,
        text: 'lh2',
        type: 'scrip',
        salience: 'ally',
        farmKind: 'lasthit',
      }),
    ])
    expect(out.map((l) => [l.cycle, l.type])).toEqual([
      [1, 'farm'],
      [2, 'farm'],
    ])
  })

  it('emits no summary for a cycle with only untagged lines', () => {
    const out = digestFarmNoise([line({ text: 'You hit Kernel for 84', salience: 'mine-out' })])
    expect(out).toHaveLength(1)
    expect(out[0]!.type).toBe('damage')
  })
})

describe('buildTickStoryView', () => {
  it('orders a cycle: my lines first, kills/objectives next, farm digest last', () => {
    const out = buildTickStoryView([
      line({ text: 'ally chip', salience: 'ally' }),
      line({ text: 'enemy farm', salience: 'world', farmKind: 'hit' }),
      line({ text: 'kill line', type: 'kill', salience: 'world' }),
      line({ text: 'cache grabbed', type: 'objective', salience: 'ally' }),
      line({ text: 'hit ON me', salience: 'mine-in' }),
      line({ text: 'my hit', salience: 'mine-out' }),
    ])
    expect(out.map((l) => l.text)).toEqual([
      'hit ON me',
      'my hit',
      'kill line',
      'cache grabbed',
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
      line({ cycle: 2, text: 'later kill', type: 'kill' }),
      line({ cycle: 1, text: 'early chip', salience: 'world' }),
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

describe('buildTickRecaps', () => {
  /** Damage landing ON the local player. */
  function incoming(cycle: number, source: string, amount: number): CombatLine {
    return {
      cycle,
      text: `${source} hit You for ${amount}`,
      type: 'damage',
      salience: 'mine-in',
      dmgAmount: amount,
      sourceLabel: source,
      targetLabel: 'You',
    }
  }

  /** Damage the local player deals. */
  function outgoing(cycle: number, target: string, amount: number): CombatLine {
    return {
      cycle,
      text: `You hit ${target} for ${amount}`,
      type: 'damage',
      salience: 'mine-out',
      dmgAmount: amount,
      sourceLabel: 'You',
      targetLabel: target,
    }
  }

  it('sums the cycle into one sentence instead of leaving the player to add it up', () => {
    const recaps = buildTickRecaps([
      incoming(12, 'Mutex', 84),
      incoming(12, 'Mutex', 22),
      incoming(12, 'burn', 25),
      outgoing(12, 'Thread', 62),
    ])
    const r = recaps.get(12)!
    expect(r.taken).toBe(131)
    expect(r.dealt).toBe(62)
    expect(r.takenText).toBe('You took 131 (Mutex 106, burn 25)')
    expect(r.dealtText).toBe('You dealt 62 to Thread')
    expect(r.text).toBe('You took 131 (Mutex 106, burn 25) · You dealt 62 to Thread')
  })

  it('names a lone contributor inline rather than as a one-item breakdown', () => {
    expect(buildTickRecaps([incoming(3, 'a wave', 40)]).get(3)!.takenText).toBe(
      'You took 40 from a wave',
    )
  })

  it('orders the breakdown by damage and rolls the tail into "+N more"', () => {
    const r = buildTickRecaps([
      incoming(1, 'D', 5),
      incoming(1, 'C', 10),
      incoming(1, 'B', 20),
      incoming(1, 'A', 40),
    ]).get(1)!
    expect(r.takenText).toBe('You took 75 (A 40, B 20, C 10, +1 more)')
  })

  it('ignores everyone else’s fight and every non-damage line', () => {
    const recaps = buildTickRecaps([
      {
        cycle: 4,
        text: 'Kernel hit Thread for 90',
        type: 'damage',
        salience: 'ally',
        dmgAmount: 90,
      },
      {
        cycle: 4,
        text: 'Thread hit Echo for 70',
        type: 'damage',
        salience: 'world',
        dmgAmount: 70,
      },
      { cycle: 4, text: 'You restored 60', type: 'healing', salience: 'mine-in', dmgAmount: 60 },
    ])
    expect(recaps.size).toBe(0)
  })

  it('reports one recap per cycle and never merges ticks', () => {
    const recaps = buildTickRecaps([incoming(1, 'Mutex', 30), incoming(2, 'Mutex', 40)])
    expect([...recaps.keys()].sort((a, b) => a - b)).toEqual([1, 2])
    expect(recaps.get(1)!.taken).toBe(30)
    expect(recaps.get(2)!.taken).toBe(40)
  })

  it('counts a collapsed structure run at its RUN total, not its first hit', () => {
    // The ice/Core chip the player is dealing arrives as one line per cycle and
    // is collapsed before it ever reaches the recap; reading the surviving
    // line's original dmgAmount would report a fifth of the breach.
    const run = [1, 2, 3].map((cycle) => ({
      ...outgoing(cycle, 'ice (mid-t1-audit)', 70),
      dedupKey: 'dmg:me->ice_mid-t1-audit',
    }))
    const collapsed = collapseStructureDamage(
      run,
      ({ baseText, total }) => `${baseText} (${total})`,
    )
    expect(collapsed).toHaveLength(1)
    const r = buildTickRecaps(collapsed).get(3)!
    expect(r.dealt).toBe(210)
  })
})
