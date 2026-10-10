import { describe, it, expect, beforeEach } from 'vitest'
import type { GameState, PlayerState } from '~~/shared/types/game'
import type { Command } from '~~/shared/types/commands'
import { seedGame, ENEMY, HUMAN, type Run } from './harness'
import { resetWaveIdCounter } from '~~/server/game/map/spawner'
import { ZONE_MAP } from '~~/shared/constants/zones'
import { BREACH_DURATION_CYCLES } from '~~/shared/constants/balance'

/**
 * OWNER DECISION — BREACH RESOLVES BEFORE MOVEMENT. A breach is committed at
 * the top of the cycle (right after item actives, before the instant casts and
 * movement): when the target stood in the caster's zone at the START of the
 * cycle and the breach is still legal when its step opens (both alive, target
 * not AIRGAPPED, caster has the BW), it opens — even if the target walks or
 * blinks out this same cycle. It used to resolve after the shop, so a target
 * that stepped away made it fail ("left your zone before your breach landed").
 *
 * Same-cycle semantics: everything that resolves LATER in the cycle sees the
 * opening (an ally's code cast lands in full, not halved). The breacher's own follow-up is
 * still next cycle — one order per cycle.
 *
 * Every scenario settles one tick, then runs at cycle 173 at level 9 with a
 * fixed rngSeed.
 */

beforeEach(() => {
  resetWaveIdCounter()
})

const ALLY = 'ally'
const isOpenBy = (p: PlayerState, source: string) =>
  p.buffs.some((b) => b.id === 'breached' && b.source === source && b.cyclesRemaining > 0)

/** Seed a duel in one zone (optionally with a chaff ally); optionally reversed key order. */
async function duel(
  overrides: Partial<Record<string, Partial<PlayerState>>> = {},
  opts: { ally?: boolean; reverseKeys?: boolean; enemyHero?: 'echo' | 'lambda' } = {},
): Promise<Run> {
  resetWaveIdCounter()
  const game = await seedGame('laning_combat', {
    players: [
      { id: HUMAN, name: HUMAN, team: 'chaff', heroId: 'kernel' },
      ...(opts.ally
        ? [{ id: ALLY, name: ALLY, team: 'chaff' as const, heroId: 'lambda' as const }]
        : []),
      { id: ENEMY, name: ENEMY, team: 'audit', heroId: opts.enemyHero ?? 'echo' },
    ],
  })
  await game.tick()
  await game.patch((s) => {
    const zone = s.players[HUMAN]!.zone
    const ids = Object.keys(s.players)
    if (opts.reverseKeys) ids.reverse()
    const players: GameState['players'] = {}
    for (const id of ids) {
      const p = s.players[id]!
      players[id] = {
        ...p,
        zone,
        level: 9,
        buffs: [],
        integ: p.maxInteg,
        bw: p.maxBw,
        cooldowns: { q: 0, w: 0, e: 0, r: 0 },
        moveTarget: null,
        attackTarget: null,
        ...overrides[id],
      } as PlayerState
    }
    return { ...s, cycle: 173, rngSeed: 9091, players }
  })
  return game
}

/** A zone adjacent to where the duel stands (not a shop/fountain). */
async function neighbour(game: Run): Promise<string> {
  const zone = (await game.me()).zone
  return ZONE_MAP[zone]!.adjacentTo[0]!
}

const breach = (name: string): Command => ({ type: 'breach', target: { kind: 'hero', name } })

describe('breach resolves before movement', () => {
  it('a target that walks out of the zone this cycle is still breached', async () => {
    const game = await duel()
    const away = await neighbour(game)
    game.submit(breach(ENEMY), HUMAN)
    game.submit({ type: 'move', zone: away }, ENEMY)
    await game.tick()

    const enemy = await game.player(ENEMY)
    expect(enemy.zone).toBe(away)
    expect(isOpenBy(enemy, HUMAN)).toBe(true)
    expect(game.lastRejected.filter((r) => r.playerId === HUMAN)).toEqual([])
    expect(game.lastEvents.find((e) => e._tag === 'breach_opened')).toMatchObject({
      playerId: HUMAN,
      targetId: ENEMY,
      durationCycles: BREACH_DURATION_CYCLES,
    })
    const me = await game.me()
    expect(me.buffs.some((b) => b.id === 'item_cd_breach' && b.cyclesRemaining > 0)).toBe(true)
  })

  it('a target that blinks out with an item active this cycle is still breached', async () => {
    const game = await duel({ [ENEMY]: { items: ['jump_shunt', null, null, null, null, null] } })
    const away = await neighbour(game)
    game.submit(breach(ENEMY), HUMAN)
    game.submit({ type: 'use', item: 'jump_shunt', target: away }, ENEMY)
    await game.tick()

    const enemy = await game.player(ENEMY)
    expect(enemy.zone).toBe(away)
    expect(isOpenBy(enemy, HUMAN)).toBe(true)
  })

  it('a caster who walks away the same cycle has no say — only one order: the breach', async () => {
    // The caster's own breach and the caster's cycle-start zone are what count.
    const game = await duel()
    game.submit(breach(ENEMY), HUMAN)
    await game.tick()
    expect(isOpenBy(await game.player(ENEMY), HUMAN)).toBe(true)
  })

  it('submission order does not change the outcome (breach-then-move vs move-then-breach)', async () => {
    const outcomes: string[] = []
    for (const order of ['breachFirst', 'moveFirst'] as const) {
      const game = await duel()
      const away = await neighbour(game)
      const orders: Array<[Command, string]> = [
        [breach(ENEMY), HUMAN],
        [{ type: 'move', zone: away }, ENEMY],
      ]
      if (order === 'moveFirst') orders.reverse()
      for (const [cmd, as] of orders) game.submit(cmd, as)
      await game.tick()
      const s = await game.state()
      outcomes.push(
        JSON.stringify({
          human: { bw: s.players[HUMAN]!.bw, buffs: s.players[HUMAN]!.buffs },
          enemy: { zone: s.players[ENEMY]!.zone, buffs: s.players[ENEMY]!.buffs },
          rejected: game.lastRejected,
        }),
      )
    }
    expect(outcomes[0]).toBe(outcomes[1])
  })

  it('mutual breach: both open, independent of player-map key order', async () => {
    const outcomes: string[] = []
    for (const reverseKeys of [false, true]) {
      const game = await duel({}, { reverseKeys })
      game.submit(breach(HUMAN), ENEMY)
      game.submit(breach(ENEMY), HUMAN)
      await game.tick()
      const s = await game.state()
      expect(isOpenBy(s.players[ENEMY]!, HUMAN)).toBe(true)
      expect(isOpenBy(s.players[HUMAN]!, ENEMY)).toBe(true)
      outcomes.push(
        JSON.stringify([HUMAN, ENEMY].map((id) => [s.players[id]!.bw, s.players[id]!.buffs])),
      )
    }
    expect(outcomes[0]).toBe(outcomes[1])
  })

  it('a caster dropped by a swing LATER this cycle still opened the breach (committed at phase start)', async () => {
    const game = await duel({ [HUMAN]: { integ: 5 } })
    game.submit(breach(ENEMY), HUMAN)
    game.attackHero(HUMAN, ENEMY)
    await game.tick()
    const s = await game.state()
    expect(s.players[HUMAN]!.alive).toBe(false)
    expect(isOpenBy(s.players[ENEMY]!, HUMAN)).toBe(true)
  })

  it('a caster dropped by an item active (phase 0) breaches nobody', async () => {
    const game = await duel({
      [HUMAN]: { integ: 20 },
      [ENEMY]: { items: ['burnout', null, null, null, null, null] },
    })
    game.submit(breach(ENEMY), HUMAN)
    game.submit({ type: 'use', item: 'burnout', target: { kind: 'hero', name: HUMAN } }, ENEMY)
    await game.tick()
    const s = await game.state()
    expect(s.players[HUMAN]!.alive).toBe(false)
    expect(s.players[ENEMY]!.buffs.some((b) => b.id === 'breached')).toBe(false)
    expect(game.lastEvents.some((e) => e._tag === 'breach_opened')).toBe(false)
    expect(game.lastRejected).toContainEqual({
      playerId: HUMAN,
      reason: 'You went down before your breach landed',
    })
  })

  it('a target that AIRGAPS with an item active (phase 0) is not breached', async () => {
    const game = await duel({ [ENEMY]: { items: ['hardshell', null, null, null, null, null] } })
    game.submit(breach(ENEMY), HUMAN)
    game.submit({ type: 'use', item: 'hardshell' }, ENEMY)
    await game.tick()
    expect((await game.player(ENEMY)).buffs.some((b) => b.id === 'breached')).toBe(false)
    expect(game.lastRejected).toContainEqual({
      playerId: HUMAN,
      reason: `${ENEMY} is AIRGAPPED — breach fails`,
    })
  })

  it("same cycle: an ally's code cast (later phase) sees the new breach — full damage, not halved", async () => {
    const damageTo = async (withBreach: boolean) => {
      const game = await duel({}, { ally: true })
      if (withBreach) game.submit(breach(ENEMY), HUMAN)
      game.cast('q', { kind: 'hero', name: ENEMY }, ALLY)
      await game.tick()
      return game.lastEvents
        .filter(
          (e) =>
            e._tag === 'damage' &&
            e.sourceId === ALLY &&
            e.targetId === ENEMY &&
            e.damageType === 'code',
        )
        .reduce((sum, e) => sum + (e._tag === 'damage' ? e.amount : 0), 0)
    }
    const closed = await damageTo(false)
    const open = await damageTo(true)
    expect(closed).toBeGreaterThan(0)
    expect(open).toBeGreaterThan(closed * 1.5)
  })

  it('self-flush still resolves late: an enemy code cast this cycle still hits the open window', async () => {
    // Flush stays in the post-shop step (only the opening moved): the flusher
    // pays BW + the cycle and is CLOSED from the next cycle on — an enemy cast
    // resolved earlier this same cycle still lands in full.
    const codeDamageToMe = async (flush: boolean) => {
      const game = await duel(
        {
          [HUMAN]: {
            buffs: [{ id: 'breached', stacks: 1, cyclesRemaining: 4, source: ENEMY }],
          },
        },
        { enemyHero: 'lambda' },
      )
      if (flush) game.submit({ type: 'breach', target: { kind: 'self' } }, HUMAN)
      game.cast('q', { kind: 'hero', name: HUMAN }, ENEMY)
      await game.tick()
      if (flush) {
        expect((await game.me()).buffs.some((b) => b.id === 'breached')).toBe(false)
        expect(game.lastEvents.find((e) => e._tag === 'breach_opened')).toMatchObject({
          playerId: HUMAN,
          targetId: HUMAN,
          durationCycles: 0,
        })
      }
      return game.lastEvents
        .filter((e) => e._tag === 'damage' && e.sourceId === ENEMY && e.targetId === HUMAN)
        .reduce((sum, e) => sum + (e._tag === 'damage' ? e.amount : 0), 0)
    }
    const stayedOpen = await codeDamageToMe(false)
    expect(stayedOpen).toBeGreaterThan(0)
    expect(await codeDamageToMe(true)).toBe(stayedOpen)
  })
})
