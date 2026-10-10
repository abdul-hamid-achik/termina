import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN, ENEMY } from './harness'
import { ZONES } from '~~/shared/constants/zones'
import type { GameState } from '~~/shared/types/game'

/**
 * The Terminal opens the cycle its last firewall falls, not a cycle later.
 *
 * `terminal.vulnerable` is recomputed at GameLoop step 5.7, AFTER the hero
 * actions, so a swing at the Terminal in the same cycle a T3 went down used to
 * read the stale flag and bounce off ("firewalled") even though the ICE was
 * already dead in the very state it was resolved against.
 */
const AUDIT_T3 = ZONES.filter((z) => z.team === 'audit' && z.tier === 3)
const T3 = AUDIT_T3[0]!.id
const TERMINAL = 'landing-terminal'

async function seed(order: 'ice-first' | 'terminal-first') {
  const game = await seedGame('laning_combat', {
    players: [
      { id: HUMAN, name: HUMAN, team: 'chaff', heroId: 'echo' },
      { id: 'mate', name: 'mate', team: 'chaff', heroId: 'echo' },
      { id: ENEMY, name: ENEMY, team: 'audit', heroId: 'daemon' },
    ],
  })
  await game.patch((s: GameState) => {
    const lane = AUDIT_T3[0]!.lane
    return {
      ...s,
      ice: s.ice.map((t) => {
        const z = ZONES.find((zz) => zz.id === t.zone)!
        // The chain in front of this T3 is already down; every OTHER T3 stands.
        if (z.team === 'audit' && z.lane === lane && z.tier < 3)
          return { ...t, alive: false, integ: 0 }
        if (t.zone === T3) return { ...t, alive: true, integ: 1 }
        return t
      }),
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, zone: T3, alive: true },
        mate: { ...s.players['mate']!, zone: TERMINAL, alive: true },
        [ENEMY]: { ...s.players[ENEMY]!, zone: 'rookery-anchor', alive: true },
      },
    }
  })
  const pre = await game.state()
  expect(pre.terminals.audit.vulnerable).toBe(false)
  const ice = { type: 'attack', target: { kind: 'ice', zone: T3 } } as const
  const term = { type: 'attack', target: { kind: 'terminal' } } as const
  if (order === 'ice-first') {
    game.submit(ice, HUMAN)
    game.submit(term, 'mate')
  } else {
    game.submit(term, 'mate')
    game.submit(ice, HUMAN)
  }
  return { game, pre }
}

describe.each(['ice-first', 'terminal-first'] as const)(
  'Terminal swing the cycle the last T3 falls (%s)',
  (order) => {
    it('lands, whichever order the two orders arrived in', async () => {
      const { game, pre } = await seed(order)
      await game.tick()
      const s = await game.state()
      expect(s.ice.find((t) => t.zone === T3)!.alive).toBe(false)
      expect(game.lastRejected.filter((r) => r.playerId === 'mate')).toEqual([])
      expect(s.terminals.audit.integ).toBeLessThan(pre.terminals.audit.integ)
      expect(s.terminals.audit.vulnerable).toBe(true)
    })
  },
)

describe('Terminal swing while every T3 stands', () => {
  it('is still refused with the firewall reason', async () => {
    const { game } = await seed('ice-first')
    await game.patch((s) => ({
      ...s,
      ice: s.ice.map((t) => (t.zone === T3 ? { ...t, integ: 99999 } : t)),
    }))
    await game.tick()
    const rej = game.lastRejected.filter((r) => r.playerId === 'mate')
    expect(rej).toHaveLength(1)
    expect(rej[0]!.reason).toMatch(/firewalled/)
  })
})

describe('both Terminals fall in the same cycle', () => {
  // No draw exists (game_over / MMR / the matches row all need a winner), so the
  // Terminal that held more INTEG when the cycle opened wins — whichever side.
  for (const [chaffOpen, auditOpen, winner] of [
    [3, 1, 'chaff'],
    [1, 3, 'audit'],
  ] as const) {
    it(`chaff ${chaffOpen} / audit ${auditOpen} at cycle open → ${winner}`, async () => {
      const game = await seedGame('laning_combat', {
        players: [
          { id: HUMAN, name: HUMAN, team: 'chaff', heroId: 'kernel' },
          { id: ENEMY, name: ENEMY, team: 'audit', heroId: 'kernel' },
        ],
      })
      await game.tick()
      await game.patch((s: GameState) => ({
        ...s,
        cycle: 333,
        // One seed for both cases, so the coin cannot decide them both ways.
        rngSeed: 42,
        // Every T3 down on both sides: both Terminals open.
        ice: s.ice.map((t) =>
          ZONES.find((z) => z.id === t.zone)?.tier === 3 ? { ...t, alive: false, integ: 0 } : t,
        ),
        terminals: {
          chaff: { ...s.terminals.chaff, integ: chaffOpen, vulnerable: true },
          audit: { ...s.terminals.audit, integ: auditOpen, vulnerable: true },
        },
        players: {
          ...s.players,
          [HUMAN]: { ...s.players[HUMAN]!, zone: 'landing-terminal', level: 10 },
          [ENEMY]: { ...s.players[ENEMY]!, zone: 'rookery-terminal', level: 10 },
        },
      }))
      game.submit({ type: 'attack', target: { kind: 'terminal' } }, HUMAN)
      game.submit({ type: 'attack', target: { kind: 'terminal' } }, ENEMY)
      await game.tick()
      const s = await game.state()
      expect(s.terminals.chaff.alive).toBe(false)
      expect(s.terminals.audit.alive).toBe(false)
      expect(s.phase).toBe('ended')
      expect(s.winner).toBe(winner)
    })
  }
})
