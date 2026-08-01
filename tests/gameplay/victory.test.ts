import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN } from './harness'
import { ZONES } from '~~/shared/constants/zones'
import type { GameState, TeamId } from '~~/shared/types/game'

/**
 * The win condition, walked end to end.
 *
 * Everything else in these suites tests a slice. This tests the one sequence
 * that has to work for a match to be a match: T1 falls, then T2, then T3, the
 * enemy Terminal stops being firewalled, and killing it ends the game with the
 * right winner.
 *
 * It is also the sequence most exposed to a rename. `isTerminalVulnerable` used
 * to decide "is any of their T3 down" by matching `'-t3-'` inside a zone id,
 * which put the win condition itself on the naming scheme; the ICE-exposure
 * rule parsed the route out of an id and rebuilt the preceding zone's id from
 * parts. Both are now record-driven, and this is the test that would notice if
 * either regressed — a game that cannot be won still ticks along happily.
 */

/** The ICE chain for one route on one team, ordered T1 → T2 → T3. */
function iceChain(team: TeamId, lane: string): string[] {
  return [1, 2, 3].map(
    (tier) => ZONES.find((z) => z.lane === lane && z.tier === tier && z.team === team)!.id,
  )
}

/** Kill one ICE outright. */
function razeIce(state: GameState, zone: string): GameState {
  return {
    ...state,
    ice: state.ice.map((t) => (t.zone === zone ? { ...t, alive: false, integ: 0 } : t)),
  }
}

describe('a match can be won', () => {
  it('the enemy Terminal is firewalled while all their T3 ICE stands', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me = await game.me()
    const enemy: TeamId = me.team === 'chaff' ? 'audit' : 'chaff'
    await game.tick()
    const state = await game.state()
    expect(state.terminals[enemy].vulnerable).toBe(false)
    expect(state.terminals[enemy].alive).toBe(true)
  })

  it('razing any one enemy T3 lifts the firewall — and only then', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me = await game.me()
    const enemy: TeamId = me.team === 'chaff' ? 'audit' : 'chaff'
    const lane = ZONES.find((z) => z.lane)!.lane!
    const [t1, t2, t3] = iceChain(enemy, lane)

    // T1 and T2 down is not enough — the Terminal only opens on a T3.
    await game.patch((s) => razeIce(razeIce(s, t1!), t2!))
    await game.tick()
    expect((await game.state()).terminals[enemy].vulnerable).toBe(false)

    await game.patch((s) => razeIce(s, t3!))
    await game.tick()
    expect((await game.state()).terminals[enemy].vulnerable).toBe(true)
  })

  it('the ICE chain must be razed in order — T2 is protected while T1 stands', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me = await game.me()
    const enemy: TeamId = me.team === 'chaff' ? 'audit' : 'chaff'
    const lane = ZONES.find((z) => z.lane)!.lane!
    const [t1, t2] = iceChain(enemy, lane)

    // Stand at the T2 with its T1 still alive and swing: backdoor protection holds.
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: t2! } },
      ice: s.ice.map((t) => (t.zone === t1! || t.zone === t2! ? { ...t, alive: true } : t)),
    }))
    game.submit({ type: 'attack', target: { kind: 'ice', zone: t2! } })
    await game.tick()

    const protectedReason = game.lastRejected.find((r) => r.playerId === HUMAN)?.reason ?? ''
    expect(protectedReason, 'attacking a protected T2 said nothing').toMatch(/\S/)
    expect((await game.state()).ice.find((t) => t.zone === t2!)!.alive).toBe(true)
  })

  it('killing the exposed Terminal ends the game for the other side', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me = await game.me()
    const mine: TeamId = me.team
    const enemy: TeamId = mine === 'chaff' ? 'audit' : 'chaff'
    const enemyBase = ZONES.find((z) => z.type === 'base' && z.team === enemy)!

    // Their whole route razed, hero standing in their base, Terminal on its last
    // sliver so one swing finishes it.
    const lane = ZONES.find((z) => z.lane)!.lane!
    await game.patch((s) => {
      let next = s
      for (const zone of iceChain(enemy, lane)) next = razeIce(next, zone)
      return {
        ...next,
        players: { ...next.players, [HUMAN]: { ...next.players[HUMAN]!, zone: enemyBase.id } },
        terminals: {
          ...next.terminals,
          [enemy]: { ...next.terminals[enemy], integ: 1, vulnerable: true },
        },
      }
    })

    game.submit({ type: 'attack', target: { kind: 'terminal' } })
    await game.tick()

    const state = await game.state()
    expect(state.terminals[enemy].alive, 'the Terminal survived a lethal hit').toBe(false)
    expect(state.winner, 'destroying the enemy Terminal did not win the game').toBe(mine)
    expect(state.phase).toBe('ended')
  })

  it('a firewalled Terminal refuses the hit and says why', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me = await game.me()
    const enemy: TeamId = me.team === 'chaff' ? 'audit' : 'chaff'
    const enemyBase = ZONES.find((z) => z.type === 'base' && z.team === enemy)!

    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: enemyBase.id } },
    }))
    game.submit({ type: 'attack', target: { kind: 'terminal' } })
    await game.tick()

    const reason = game.lastRejected.find((r) => r.playerId === HUMAN)?.reason ?? ''
    expect(reason, 'a firewalled Terminal was refused in silence').toMatch(/firewall/i)
    expect((await game.state()).winner).toBeFalsy()
  })

  it('neither Terminal is vulnerable at the start of a fresh game', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const state = await game.state()
    for (const team of ['chaff', 'audit'] as TeamId[]) {
      expect(state.terminals[team].vulnerable, `${team} starts exposed`).toBe(false)
      expect(state.terminals[team].alive).toBe(true)
      expect(state.terminals[team].integ).toBeGreaterThan(0)
    }
    expect(state.winner).toBeFalsy()
  })
})
