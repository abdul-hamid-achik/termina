import { describe, it, expect, beforeEach } from 'vitest'
import type { BuffState, GameState, PlayerState } from '~~/shared/types/game'
import { seedGame, ENEMY, HUMAN, type Run } from './harness'
import { resetWaveIdCounter } from '~~/server/game/map/spawner'

/**
 * THE BATCH CLOCK IS CANON: every hero basic attack in a cycle is computed
 * against the attack phase's opening snapshot and lands together. Arrival order
 * must not decide crits, procs, shields, dodges, reflects or kill credit — so
 * each scenario is run twice with the submit order swapped and the resulting
 * players compared deep-equal.
 *
 * Kill credit when several basic attacks land on the same victim in the same
 * cycle: the hero who dealt the most damage to that victim this cycle, ties
 * broken by sorted player id.
 *
 * Every scenario settles one tick, then runs at cycle 211 at level 10, with
 * a fixed rngSeed so both orders draw from the same stream.
 */

const ALLY = 'ally'
const ENEMY2 = 'enemy2'

beforeEach(() => {
  resetWaveIdCounter()
})

type Overrides = Partial<Record<string, Partial<PlayerState>>>

async function brawl(
  orders: Array<[attacker: string, target: string]>,
  overrides: Overrides,
  seed = 777,
): Promise<Run> {
  resetWaveIdCounter()
  const game = await seedGame('laning_combat', {
    players: [
      { id: HUMAN, name: HUMAN, team: 'chaff', heroId: 'kernel' },
      { id: ALLY, name: ALLY, team: 'chaff', heroId: 'kernel' },
      { id: ENEMY, name: ENEMY, team: 'audit', heroId: 'echo' },
      { id: ENEMY2, name: ENEMY2, team: 'audit', heroId: 'echo' },
    ],
  })
  await game.tick()
  await game.patch((s) => {
    const zone = s.players[HUMAN]!.zone
    const players: GameState['players'] = {}
    for (const [id, p] of Object.entries(s.players)) {
      players[id] = { ...p, zone, level: 10, buffs: [], integ: p.maxInteg, ...overrides[id] }
    }
    return { ...s, cycle: 211, rngSeed: seed, players }
  })
  for (const [attacker, target] of orders) game.attackHero(target, attacker)
  await game.tick()
  return game
}

/** Run the same cycle under both submit orders; return both outcomes. */
async function bothOrders(
  orders: Array<[string, string]>,
  overrides: Overrides,
  seed?: number,
): Promise<[Run, Run]> {
  const a = await brawl(orders, overrides, seed)
  const b = await brawl([...orders].reverse(), overrides, seed)
  return [a, b]
}

async function players(run: Run) {
  return (await run.state()).players
}

const buff = (id: string, stacks: number, source: string, cycles = 5): BuffState => ({
  id,
  stacks,
  cyclesRemaining: cycles,
  source,
})

describe('simultaneous hero basic attacks', () => {
  it('two heroes can kill each other in the same cycle', async () => {
    const [a, b] = await bothOrders(
      [
        [HUMAN, ENEMY],
        [ENEMY, HUMAN],
      ],
      { [HUMAN]: { integ: 5 }, [ENEMY]: { integ: 5 } },
    )
    for (const run of [a, b]) {
      const ps = await players(run)
      expect(ps[HUMAN]!.alive).toBe(false)
      expect(ps[ENEMY]!.alive).toBe(false)
      expect(ps[HUMAN]!.kills).toBe(1)
      expect(ps[ENEMY]!.kills).toBe(1)
    }
    expect(await players(a)).toEqual(await players(b))
  })

  it('a double kill on one victim credits the bigger hitter under either order', async () => {
    const [a, b] = await bothOrders(
      [
        [HUMAN, ENEMY],
        [ALLY, ENEMY],
      ],
      {
        [HUMAN]: { buffs: [buff('forkAtk', 40, HUMAN)] },
        [ENEMY]: { integ: 10 },
      },
    )
    for (const run of [a, b]) {
      const kill = run.lastEvents.find((e) => e._tag === 'kill' && e.victimId === ENEMY)
      expect(kill && kill._tag === 'kill' ? kill.killerId : null).toBe(HUMAN)
    }
    expect(await players(a)).toEqual(await players(b))
  })

  it('equal hitters: the kill goes to the sorted-first id under either order', async () => {
    const [a, b] = await bothOrders(
      [
        [HUMAN, ENEMY],
        [ALLY, ENEMY],
      ],
      { [ENEMY]: { integ: 10 } },
    )
    for (const run of [a, b]) {
      const kill = run.lastEvents.find((e) => e._tag === 'kill' && e.victimId === ENEMY)
      expect(kill && kill._tag === 'kill' ? kill.killerId : null).toBe(ALLY)
    }
  })

  it('a shield absorbs the summed volley; Spite Plate reflects both hitters the same either way', async () => {
    const [a, b] = await bothOrders(
      [
        [HUMAN, ENEMY],
        [ALLY, ENEMY],
      ],
      {
        [ENEMY]: { buffs: [buff('shield', 60, ENEMY), buff('spite_plate', 1, ENEMY)] },
      },
    )
    const pa = await players(a)
    expect(pa).toEqual(await players(b))
    // The shield is spent and both attackers took reflect (neither swing was
    // "the one the shield ate").
    expect(pa[ENEMY]!.buffs.some((x) => x.id === 'shield')).toBe(false)
    for (const id of [HUMAN, ALLY]) {
      expect(
        a.lastEvents.some(
          (e) => e._tag === 'damage' && e.sourceId === ENEMY && e.targetId === id && e.amount > 0,
        ),
      ).toBe(true)
    }
  })

  it('phaseShift dodges exactly one swing — the biggest — under either order', async () => {
    const [a, b] = await bothOrders(
      [
        [HUMAN, ENEMY],
        [ALLY, ENEMY],
      ],
      {
        [HUMAN]: { buffs: [buff('forkAtk', 40, HUMAN)] },
        [ENEMY]: { buffs: [buff('phaseShift', 1, ENEMY, 1)] },
      },
    )
    expect(await players(a)).toEqual(await players(b))
    for (const run of [a, b]) {
      const landed = run.lastEvents.filter(
        (e) => e._tag === 'damage' && e.targetId === ENEMY && e.damageType !== 'black',
      )
      expect(landed.map((e) => (e._tag === 'damage' ? e.sourceId : ''))).toEqual([ALLY])
    }
  })

  it('crits and on-hit procs resolve identically under swapped order (many seeds)', async () => {
    const procItems = ['null_pointer', 'arc_coil', 'concussion_hammer', null, null, null]
    for (let seed = 1; seed <= 15; seed++) {
      const [a, b] = await bothOrders(
        [
          [HUMAN, ENEMY],
          [ALLY, ENEMY],
        ],
        {
          [HUMAN]: { items: procItems },
          [ALLY]: { items: procItems },
          [ENEMY]: { items: ['bulwark_plate', null, null, null, null, null] },
        },
        seed,
      )
      expect(await players(a), `seed ${seed}`).toEqual(await players(b))
    }
  })
})
