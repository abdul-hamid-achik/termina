import { describe, it, expect, beforeEach } from 'vitest'
import type { GameState, PlayerState } from '~~/shared/types/game'
import { seedGame, ENEMY, HUMAN, type Run } from './harness'
import { resetWaveIdCounter } from '~~/server/game/map/spawner'
import { compareCodePoints } from '~~/server/game/engine/rng'

/**
 * THE BATCH CLOCK IS CANON: "the city commits every instruction at once, four
 * seconds wide, in no order". Nothing about a cycle's outcome may depend on the
 * order players were inserted into the state map (chaff is usually first —
 * any key-order dependence is a side bias) or on the order orders arrived.
 *
 * Every scenario settles one tick, then runs at cycle 211 at level 10 with a
 * fixed rngSeed, so both orderings draw from the same stream.
 */

beforeEach(() => {
  resetWaveIdCounter()
})

type Overrides = Partial<Record<string, Partial<PlayerState>>>

/** Seed a 1v1 in one zone; optionally rebuild `players` in REVERSED key order. */
async function duel(
  hero: 'kernel' | 'echo',
  overrides: Overrides,
  reverseKeys = false,
  seed = 5,
): Promise<Run> {
  resetWaveIdCounter()
  const game = await seedGame('laning_combat', {
    players: [
      { id: HUMAN, name: HUMAN, team: 'chaff', heroId: hero },
      { id: ENEMY, name: ENEMY, team: 'audit', heroId: hero },
    ],
  })
  await game.tick()
  await game.patch((s) => {
    const zone = s.players[HUMAN]!.zone
    const ids = Object.keys(s.players)
    if (reverseKeys) ids.reverse()
    const players: GameState['players'] = {}
    for (const id of ids) {
      const p = s.players[id]!
      players[id] = {
        ...p,
        zone,
        level: 10,
        buffs: [],
        bw: p.maxBw,
        cooldowns: { q: 0, w: 0, e: 0, r: 0 },
        scrip: 1000,
        ...overrides[id],
      } as PlayerState
    }
    return { ...s, cycle: 211, rngSeed: seed, players }
  })
  return game
}

async function playersOf(run: Run) {
  return (await run.state()).players
}

describe('mutual kill: kill credit does not depend on player-map key order', () => {
  for (const streaks of [
    { [HUMAN]: 0, [ENEMY]: 0 },
    { [HUMAN]: 3, [ENEMY]: 0 },
  ]) {
    it(`swing-for-swing kill (streaks ${streaks[HUMAN]}/${streaks[ENEMY]}) pays the same either key order`, async () => {
      const outcomes = []
      for (const reverse of [false, true]) {
        const game = await duel(
          'kernel',
          {
            [HUMAN]: { integ: 5, killStreak: streaks[HUMAN] },
            [ENEMY]: { integ: 5, killStreak: streaks[ENEMY] },
          },
          reverse,
        )
        game.attackHero(ENEMY, HUMAN)
        game.attackHero(HUMAN, ENEMY)
        await game.tick()
        const ps = await playersOf(game)
        expect(Object.keys(ps)[0]).toBe(reverse ? ENEMY : HUMAN)
        expect(ps[HUMAN]!.alive).toBe(false)
        expect(ps[ENEMY]!.alive).toBe(false)
        // Both died this cycle: neither carries a streak out of it.
        expect(ps[HUMAN]!.killStreak).toBe(0)
        expect(ps[ENEMY]!.killStreak).toBe(0)
        const kills = game.lastEvents.filter((e) => e._tag === 'kill')
        const byVictim = Object.fromEntries(
          kills.map((k) => [k._tag === 'kill' ? k.victimId : '', k]),
        )
        // The victim streak is the one each carried INTO the cycle.
        expect(byVictim[HUMAN]).toMatchObject({ victimStreak: streaks[HUMAN] })
        expect(byVictim[ENEMY]).toMatchObject({ victimStreak: streaks[ENEMY] })
        outcomes.push(ps)
      }
      expect(outcomes[0]).toEqual(outcomes[1])
      // A fed victim pays the bigger shutdown — the killer of the streaker earns more.
      if (streaks[HUMAN] > 0) {
        expect(outcomes[0]![ENEMY]!.scrip).toBeGreaterThan(outcomes[0]![HUMAN]!.scrip)
      } else {
        expect(outcomes[0]![ENEMY]!.scrip).toBe(outcomes[0]![HUMAN]!.scrip)
      }
    })
  }

  it('a mutual kill between two Last Word holders keeps one each, either key order', async () => {
    const outcomes = []
    for (const reverse of [false, true]) {
      const full = ['last_word', 'edge_kit', 'edge_kit', 'edge_kit', 'edge_kit', 'edge_kit']
      const game = await duel(
        'kernel',
        {
          [HUMAN]: { integ: 5, items: [...full] },
          [ENEMY]: { integ: 5, items: ['last_word', null, null, null, null, null] },
        },
        reverse,
      )
      game.attackHero(ENEMY, HUMAN)
      game.attackHero(HUMAN, ENEMY)
      await game.tick()
      const ps = await playersOf(game)
      for (const id of [HUMAN, ENEMY]) {
        expect(ps[id]!.items.filter((i) => i === 'last_word')).toHaveLength(1)
      }
      outcomes.push(ps)
    }
    expect(outcomes[0]).toEqual(outcomes[1])
  })
})

const breached = (source: string) => ({
  id: 'breached',
  stacks: 1,
  cyclesRemaining: 5,
  source,
})

describe('casts are committed when their phase opens', () => {
  type Order = (g: Run) => void
  const qAt =
    (target: string, as: string): Order =>
    (g) => {
      g.cast('q', { kind: 'hero', name: target }, as)
    }
  const swingAt =
    (target: string, as: string): Order =>
    (g) => {
      g.attackHero(target, as)
    }

  async function bothSubmitOrders(
    hero: 'kernel' | 'echo',
    overrides: Overrides,
    orders: [Order, Order],
  ): Promise<[Run, Run]> {
    const out: Run[] = []
    for (const seq of [orders, [...orders].reverse()]) {
      const game = await duel(hero, overrides)
      for (const o of seq) o(game)
      await game.tick()
      out.push(game)
    }
    return [out[0]!, out[1]!]
  }

  it('two echoes trade lethal Q: both drop, under either submit order', async () => {
    const [a, b] = await bothSubmitOrders(
      'echo',
      { [HUMAN]: { integ: 20 }, [ENEMY]: { integ: 20 } },
      [qAt(ENEMY, HUMAN), qAt(HUMAN, ENEMY)],
    )
    for (const run of [a, b]) {
      const ps = await playersOf(run)
      expect(ps[HUMAN]!.alive).toBe(false)
      expect(ps[ENEMY]!.alive).toBe(false)
      expect(run.lastRejected).toEqual([])
      // The fallen caster paid for the cast like anyone else.
      expect(ps[HUMAN]!.cooldowns.q).toBeGreaterThan(0)
      expect(ps[ENEMY]!.cooldowns.q).toBeGreaterThan(0)
    }
    expect(await playersOf(a)).toEqual(await playersOf(b))
  })

  it('a swing and a lethal Q cross: both land', async () => {
    const [a, b] = await bothSubmitOrders(
      'echo',
      { [HUMAN]: { integ: 20 }, [ENEMY]: { integ: 20 } },
      [swingAt(ENEMY, HUMAN), qAt(HUMAN, ENEMY)],
    )
    for (const run of [a, b]) {
      const ps = await playersOf(run)
      expect(ps[HUMAN]!.alive).toBe(false)
      expect(ps[ENEMY]!.alive).toBe(false)
    }
    expect(await playersOf(a)).toEqual(await playersOf(b))
  })

  it('two kernels stun each other in the same cycle: both stuns land', async () => {
    const [a, b] = await bothSubmitOrders(
      'kernel',
      { [HUMAN]: { buffs: [breached(ENEMY)] }, [ENEMY]: { buffs: [breached(HUMAN)] } },
      [qAt(ENEMY, HUMAN), qAt(HUMAN, ENEMY)],
    )
    for (const run of [a, b]) {
      const ps = await playersOf(run)
      expect(run.lastRejected).toEqual([])
      expect(ps[HUMAN]!.buffs.some((x) => x.id === 'stun')).toBe(true)
      expect(ps[ENEMY]!.buffs.some((x) => x.id === 'stun')).toBe(true)
    }
    expect(await playersOf(a)).toEqual(await playersOf(b))
  })

  it('two casts at one victim resolve in player-id order, not arrival order', async () => {
    const ALLY = 'ally'
    const runs: Run[] = []
    for (const allyFirst of [true, false]) {
      resetWaveIdCounter()
      const game = await seedGame('laning_combat', {
        players: [
          { id: HUMAN, name: HUMAN, team: 'chaff', heroId: 'echo' },
          { id: ALLY, name: ALLY, team: 'chaff', heroId: 'echo' },
          { id: ENEMY, name: ENEMY, team: 'audit', heroId: 'echo' },
        ],
      })
      await game.tick()
      await game.patch((s) => {
        const zone = s.players[HUMAN]!.zone
        const players: GameState['players'] = {}
        for (const [id, p] of Object.entries(s.players)) {
          players[id] = {
            ...p,
            zone,
            level: 10,
            buffs: [],
            bw: p.maxBw,
            cooldowns: { q: 0, w: 0, e: 0, r: 0 },
            ...(id === ENEMY ? { integ: 20 } : {}),
          }
        }
        return { ...s, cycle: 211, rngSeed: 9, players }
      })
      const order = allyFirst ? [ALLY, HUMAN] : [HUMAN, ALLY]
      for (const id of order) game.cast('q', { kind: 'hero', name: ENEMY }, id)
      await game.tick()
      runs.push(game)
    }
    const [a, b] = runs as [Run, Run]
    for (const run of [a, b]) {
      const kill = run.lastEvents.find((e) => e._tag === 'kill')
      // 'ally' sorts before 'human': the ally's Q resolves first and drops them.
      expect(kill && kill._tag === 'kill' ? kill.killerId : null).toBe(ALLY)
    }
    expect(await playersOf(a)).toEqual(await playersOf(b))
  })

  it('a fallen caster does not heal or move out of the grave', async () => {
    const game = await duel('echo', { [HUMAN]: { integ: 20 }, [ENEMY]: { integ: 20 } })
    const zone = (await game.me()).zone
    game.cast('q', { kind: 'hero', name: ENEMY }, HUMAN)
    game.cast('q', { kind: 'hero', name: HUMAN }, ENEMY)
    await game.tick()
    const ps = await playersOf(game)
    for (const id of [HUMAN, ENEMY]) {
      expect(ps[id]!.integ).toBe(0)
      expect(ps[id]!.zone).toBe(zone)
    }
    expect(game.lastEvents.filter((e) => e._tag === 'heal')).toEqual([])
  })
})

describe('breach is committed only by a hero standing when the breach phase opens', () => {
  // The breach phase opens BEFORE movement (owner decision), so a swing that
  // drops the caster later the same cycle comes too late to stop it. Only a
  // phase-0 item kill beats it — see breachTiming.test.ts.
  it('a hero dropped by a swing LATER this cycle has already breached', async () => {
    const game = await duel('kernel', { [HUMAN]: { integ: 5 } })
    game.submit({ type: 'breach', target: { kind: 'hero', name: ENEMY } }, HUMAN)
    game.attackHero(HUMAN, ENEMY)
    await game.tick()
    const ps = await playersOf(game)
    expect(ps[HUMAN]!.alive).toBe(false)
    expect(ps[ENEMY]!.buffs.some((b) => b.id === 'breached' && b.source === HUMAN)).toBe(true)
    expect(game.lastEvents.some((e) => e._tag === 'breach_opened')).toBe(true)
    expect(game.lastRejected.filter((r) => r.playerId === HUMAN)).toEqual([])
  })

  it('a standing hero still breaches', async () => {
    const game = await duel('kernel', {})
    game.submit({ type: 'breach', target: { kind: 'hero', name: ENEMY } }, HUMAN)
    await game.tick()
    expect((await game.player(ENEMY)).buffs.some((b) => b.id === 'breached')).toBe(true)
  })
})

describe('compareCodePoints', () => {
  it('orders by code unit, never by locale collation', () => {
    // localeCompare puts lower-case "a" before upper-case "Z"; code-unit order
    // does not — and must not depend on the host's ICU locale.
    expect(compareCodePoints('Z', 'a')).toBeLessThan(0)
    expect(['bot_r1', 'Bot_d0', 'bot_d0'].sort(compareCodePoints)).toEqual([
      'Bot_d0',
      'bot_d0',
      'bot_r1',
    ])
    expect(compareCodePoints('x', 'x')).toBe(0)
  })
})
