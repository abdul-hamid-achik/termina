import { describe, it, expect, beforeEach } from 'vitest'
import type { BuffState, GameState, PlayerState } from '~~/shared/types/game'
import type { HeroId } from '~~/shared/types/hero'
import { seedGame, ENEMY, HUMAN, type Run } from './harness'
import { resetWaveIdCounter } from '~~/server/game/map/spawner'
import { filterStateForPlayer } from '~~/server/game/engine/VisionCalculator'
import { BREACH_BW_COST, BREACH_DURATION_CYCLES } from '~~/shared/constants/balance'

/**
 * Auto-breach (owner decision): a single-target hard-control cast aimed at a
 * CLOSED enemy hero is not thrown away. When the caster could legally `breach`
 * that target right now, the order is CONVERTED into that breach — the cycle,
 * the 50 BW and the breach cooldown are spent exactly as a typed breach would
 * spend them; the ability's own BW and cooldown are untouched. When the caster
 * cannot breach, the rejection names the precise blocker.
 *
 * Every scenario runs at a non-default cycle and level, after one settling tick
 * (the harness's first-tick maxInteg recompute).
 */

beforeEach(() => {
  resetWaveIdCounter()
})

interface DuelOpts {
  heroSelf?: HeroId
  heroEnemy?: HeroId
  bw?: number
  selfBuffs?: BuffState[]
  enemyBuffs?: BuffState[]
  enemyZone?: string
}

async function closedDuel(opts: DuelOpts = {}): Promise<Run> {
  const game = await seedGame('laning_combat', {
    heroSelf: opts.heroSelf ?? 'kernel',
    heroEnemy: opts.heroEnemy ?? 'echo',
  })
  await game.tick()
  await game.patch((s) => ({
    ...s,
    cycle: 137,
    rngSeed: 4242,
    players: {
      ...s.players,
      [HUMAN]: {
        ...s.players[HUMAN]!,
        level: 9,
        cooldowns: { q: 0, w: 0, e: 0, r: 0 },
        bw: opts.bw ?? Math.min(250, s.players[HUMAN]!.maxBw),
        buffs: opts.selfBuffs ?? [],
      },
      [ENEMY]: {
        ...s.players[ENEMY]!,
        level: 8,
        buffs: opts.enemyBuffs ?? [],
        ...(opts.enemyZone ? { zone: opts.enemyZone } : {}),
      },
    },
  }))
  return game
}

const breachEvent = (game: Run) => game.lastEvents.find((e) => e._tag === 'breach_opened')
const isOpen = (p: PlayerState) => p.buffs.some((b) => b.id === 'breached' && b.cyclesRemaining > 0)

describe('auto-breach: a control cast into a CLOSED hero becomes a breach', () => {
  it('converts kernel Q at a closed enemy into a breach — no rejection, no Q spent', async () => {
    const game = await closedDuel()
    game.cast('q', { kind: 'hero', name: ENEMY })
    await game.tick()

    expect(game.lastRejected.filter((r) => r.playerId === HUMAN)).toEqual([])
    const ev = breachEvent(game)
    expect(ev).toMatchObject({
      _tag: 'breach_opened',
      playerId: HUMAN,
      targetId: ENEMY,
      durationCycles: BREACH_DURATION_CYCLES,
      fromAbility: 'q',
      fromAbilityName: 'Interrupt',
    })
    expect(isOpen(await game.player(ENEMY))).toBe(true)
    const me = await game.me()
    // The ability was NOT cast: its cooldown is untouched and no ability_used.
    expect(me.cooldowns.q).toBe(0)
    expect(game.lastEvents.some((e) => e._tag === 'ability_used')).toBe(false)
    // The breach cooldown WAS spent.
    expect(me.buffs.some((b) => b.id === 'item_cd_breach')).toBe(true)
  })

  it('spends exactly what a typed breach spends (same players state)', async () => {
    const converted = await closedDuel()
    converted.cast('q', { kind: 'hero', name: ENEMY })
    await converted.tick()

    resetWaveIdCounter()
    const typed = await closedDuel()
    typed.submit({ type: 'breach', target: { kind: 'hero', name: ENEMY } })
    await typed.tick()

    const strip = (s: GameState) => ({ ...s.players })
    expect(strip(await converted.state())).toEqual(strip(await typed.state()))
    const me = await converted.me()
    const before = Math.min(250, me.maxBw)
    // BW went DOWN by the breach cost (net of one cycle of regen), not by Q's cost.
    expect(me.bw).toBeLessThan(before)
    expect(before - me.bw).toBeLessThanOrEqual(BREACH_BW_COST)
  })

  it('treats standing walk/attack orders exactly like a typed breach does', async () => {
    const withOrders = async (submit: (g: Run) => void) => {
      resetWaveIdCounter()
      const g = await closedDuel()
      await g.patch((s) => ({
        ...s,
        players: {
          ...s.players,
          [HUMAN]: {
            ...s.players[HUMAN]!,
            moveTarget: 'coldstore-t1-audit',
            attackTarget: { kind: 'hero', name: ENEMY },
          },
        },
      }))
      submit(g)
      await g.tick()
      return (await g.state()).players
    }
    const converted = await withOrders((g) => g.cast('q', { kind: 'hero', name: ENEMY }))
    const typed = await withOrders((g) =>
      g.submit({ type: 'breach', target: { kind: 'hero', name: ENEMY } }),
    )
    expect(converted).toEqual(typed)
  })

  it('the next cycle the same cast lands the stun', async () => {
    const game = await closedDuel()
    game.cast('q', { kind: 'hero', name: ENEMY })
    await game.tick()
    game.cast('q', { kind: 'hero', name: ENEMY })
    await game.tick()
    expect(game.lastRejected.filter((r) => r.playerId === HUMAN)).toEqual([])
    expect(game.lastEvents.some((e) => e._tag === 'ability_used' && e.playerId === HUMAN)).toBe(
      true,
    )
    expect(
      game.lastEvents.some(
        (e) => e._tag === 'status_applied' && e.targetId === ENEMY && e.status === 'stun',
      ),
    ).toBe(true)
  })

  it('the caster sees the converted breach in their vision-filtered events', async () => {
    const game = await closedDuel()
    game.cast('q', { kind: 'hero', name: ENEMY })
    await game.tick()
    const view = filterStateForPlayer(await game.state(), HUMAN)
    const ev = view.events.find((e) => e.type === 'breach_opened')
    expect(ev?.payload).toMatchObject({ playerId: HUMAN, targetId: ENEMY, fromAbility: 'q' })
  })
})

describe('auto-breach: when the caster cannot breach, the blocker is named', () => {
  it('not enough BW to breach', async () => {
    const game = await closedDuel({ bw: 30 })
    game.cast('q', { kind: 'hero', name: ENEMY })
    await game.tick()
    const reason = game.lastRejected.find((r) => r.playerId === HUMAN)?.reason ?? ''
    expect(reason).toMatch(/CLOSED/)
    expect(reason).toMatch(new RegExp(`need ${BREACH_BW_COST} BW to breach ${ENEMY}`, 'i'))
    expect(breachEvent(game)).toBeUndefined()
    expect(isOpen(await game.player(ENEMY))).toBe(false)
  })

  it('breach on cooldown names the cycles left', async () => {
    const game = await closedDuel({
      selfBuffs: [{ id: 'item_cd_breach', stacks: 1, cyclesRemaining: 4, source: HUMAN }],
    })
    game.cast('q', { kind: 'hero', name: ENEMY })
    await game.tick()
    const reason = game.lastRejected.find((r) => r.playerId === HUMAN)?.reason ?? ''
    expect(reason).toMatch(/CLOSED/)
    expect(reason).toMatch(/breach ready in 4 cycles/i)
    expect(breachEvent(game)).toBeUndefined()
  })

  it('a near-reach stun at a closed hero next door: the dash and hit land, the stun fizzles', async () => {
    // malloc E reaches an adjacent zone; breach does not — so the cast is not
    // pre-refused or converted: it resolves, and only the control is resisted.
    const game = await closedDuel({ heroSelf: 'malloc', enemyZone: 'coldstore-t1-chaff' })
    const before = await game.player(ENEMY)
    game.cast('e', { kind: 'hero', name: ENEMY })
    await game.tick()
    expect(game.lastRejected.filter((r) => r.playerId === HUMAN)).toEqual([])
    expect(breachEvent(game)).toBeUndefined()
    expect((await game.me()).zone).toBe('coldstore-t1-chaff')
    expect(
      game.lastEvents.some(
        (e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === ENEMY,
      ),
    ).toBe(true)
    expect(game.lastEvents.find((e) => e._tag === 'control_resisted')).toMatchObject({
      playerId: HUMAN,
      targetId: ENEMY,
      status: 'stun',
      ability: 'e',
    })
    const after = await game.player(ENEMY)
    expect(after.integ).toBeLessThan(before.integ)
    expect(after.buffs.some((b) => b.id === 'stun')).toBe(false)
  })

  it('regex E swaps with a closed hero wherever they are; only the stun fizzles', async () => {
    const game = await closedDuel({ heroSelf: 'regex', enemyZone: 'seawall-t1-chaff' })
    const myZone = (await game.me()).zone
    game.cast('e', { kind: 'hero', name: ENEMY })
    await game.tick()
    expect(game.lastRejected.filter((r) => r.playerId === HUMAN)).toEqual([])
    expect((await game.me()).zone).toBe('seawall-t1-chaff')
    expect((await game.player(ENEMY)).zone).toBe(myZone)
    expect(game.lastEvents.some((e) => e._tag === 'control_resisted')).toBe(true)
  })
})

describe('auto-breach leaves every other cast alone', () => {
  it('a breached target takes the cast as normal', async () => {
    const game = await closedDuel({
      enemyBuffs: [{ id: 'breached', stacks: 1, cyclesRemaining: 3, source: HUMAN }],
    })
    game.cast('q', { kind: 'hero', name: ENEMY })
    await game.tick()
    expect(breachEvent(game)).toBeUndefined()
    expect(game.lastEvents.some((e) => e._tag === 'ability_used')).toBe(true)
  })

  it('an AIRGAPPED target is not converted (breach would fail)', async () => {
    const game = await closedDuel({
      enemyBuffs: [{ id: 'airgap', stacks: 1, cyclesRemaining: 3, source: ENEMY }],
    })
    game.cast('q', { kind: 'hero', name: ENEMY })
    await game.tick()
    expect(breachEvent(game)).toBeUndefined()
    expect(game.lastRejected.find((r) => r.playerId === HUMAN)?.reason ?? '').not.toMatch(/CLOSED/)
  })

  it('a stunned caster is still told they are stunned', async () => {
    const game = await closedDuel({
      selfBuffs: [{ id: 'stun', stacks: 1, cyclesRemaining: 3, source: ENEMY }],
    })
    game.cast('q', { kind: 'hero', name: ENEMY })
    await game.tick()
    expect(game.lastRejected.find((r) => r.playerId === HUMAN)?.reason).toBe(
      'Cannot cast while stunned',
    )
    expect(breachEvent(game)).toBeUndefined()
  })
})

describe('AoE control that fizzles on a CLOSED hero is reported to the caster', () => {
  it('kernel E (Core Dump, AoE taunt) on a closed enemy emits control_resisted', async () => {
    const game = await closedDuel()
    game.cast('e')
    await game.tick()
    expect(game.lastEvents.some((e) => e._tag === 'ability_used')).toBe(true)
    const ev = game.lastEvents.find((e) => e._tag === 'control_resisted')
    expect(ev).toMatchObject({
      _tag: 'control_resisted',
      playerId: HUMAN,
      targetId: ENEMY,
      status: 'taunt',
      ability: 'e',
      abilityName: 'Core Dump',
    })
    const view = filterStateForPlayer(await game.state(), HUMAN)
    expect(view.events.some((e) => e.type === 'control_resisted')).toBe(true)
  })

  it('no control_resisted when the target is breached', async () => {
    const game = await closedDuel({
      enemyBuffs: [{ id: 'breached', stacks: 1, cyclesRemaining: 3, source: HUMAN }],
    })
    game.cast('e')
    await game.tick()
    expect(game.lastEvents.some((e) => e._tag === 'control_resisted')).toBe(false)
  })
})

describe('a control cast at a hero outside your zone is no status oracle', () => {
  // The order is refused with the same out-of-zone line whatever the target's
  // access state — CLOSED, breached or AIRGAPPED reads the same from the fog.
  const FAR = 'shallows-t3-audit'
  for (const [label, buffs] of [
    ['closed', [] as BuffState[]],
    ['airgapped', [{ id: 'airgap', stacks: 1, cyclesRemaining: 5, source: ENEMY }]],
    ['breached', [{ id: 'breached', stacks: 1, cyclesRemaining: 5, source: HUMAN }]],
  ] as const) {
    it(`kernel Q at a fogged ${label} hero gets the ordinary out-of-zone line`, async () => {
      const game = await closedDuel({ enemyZone: FAR, enemyBuffs: [...buffs] })
      game.cast('q', { kind: 'hero', name: ENEMY })
      await game.tick()
      const reasons = game.lastRejected.filter((r) => r.playerId === HUMAN).map((r) => r.reason)
      expect(reasons).toEqual(['Target not in same zone or dead'])
      expect(breachEvent(game)).toBeUndefined()
    })
  }
})
