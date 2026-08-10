import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN } from './harness'
import {
  STRIP_HP_THRESHOLD,
  BURN_HP_THRESHOLD,
  WAVE_SCRIP,
  WAVE_XP,
  WAVE_SCRIP_MIN,
  WAVE_SCRIP_MAX,
  BURN_SCRIP_RATIO,
  LINE_UNIT_HP,
} from '~~/shared/constants/balance'
import { HEROES } from '~~/shared/constants/heroes'

/**
 * The strip window.
 *
 * A line unit spawns with 400 INTEG and escalates past 1200 by minute 20,
 * while a hero's basic attack averages 51 — so at one action per cycle a
 * single unit cost eight swings early and two dozen late. Measured over full
 * matches, heroes were finishing 6% of the units that went down; everything
 * else died wave-on-wave, paying nobody. The game's central verb was worth
 * almost nothing.
 *
 * A unit at or below STRIP_HP_THRESHOLD of its spawn INTEG now goes down to
 * the swing whatever the swing was worth, so last-hitting is a question of
 * timing rather than damage. The same shape `burn` has always had on the deny
 * side.
 *
 * `seawall-cross` with a single wave unit and no opposing wave: nothing else
 * can touch it, so any INTEG change is the hero's.
 */

/** Comfortably inside / outside the window, in absolute INTEG. */
const INSIDE = Math.floor(LINE_UNIT_HP * STRIP_HP_THRESHOLD) - 1
const OUTSIDE = Math.ceil(LINE_UNIT_HP * STRIP_HP_THRESHOLD) + 1

async function seedWithUnit(integ: number) {
  const game = await seedGame('laning_combat', { heroSelf: 'echo' })
  await game.patch((s) => ({
    ...s,
    players: {
      ...s.players,
      [HUMAN]: { ...s.players[HUMAN]!, zone: 'seawall-cross', alive: true },
    },
    waves: [{ id: 'target', team: 'audit', zone: 'seawall-cross', integ, type: 'line' }],
  }))
  return game
}

describe('strip: taking the payload', () => {
  it('a unit inside the window goes down to one swing', async () => {
    const game = await seedWithUnit(INSIDE)
    game.submit({ type: 'attack', target: { kind: 'wave', index: 0 } })
    await game.tick()
    expect(
      (await game.state()).waves.find((w) => w.id === 'target'),
      'the unit survived a swing inside the strip window',
    ).toBeUndefined()
  })

  it('a unit just outside the window only takes normal damage', async () => {
    // The differential that makes the test above mean something: one INTEG
    // either side of the line must produce different outcomes, or the strip
    // is indistinguishable from "heroes kill waves".
    const game = await seedWithUnit(OUTSIDE)
    game.submit({ type: 'attack', target: { kind: 'wave', index: 0 } })
    await game.tick()
    const unit = (await game.state()).waves.find((w) => w.id === 'target')
    expect(unit, 'a unit above the window was taken outright').toBeDefined()
    expect(unit!.integ).toBeLessThan(OUTSIDE)
  })

  it('pays the full last-hit scrip, not a consolation', async () => {
    // The whole point is income. A strip that killed the unit but paid nothing
    // would look identical on the board and fix nothing.
    const game = await seedWithUnit(INSIDE)
    const before = (await game.state()).players[HUMAN]!.scrip
    game.submit({ type: 'attack', target: { kind: 'wave', index: 0 } })
    await game.tick()
    const after = (await game.state()).players[HUMAN]!.scrip
    expect(after - before).toBeGreaterThanOrEqual(WAVE_SCRIP)
  })

  it('reports what it actually took, not the attack stat', async () => {
    // The feed reads "took N off the unit". On a strip the swing removes
    // whatever was left, which is usually more than the hero's attack — a
    // damage line quoting the attack stat would be a lie in the log.
    const game = await seedWithUnit(INSIDE)
    game.submit({ type: 'attack', target: { kind: 'wave', index: 0 } })
    await game.tick()
    const dmg = game.lastEvents.find(
      (e) => e._tag === 'damage' && (e as { targetId?: string }).targetId === 'target',
    ) as { amount: number } | undefined
    expect(dmg, 'no damage event for the stripped unit').toBeDefined()
    expect(dmg!.amount).toBe(INSIDE)
  })

  it('does not let a hero strip its OWN wave — that is still burn', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, zone: 'seawall-cross', alive: true },
      },
      waves: [{ id: 'mine', team: 'chaff', zone: 'seawall-cross', integ: INSIDE, type: 'line' }],
    }))
    game.submit({ type: 'attack', target: { kind: 'wave', index: 0 } })
    await game.tick()
    expect(
      (await game.state()).waves.find((w) => w.id === 'mine'),
      'the strip window let a hero delete its own wave for full scrip',
    ).toBeDefined()
  })

  it('leaves the burn window where it was', async () => {
    // Strip and burn are deliberately different numbers: taking an enemy's
    // payload asks more of you than torching your own. If these ever converge
    // it should be a decision, not a drift.
    expect(STRIP_HP_THRESHOLD).toBeLessThan(BURN_HP_THRESHOLD)
  })

  it('scales with the unit, not with a fixed INTEG number', async () => {
    // Units escalate all match (400 -> 1240 for a line unit) and types spawn
    // with different INTEG. A hardcoded cutoff would silently stop working as
    // the game went long — which is the exact failure being fixed here.
    const late = await seedGame('laning_combat', { heroSelf: 'echo' })
    await late.patch((s) => ({
      ...s,
      cycle: 250,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, zone: 'seawall-cross', alive: true },
      },
      waves: [
        {
          id: 'big',
          team: 'audit',
          zone: 'seawall-cross',
          // Spawned big, now inside its OWN window — far above any early-game
          // absolute cutoff.
          integ: Math.floor(1200 * STRIP_HP_THRESHOLD) - 1,
          maxInteg: 1200,
          type: 'line',
        },
      ],
    }))
    late.submit({ type: 'attack', target: { kind: 'wave', index: 0 } })
    await late.tick()
    expect(
      (await late.state()).waves.find((w) => w.id === 'big'),
      'a late-game unit inside its own window survived',
    ).toBeUndefined()
  })
})

/**
 * THE BATCH CLOCK IS CANON: every instruction in a cycle commits at once, in
 * no order. Two swings that land on the same unit in the same cycle are
 * simultaneous — which message the server happened to drain first must never
 * decide who collects the strip. The rule: swings resolve against the waves as
 * the cycle OPENED; every swing that was lethal against that snapshot claims,
 * and claimants split the payload evenly.
 */
const ALLY = 'ally'

async function seedTwoAttackers(wave: {
  team: 'chaff' | 'audit'
  integ: number
  maxInteg?: number
}) {
  const game = await seedGame('laning_combat', {
    players: [
      { id: HUMAN, name: HUMAN, team: 'chaff', heroId: 'echo' },
      { id: ALLY, name: ALLY, team: 'chaff', heroId: 'echo' },
      { id: 'enemy', name: 'enemy', team: 'audit', heroId: 'daemon' },
    ],
  })
  await game.patch((s) => ({
    ...s,
    players: {
      ...s.players,
      [HUMAN]: { ...s.players[HUMAN]!, zone: 'seawall-cross', alive: true },
      [ALLY]: { ...s.players[ALLY]!, zone: 'seawall-cross', alive: true },
    },
    waves: [{ id: 'target', zone: 'seawall-cross', type: 'line' as const, ...wave }],
  }))
  return game
}

describe('strip: same-cycle swings are simultaneous', () => {
  it('two swings inside the window share the strip and split the payload', async () => {
    const game = await seedTwoAttackers({ team: 'audit', integ: INSIDE })
    const before = await game.state()
    game.submit({ type: 'attack', target: { kind: 'wave', index: 0 } }, HUMAN)
    game.submit({ type: 'attack', target: { kind: 'wave', index: 0 } }, ALLY)
    await game.tick()

    const after = await game.state()
    expect(
      after.waves.find((w) => w.id === 'target'),
      'the unit survived',
    ).toBeUndefined()

    // Neither swing is rejected: the second message is not "already dead".
    expect(game.lastRejected).toHaveLength(0)

    // One wave_strip per claimant; the payload splits exactly, no double-pay.
    const strips = game.lastEvents.filter(
      (e) => e._tag === 'wave_strip' && (e as { waveId?: string }).waveId === 'target',
    ) as Array<{ playerId: string; scripAwarded: number }>
    expect(strips.map((s) => s.playerId).sort()).toEqual([ALLY, HUMAN])
    expect(strips.reduce((sum, s) => sum + s.scripAwarded, 0)).toBe(WAVE_SCRIP)

    // The last-hit XP splits the same way (zone share excludes claimants).
    const xpDelta = (id: string) => after.players[id]!.xp - before.players[id]!.xp
    expect(xpDelta(HUMAN)).toBe(Math.floor(WAVE_XP / 2))
    expect(xpDelta(ALLY)).toBe(Math.floor(WAVE_XP / 2))
  })

  it('permuting the arrival order of the same cycle changes NOTHING', async () => {
    const outcomes = [] as Array<{ scrip: number[]; xp: number[]; strips: string }>
    for (const order of [
      [HUMAN, ALLY],
      [ALLY, HUMAN],
    ]) {
      const game = await seedTwoAttackers({ team: 'audit', integ: INSIDE })
      const before = await game.state()
      for (const who of order) {
        game.submit({ type: 'attack', target: { kind: 'wave', index: 0 } }, who)
      }
      await game.tick()
      const after = await game.state()
      outcomes.push({
        scrip: [HUMAN, ALLY].map((id) => after.players[id]!.scrip - before.players[id]!.scrip),
        xp: [HUMAN, ALLY].map((id) => after.players[id]!.xp - before.players[id]!.xp),
        strips: JSON.stringify(
          game.lastEvents
            .filter((e) => e._tag === 'wave_strip')
            .map((e) => e as { playerId: string; scripAwarded: number })
            .map((e) => [e.playerId, e.scripAwarded])
            .sort(),
        ),
      })
    }
    expect(outcomes[1]).toEqual(outcomes[0])
  })

  it('a unit downed only by the cycle’s combined damage credits every hand', async () => {
    // Outside the window, neither swing lethal alone, the two together are.
    const attack = HEROES.echo!.baseStats.attack
    const integ = Math.floor(attack * 1.7)
    const game = await seedTwoAttackers({ team: 'audit', integ, maxInteg: attack * 4 })
    game.submit({ type: 'attack', target: { kind: 'wave', index: 0 } }, HUMAN)
    game.submit({ type: 'attack', target: { kind: 'wave', index: 0 } }, ALLY)
    await game.tick()

    expect((await game.state()).waves.find((w) => w.id === 'target')).toBeUndefined()
    const strips = game.lastEvents.filter((e) => e._tag === 'wave_strip') as Array<{
      playerId: string
      scripAwarded: number
    }>
    expect(strips.map((s) => s.playerId).sort()).toEqual([ALLY, HUMAN])
    expect(strips.reduce((sum, s) => sum + s.scripAwarded, 0)).toBe(WAVE_SCRIP)
  })

  it('a swing lethal on its own outranks a swing that was not', async () => {
    // Outside the window: the buffed hero's swing covers the whole INTEG, the
    // unbuffed one does not. Only the lethal swing claims — arrival order of
    // the two messages is irrelevant, the snapshot decides.
    const attack = HEROES.echo!.baseStats.attack
    const integ = attack + 60
    const game = await seedTwoAttackers({ team: 'audit', integ, maxInteg: (attack + 60) * 2 })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          buffs: [{ id: 'forkAtk', stacks: 100, cyclesRemaining: 3, source: HUMAN }],
        },
      },
    }))
    // The non-lethal swing arrives FIRST — under arrival-order resolution it
    // would chip the unit and the lethal swing would collect; under the batch
    // clock the lethal swing alone claims the full payload.
    game.submit({ type: 'attack', target: { kind: 'wave', index: 0 } }, ALLY)
    game.submit({ type: 'attack', target: { kind: 'wave', index: 0 } }, HUMAN)
    await game.tick()

    expect((await game.state()).waves.find((w) => w.id === 'target')).toBeUndefined()
    const strips = game.lastEvents.filter((e) => e._tag === 'wave_strip') as Array<{
      playerId: string
      scripAwarded: number
    }>
    expect(strips.map((s) => s.playerId)).toEqual([HUMAN])
    expect(strips[0]!.scripAwarded).toBe(WAVE_SCRIP)
  })

  it('two same-cycle burns share the deny instead of eating a cycle', async () => {
    const game = await seedTwoAttackers({
      team: 'chaff',
      integ: Math.floor(LINE_UNIT_HP * BURN_HP_THRESHOLD) - 1,
    })
    game.submit({ type: 'burn', target: { kind: 'wave', index: 0 } }, HUMAN)
    game.submit({ type: 'burn', target: { kind: 'wave', index: 0 } }, ALLY)
    await game.tick()

    expect((await game.state()).waves.find((w) => w.id === 'target')).toBeUndefined()
    const burns = game.lastEvents.filter((e) => e._tag === 'wave_burn') as Array<{
      playerId: string
      scripAwarded: number
    }>
    const burnGold = Math.floor(((WAVE_SCRIP_MIN + WAVE_SCRIP_MAX) / 2) * BURN_SCRIP_RATIO)
    expect(burns.map((b) => b.playerId).sort()).toEqual([ALLY, HUMAN])
    expect(burns.reduce((sum, b) => sum + b.scripAwarded, 0)).toBe(burnGold)
  })
})
