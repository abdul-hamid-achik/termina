import { describe, it, expect } from 'vitest'
import {
  digestFarmNoise,
  buildTickStoryView,
  buildTickRecaps,
  collapseStructureDamage,
  digestNpcHitsOnMe,
  recapClausesFor,
  isNpcSourceId,
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
      ...outgoing(cycle, 'ice (coldstore-t1-audit)', 70),
      dedupKey: 'dmg:me->ice_coldstore-t1-audit',
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

// Playtest 2026-10 (13.png): "farm: enemy farming in sight" filled cycle after
// cycle on its own. It is a standing state — said once when it starts.
describe('enemy farming in sight (a state, not an event)', () => {
  const seen = (cycle: number) =>
    line({ cycle, text: `Thread hit a wave (${cycle})`, salience: 'world', farmKind: 'hit' })

  it('is said when it starts and not repeated while it persists', () => {
    const out = digestFarmNoise([seen(85), seen(86), seen(87)])
    expect(out.map((l) => [l.cycle, l.text])).toEqual([[85, 'farm: enemy farming in sight']])
  })

  it('is said again after a cycle without it', () => {
    const out = digestFarmNoise([seen(85), seen(87)])
    expect(out.map((l) => l.cycle)).toEqual([85, 87])
  })

  it('never yields two digests for one cycle once the feed is cycle-sorted', () => {
    // GameScreen merges engine lines with local notices and sorts by cycle
    // (stable) before the story view — interleaved sources stay one digest.
    const merged = [
      line({ cycle: 5, text: 'Kernel hit a wave', salience: 'ally', farmKind: 'hit' }),
      line({ cycle: 5, text: 'lh', type: 'scrip', salience: 'ally', farmKind: 'lasthit' }),
      line({ cycle: 5, text: '[SYS] local notice', type: 'system' }),
      line({
        cycle: 5,
        text: 'Ping last-hit',
        type: 'scrip',
        salience: 'ally',
        farmKind: 'lasthit',
      }),
      line({ cycle: 6, text: 'lh', type: 'scrip', salience: 'ally', farmKind: 'lasthit' }),
    ].sort((a, b) => a.cycle - b.cycle)
    const digests = buildTickStoryView(merged).filter((l) => l.type === 'farm')
    expect(digests.map((l) => l.cycle)).toEqual([5, 6])
  })
})

// Playtest 2026-10 (25.png): a wave stack printed four "a wave hit You for 19"
// lines a cycle, under a recap that said the same thing again.
describe('NPC hits on me fold into one line per cycle (story view)', () => {
  const waveHit = (amount: number, cycle = 19): CombatLine =>
    line({
      cycle,
      text: `a wave hit You for ${amount} kinetic`,
      salience: 'mine-in',
      dmgAmount: amount,
      sourceLabel: 'a wave',
      targetLabel: 'You',
      npcSource: 'waves',
    })
  const iceHit = (amount: number): CombatLine =>
    line({
      cycle: 19,
      text: `ice (cs-t1) hit You for ${amount} kinetic`,
      salience: 'mine-in',
      dmgAmount: amount,
      sourceLabel: 'ice (cs-t1)',
      targetLabel: 'You',
      npcSource: 'ICE',
    })
  const heroHit = line({
    cycle: 19,
    text: 'Socket hit You for 60 kinetic',
    salience: 'mine-in',
    dmgAmount: 60,
    sourceLabel: 'Socket',
    targetLabel: 'You',
  })

  it('classifies NPC source ids and leaves heroes alone', () => {
    expect(
      ['wave_3', 'neutral_1', 'ice_cs-t1', 'tenant', 'terminal_audit'].map(isNpcSourceId),
    ).toEqual([true, true, true, true, true])
    expect(isNpcSourceId('bot_alpha')).toBe(false)
    expect(isNpcSourceId('github_1')).toBe(false)
  })

  it('folds four wave hits into one line with the total', () => {
    const out = digestNpcHitsOnMe([waveHit(19), waveHit(19), waveHit(19), waveHit(29)])
    expect(out).toHaveLength(1)
    expect(out[0]!.text).toBe('Waves hit You ×4 for 86')
    expect(out[0]!.dmgAmount).toBe(86)
    expect(out[0]!.salience).toBe('mine-in')
  })

  it('breaks a mixed fold down by source and keeps hero hits individual', () => {
    const out = digestNpcHitsOnMe([waveHit(19), heroHit, waveHit(19), iceHit(48)])
    expect(out.map((l) => l.text)).toEqual([
      'NPCs hit You ×3 for 86 (waves ×2: 38, ICE ×1: 48)',
      'Socket hit You for 60 kinetic',
    ])
  })

  it('leaves a lone NPC hit as it is and never folds across cycles', () => {
    const out = digestNpcHitsOnMe([waveHit(19, 18), waveHit(19, 19)])
    expect(out.map((l) => l.text)).toEqual([
      'a wave hit You for 19 kinetic',
      'a wave hit You for 19 kinetic',
    ])
  })

  it('is part of the story view', () => {
    const out = buildTickStoryView([waveHit(19), waveHit(19), waveHit(19), waveHit(29)])
    expect(out.filter((l) => l.salience === 'mine-in')).toHaveLength(1)
  })
})

describe('recapClausesFor — the recap never restates the beat', () => {
  const recaps = (lines: CombatLine[]) => buildTickRecaps(lines).get(1)

  it('drops a clause that restates the beat’s one line', () => {
    const hit = line({
      text: 'Socket hit You for 60',
      salience: 'mine-in',
      dmgAmount: 60,
      sourceLabel: 'Socket',
    })
    expect(recapClausesFor(recaps([hit]), [hit]).takenText).toBeNull()
  })

  it('keeps a clause that sums several shown lines', () => {
    const a = line({ text: 'a', salience: 'mine-in', dmgAmount: 60, sourceLabel: 'Socket' })
    const b = line({ text: 'b', salience: 'mine-in', dmgAmount: 45, sourceLabel: 'Sentry' })
    expect(recapClausesFor(recaps([a, b]), [a, b]).takenText).toBe(
      'You took 105 (Socket 60, Sentry 45)',
    )
  })

  it('drops the clause over a folded NPC line that already carries the total', () => {
    const raw = [19, 19, 19, 29].map((amount) =>
      line({
        text: 'a wave hit You',
        salience: 'mine-in',
        dmgAmount: amount,
        sourceLabel: 'a wave',
        npcSource: 'waves',
      }),
    )
    expect(recapClausesFor(recaps(raw), digestNpcHitsOnMe(raw)).takenText).toBeNull()
  })

  it('keeps the clause when a filter hid the lines it summed', () => {
    const hit = line({ text: 'x', salience: 'mine-in', dmgAmount: 60, sourceLabel: 'Socket' })
    expect(recapClausesFor(recaps([hit]), []).takenText).toBe('You took 60 from Socket')
  })
})
