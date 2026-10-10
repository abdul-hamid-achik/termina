import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import { seedGame, HUMAN, ENEMY, type Run } from './harness'
import type { GameState, WaveUnitState } from '~~/shared/types/game'
import type { TargetRef } from '~~/shared/types/commands'
import { APPROACH_HOLD_DAMAGE_RATIO, waveUnitMaxHp } from '~~/shared/constants/balance'
import { ZONE_MAP } from '~~/shared/constants/zones'
import { processCycle, submitReplayAction } from '~~/server/game/engine/GameLoop'
import { predictedHopDamage } from '~~/server/game/engine/ActionResolver'
import { finalSummaryHash } from '~~/server/game/engine/replayArtifact'
import { filterStateForPlayer } from '~~/server/game/engine/VisionCalculator'

/**
 * Playtest 3 (Oct 2026): a standing `attack ice:` walk never aborted at low
 * INTEG — the tester walked from 250/598 straight into enemy ICE and died.
 * Playtest 4: the INTEG%-only hold let a FULL-INTEG hero walk into 4 escalated
 * enemy units + ICE (550 → 72 → dead next cycle), and into a 12-unit stack.
 *
 * The held ICE / Terminal approach now holds one hop short when what the next
 * zone would throw at the walker in one cycle (ActionResolver.predictedHopDamage
 * — enemy units that would shoot them + an ICE that would) is at least
 * APPROACH_HOLD_DAMAGE_RATIO of their CURRENT INTEG — the walk and the held
 * attack are dropped, with a notice that states the numbers. A TYPED order is
 * never held: retyping the attack that cycle pushes in anyway.
 */

const T1_AUDIT = 'coldstore-t1-audit'
const T2_AUDIT = 'coldstore-t2-audit'
const ICE_T1: TargetRef = { kind: 'ice', zone: T1_AUDIT }
const CROSS = 'coldstore-cross'
/** A non-default cycle (wave escalation in play): nothing here may depend on
 *  the game being young. */
const LATE = 211
const MAX = 600

function units(team: 'chaff' | 'audit', zone: string, n: number, tag = team): WaveUnitState[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${tag}-${zone}-${i}`,
    team,
    zone,
    integ: waveUnitMaxHp('line', LATE),
    maxInteg: waveUnitMaxHp('line', LATE),
    type: 'line' as const,
  }))
}

/**
 * The human one hop short of `T1_AUDIT` (at the crossing) with the ICE walk
 * already HELD (moveTarget + attackTarget, as approachStructure leaves them),
 * at `integ`, cycle `cycle`. The enemy hero is parked at its own fountain; no
 * wave units unless `patch` adds them.
 */
/** A second audit hero for the hero-threat cases (parked at its fountain by default). */
const ENEMY2 = 'enemy2'

async function heldWalk(
  integ: number,
  patch: (s: GameState) => GameState = (s) => s,
  cycle = LATE,
) {
  const game = await seedGame('laning_combat', {
    players: [
      { id: HUMAN, name: HUMAN, team: 'chaff', heroId: 'echo' },
      { id: ENEMY, name: ENEMY, team: 'audit', heroId: 'daemon' },
      { id: ENEMY2, name: ENEMY2, team: 'audit', heroId: 'mutex' },
    ],
  })
  await game.tick() // settle the first-tick maxInteg recompute
  await game.patch((s) => {
    const me = s.players[HUMAN]!
    return patch({
      ...s,
      cycle,
      waves: [],
      players: {
        ...s.players,
        [HUMAN]: {
          ...me,
          zone: CROSS,
          maxInteg: MAX,
          integ,
          moveTarget: T1_AUDIT,
          attackTarget: ICE_T1,
        },
        [ENEMY]: { ...s.players[ENEMY]!, zone: 'landing-anchor' },
        [ENEMY2]: { ...s.players[ENEMY2]!, zone: 'landing-anchor' },
      },
    })
  })
  return game
}

/** Both enemy heroes standing at `zone`, alive, at level 6. */
function heroesAt(zone: string, buffs: GameState['players'][string]['buffs'] = []) {
  return (s: GameState): GameState => ({
    ...s,
    players: {
      ...s.players,
      [ENEMY]: { ...s.players[ENEMY]!, zone, alive: true, level: 6, buffs },
      [ENEMY2]: { ...s.players[ENEMY2]!, zone, alive: true, level: 6, buffs },
    },
  })
}

/** What the engine will predict for the human's next hop when the next cycle
 *  resolves (processCycle increments the cycle before the hold runs). */
async function predicted(game: Run, hop = T1_AUDIT, aggro = true) {
  const s = await game.state()
  const next = { ...s, cycle: s.cycle + 1 }
  return predictedHopDamage(next, next.players[HUMAN]!, hop, aggro)
}

const mine = (game: Run) =>
  game.lastNotices.filter((n) => n.playerId === HUMAN).map((n) => n.message)

/** INTEG at which the ICE's shot alone is exactly the hold ratio. */
async function iceOnlyBoundary(game: Run) {
  return Math.floor((await predicted(game)).damage / APPROACH_HOLD_DAMAGE_RATIO)
}

/** A low INTEG at which the ICE's shot alone holds the walk. */
const LOW = 150

describe('a held ICE walk holds one hop short of fire it cannot take', () => {
  it('playtest 4: FULL INTEG into 4 escalated units + ICE holds, and the notice states the numbers', async () => {
    const game = await heldWalk(550, (s) => ({ ...s, waves: units('audit', T1_AUDIT, 4) }))
    const threat = await predicted(game)
    expect(threat.units).toBe(4)
    expect(threat.ice).toBe(true)
    expect(threat.damage).toBeGreaterThanOrEqual(550 * APPROACH_HOLD_DAMAGE_RATIO)

    await game.tick()

    const me = await game.me()
    expect(me.zone).toBe(CROSS)
    expect(me.moveTarget ?? null).toBeNull()
    expect(me.attackTarget ?? null).toBeNull()
    expect(mine(game)).toEqual([
      `Holding at ${ZONE_MAP[CROSS]!.name}: 4 enemy units + ICE hit for ~${threat.damage}/cycle ` +
        `in ${ZONE_MAP[T1_AUDIT]!.name}, you have 550 — retype \`attack ice:${T1_AUDIT}\` to push in`,
    ])
    // Prose names zones by their display names — the raw id appears only in
    // the command to retype.
    expect(mine(game)[0]!.replace(`attack ice:${T1_AUDIT}`, '')).not.toMatch(/coldstore-/)
    // Said once: the next cycle is quiet and the hero stays put.
    await game.tick()
    expect(mine(game)).toEqual([])
    expect((await game.me()).zone).toBe(CROSS)
  })

  it('the SAME stack early in the game (no escalation) is survivable at full INTEG — the walk goes on', async () => {
    const early = 20
    const game = await heldWalk(550, (s) => ({ ...s, waves: units('audit', T1_AUDIT, 4) }), early)
    const lateGame = await heldWalk(550, (s) => ({ ...s, waves: units('audit', T1_AUDIT, 4) }))
    // Escalation is what turns this stack lethal.
    expect((await predicted(game)).damage).toBeLessThan((await predicted(lateGame)).damage)
    expect((await predicted(game)).damage).toBeLessThan(550 * APPROACH_HOLD_DAMAGE_RATIO)
    await game.tick()
    expect((await game.me()).zone).toBe(T1_AUDIT)
    expect(mine(game)).toEqual([])
  })

  it('a 12-unit stack past a fallen T1 holds a full-INTEG hero short of the T2', async () => {
    const game = await heldWalk(MAX, (s) => ({
      ...s,
      ice: s.ice.map((t) => (t.zone === T1_AUDIT ? { ...t, alive: false, integ: 0 } : t)),
      waves: units('audit', T2_AUDIT, 12),
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          zone: T1_AUDIT,
          moveTarget: T2_AUDIT,
          attackTarget: { kind: 'ice', zone: T2_AUDIT },
        },
      },
    }))
    const threat = await predicted(game, T2_AUDIT)
    expect(threat.units).toBe(12)
    await game.tick()
    expect((await game.me()).zone).toBe(T1_AUDIT)
    expect(mine(game)).toEqual([
      `Holding at ${ZONE_MAP[T1_AUDIT]!.name}: 12 enemy units + ICE hit for ~${threat.damage}/cycle ` +
        `in ${ZONE_MAP[T2_AUDIT]!.name}, you have ${MAX} — retype \`attack ice:${T2_AUDIT}\` to push in`,
    ])
  })

  it('an escort of your own units takes the wave fire — only the ICE counts, and full INTEG walks in', async () => {
    const game = await heldWalk(MAX, (s) => ({
      ...s,
      waves: [...units('audit', T1_AUDIT, 4), ...units('chaff', T1_AUDIT, 2)],
    }))
    const threat = await predicted(game)
    expect(threat).toMatchObject({ units: 0, ice: true })
    await game.tick()
    expect((await game.me()).zone).toBe(T1_AUDIT)
    expect(mine(game)).toEqual([])
  })

  it('ICE alone: at the ratio boundary it holds, one INTEG above it walks in and swings', async () => {
    const probe = await heldWalk(MAX)
    const boundary = await iceOnlyBoundary(probe)

    const held = await heldWalk(boundary)
    await held.tick()
    expect((await held.me()).zone).toBe(CROSS)
    expect(mine(held)).toHaveLength(1)
    expect(mine(held)[0]).toMatch(/^Holding at Coldstore Crossing: ICE hit for ~\d+\/cycle in /)

    const goes = await heldWalk(boundary + 1)
    await goes.tick()
    expect((await goes.me()).zone).toBe(T1_AUDIT)
    expect(mine(goes)).toEqual([])
    await goes.tick()
    expect(
      goes.lastEvents.some(
        (e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === `ice_${T1_AUDIT}`,
      ),
    ).toBe(true)
  })

  it('visible enemy heroes count: the playtest-4 stack plus 2 heroes reads as such, with their damage', async () => {
    const withHeroes = await heldWalk(550, (s) =>
      heroesAt(T1_AUDIT)({ ...s, waves: units('audit', T1_AUDIT, 4) }),
    )
    const without = await heldWalk(550, (s) => ({ ...s, waves: units('audit', T1_AUDIT, 4) }))
    const threat = await predicted(withHeroes)
    expect(threat).toMatchObject({ units: 4, ice: true, heroes: 2 })
    expect(threat.damage).toBeGreaterThan((await predicted(without)).damage)

    await withHeroes.tick()
    expect((await withHeroes.me()).zone).toBe(CROSS)
    expect(mine(withHeroes)).toEqual([
      `Holding at ${ZONE_MAP[CROSS]!.name}: 4 enemy units + ICE + 2 enemy heroes hit for ~${threat.damage}/cycle ` +
        `in ${ZONE_MAP[T1_AUDIT]!.name}, you have 550 — retype \`attack ice:${T1_AUDIT}\` to push in`,
    ])
  })

  it('heroes alone can hold the walk — a dead ICE and no units, but two enemy heroes waiting', async () => {
    const game = await heldWalk(LOW, (s) =>
      heroesAt(T1_AUDIT)({
        ...s,
        ice: s.ice.map((t) => (t.zone === T1_AUDIT ? { ...t, alive: false, integ: 0 } : t)),
        players: {
          ...s.players,
          [HUMAN]: {
            ...s.players[HUMAN]!,
            moveTarget: T2_AUDIT,
            attackTarget: { kind: 'ice', zone: T2_AUDIT },
          },
        },
      }),
    )
    const threat = await predicted(game, T1_AUDIT, false)
    expect(threat).toMatchObject({ units: 0, ice: false, heroes: 2 })
    expect(threat.damage).toBeGreaterThanOrEqual(LOW * APPROACH_HOLD_DAMAGE_RATIO)
    await game.tick()
    expect((await game.me()).zone).toBe(CROSS)
    expect(mine(game)[0]).toMatch(
      /^Holding at Coldstore Crossing: 2 enemy heroes hit for ~\d+\/cycle in /,
    )
  })

  it('an immune walker takes nothing from the heroes it can see', async () => {
    const game = await heldWalk(LOW, (s) =>
      heroesAt(T1_AUDIT)({
        ...s,
        ice: s.ice.map((t) => (t.zone === T1_AUDIT ? { ...t, alive: false, integ: 0 } : t)),
        players: {
          ...s.players,
          [HUMAN]: {
            ...s.players[HUMAN]!,
            buffs: [{ id: 'invulnerable', cyclesRemaining: 3, stacks: 0, source: HUMAN }] as never,
          },
        },
      }),
    )
    expect(await predicted(game, T1_AUDIT, false)).toMatchObject({ damage: 0, heroes: 2 })
  })

  it('a hero the player cannot see never counts — the hold does not leak positions', async () => {
    const invis = [{ id: 'invis', cyclesRemaining: 5, stacks: 0, source: ENEMY }]
    const game = await heldWalk(LOW, (s) =>
      heroesAt(
        T1_AUDIT,
        invis as never,
      )({
        ...s,
        ice: s.ice.map((t) => (t.zone === T1_AUDIT ? { ...t, alive: false, integ: 0 } : t)),
        players: {
          ...s.players,
          [HUMAN]: {
            ...s.players[HUMAN]!,
            moveTarget: T2_AUDIT,
            attackTarget: { kind: 'ice', zone: T2_AUDIT },
          },
        },
      }),
    )
    expect(await predicted(game, T1_AUDIT, false)).toMatchObject({ damage: 0, heroes: 0 })
    await game.tick()
    expect((await game.me()).zone).toBe(T1_AUDIT)
    expect(mine(game)).toEqual([])
  })

  // Round-5 review: at night the walker's vision drops the next hop (the enemy
  // T1), so its cycle_state shows NO units there — the hold must not count
  // them either, or its "3 enemy units + ICE" notice leaks the stack.
  it('units in a hop the walker cannot see never count — at night the hold does not leak a stack', async () => {
    const at = (timeOfDay: 'day' | 'night') =>
      heldWalk(300, (s) => ({
        ...s,
        timeOfDay,
        dayNightCycle: 5,
        waves: units('audit', T1_AUDIT, 3),
      }))
    const day = await at('day')
    expect(filterStateForPlayer(await day.state(), HUMAN).waves).toHaveLength(3)
    expect((await predicted(day)).units).toBe(3)

    const night = await at('night')
    expect(filterStateForPlayer(await night.state(), HUMAN).waves).toHaveLength(0)
    expect(await predicted(night)).toMatchObject({ units: 0, ice: true })
    await night.tick()
    expect(mine(night).join(' ')).not.toMatch(/unit/)

    // At LOW INTEG the ICE alone holds the walk — and the notice names ONLY
    // the ICE: the unseen stack is in neither the number nor the words.
    const low = await heldWalk(LOW, (s) => ({
      ...s,
      timeOfDay: 'night',
      dayNightCycle: 5,
      waves: units('audit', T1_AUDIT, 3),
    }))
    await low.tick()
    expect((await low.me()).zone).toBe(CROSS)
    expect(mine(low)).toHaveLength(1)
    expect(mine(low)[0]).toMatch(/^Holding at Coldstore Crossing: ICE hit for ~\d+\/cycle in /)
  })

  it('retyping the order that cycle overrides the hold — the player pushes in', async () => {
    const game = await heldWalk(LOW)
    await game.tick() // held
    expect(mine(game)).toHaveLength(1)
    game.submit({ type: 'attack', target: ICE_T1 })
    await game.tick()
    const me = await game.me()
    expect(me.zone).toBe(T1_AUDIT)
    expect(me.attackTarget).toEqual(ICE_T1)
    expect(game.lastRejected.filter((r) => r.playerId === HUMAN)).toEqual([])
  })

  it('a dead enemy ICE ahead with no units there is no reason to hold', async () => {
    const game = await heldWalk(LOW, (s) => ({
      ...s,
      ice: s.ice.map((t) => (t.zone === T1_AUDIT ? { ...t, alive: false, integ: 0 } : t)),
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          moveTarget: T2_AUDIT,
          attackTarget: { kind: 'ice', zone: T2_AUDIT },
        },
      },
    }))
    await game.tick()
    expect((await game.me()).zone).toBe(T1_AUDIT)
    expect(mine(game)).toEqual([])
  })

  it('the Terminal walk into an empty enemy base is NOT held — a Terminal never shoots a hero', async () => {
    const T3_AUDIT = 'coldstore-t3-audit'
    const game = await heldWalk(LOW - 20, (s) => ({
      ...s,
      // Every audit ICE down: the Terminal is open, nothing in the base fires.
      ice: s.ice.map((t) => (t.team === 'audit' ? { ...t, alive: false, integ: 0 } : t)),
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          zone: T3_AUDIT,
          moveTarget: 'landing-terminal',
          attackTarget: { kind: 'terminal' },
        },
      },
    }))
    await game.tick()
    const me = await game.me()
    expect(me.zone).toBe('landing-terminal')
    expect(me.attackTarget).toEqual({ kind: 'terminal' })
    expect(mine(game)).toEqual([])
  })

  it('…but a unit stack waiting in the enemy base holds the Terminal walk', async () => {
    const T3_AUDIT = 'coldstore-t3-audit'
    const game = await heldWalk(LOW, (s) => ({
      ...s,
      ice: s.ice.map((t) => (t.team === 'audit' ? { ...t, alive: false, integ: 0 } : t)),
      waves: units('audit', 'landing-terminal', 4),
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          zone: T3_AUDIT,
          moveTarget: 'landing-terminal',
          attackTarget: { kind: 'terminal' },
        },
      },
    }))
    await game.tick()
    expect((await game.me()).zone).toBe(T3_AUDIT)
    expect(mine(game)[0]).toMatch(
      /^Holding at Coldstore T3 \(AUDIT\): 4 enemy units hit for ~\d+\/cycle in Landing Terminal, you have \d+ — retype `attack terminal` to push in$/,
    )
  })

  it('a heal used this cycle waives the hold — it is not judged on the pre-heal INTEG', async () => {
    const game = await heldWalk(LOW, (s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, items: ['trauma_patch', null, null, null, null, null] },
      },
    }))
    game.submit({ type: 'use', item: 'trauma_patch' })
    await game.tick()
    const me = await game.me()
    expect(me.zone).toBe(T1_AUDIT)
    expect(me.attackTarget).toEqual(ICE_T1)
    expect(me.buffs.some((b) => b.id === 'trauma_patch_regen')).toBe(true)
    expect(mine(game)).toEqual([])
  })

  it('an item active that does not heal still holds', async () => {
    const game = await heldWalk(LOW, (s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, items: ['charge_tab', null, null, null, null, null] },
      },
    }))
    game.submit({ type: 'use', item: 'charge_tab' })
    await game.tick()
    expect((await game.me()).zone).toBe(CROSS)
    expect(mine(game)).toHaveLength(1)
  })

  it('a plain `move` walk is not held — only the structure approach is', async () => {
    const game = await heldWalk(LOW, (s) => ({
      ...s,
      waves: units('audit', T1_AUDIT, 4),
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, attackTarget: null } },
    }))
    await game.tick()
    expect((await game.me()).zone).toBe(T1_AUDIT)
  })

  it('is replay-safe: re-feeding the logged actions from the same state reproduces the hold', async () => {
    // Live: a TYPED order from two hops back (t1-chaff → cross → T1_AUDIT); the
    // typed hop goes, the held continuation is stopped short at the crossing.
    const game = await heldWalk(LOW, (s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          zone: 'coldstore-t1-chaff',
          moveTarget: null,
          attackTarget: null,
        },
      },
    }))
    const start = await game.state()
    game.submit({ type: 'attack', target: ICE_T1 })
    await game.tick(4)
    const live = await game.state()
    expect(live.players[HUMAN]!.zone).toBe(CROSS)
    expect(
      game.allNotices.some((n) => n.message.startsWith(`Holding at ${ZONE_MAP[CROSS]!.name}`)),
    ).toBe(true)

    // Replay: the same start state, only the action log as input.
    const log = (live.actionLog ?? []).filter((a) => a.cycle > start.cycle)
    const replayId = `${game.gameId}_replay`
    let current: GameState = start
    for (let c = start.cycle + 1; c <= live.cycle; c++) {
      for (const a of log.filter((x) => x.cycle === c)) {
        submitReplayAction(replayId, a.playerId, a.command, a.synthesized)
      }
      current = (await Effect.runPromise(processCycle(replayId, current, { replay: true }))).state
    }
    expect(current.players[HUMAN]!.zone).toBe(CROSS)
    expect(current.players[HUMAN]!.attackTarget ?? null).toBeNull()
    expect(finalSummaryHash(current)).toBe(finalSummaryHash(live))
  })
})
