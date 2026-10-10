import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import { seedGame, HUMAN, ENEMY, type Run } from './harness'
import type { GameState } from '~~/shared/types/game'
import type { TargetRef } from '~~/shared/types/commands'
import { APPROACH_HOLD_INTEG_RATIO } from '~~/shared/constants/balance'
import { processCycle, submitReplayAction } from '~~/server/game/engine/GameLoop'
import { finalSummaryHash } from '~~/server/game/engine/replayArtifact'

/**
 * Playtest 3 (Oct 2026): a standing `attack ice:` walk never aborted at low
 * INTEG — the tester walked from 250/598 straight into enemy ICE and died.
 *
 * The held ICE / Terminal approach is now safe by default: a CONTINUATION hop
 * that would step into a zone under a living enemy ICE (the base alone is not:
 * a Terminal never shoots a hero) while INTEG ≤ APPROACH_HOLD_INTEG_RATIO holds
 * one hop short — the walk and the
 * held attack are dropped, with a notice. A TYPED order is never held: retyping
 * the attack that cycle pushes in anyway.
 */

const T1_AUDIT = 'coldstore-t1-audit'
const ICE_T1: TargetRef = { kind: 'ice', zone: T1_AUDIT }
const CROSS = 'coldstore-cross'
/** A non-default cycle: nothing here may depend on the game being young. */
const LATE = 211

/** A max INTEG at which the hold ratio is a whole number of INTEG (0.35 × 600 = 210),
 *  so the boundary itself is exercised. */
const MAX = 600
/** INTEG at exactly the hold ratio (the boundary holds) or `delta` above it. */
const integAt = (_max: number, delta = 0) => Math.round(MAX * APPROACH_HOLD_INTEG_RATIO) + delta

/**
 * The human one hop short of `T1_AUDIT` (at the crossing) with the ICE walk
 * already HELD (moveTarget + attackTarget, as approachStructure leaves them),
 * at `integ`, cycle LATE. The enemy hero is parked at its own fountain.
 */
async function heldWalk(
  integ: (max: number) => number,
  patch: (s: GameState) => GameState = (s) => s,
) {
  const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
  await game.tick() // settle the first-tick maxInteg recompute
  await game.patch((s) => {
    const me = s.players[HUMAN]!
    return patch({
      ...s,
      cycle: LATE,
      waves: [],
      players: {
        ...s.players,
        [HUMAN]: {
          ...me,
          zone: CROSS,
          maxInteg: MAX,
          integ: integ(MAX),
          moveTarget: T1_AUDIT,
          attackTarget: ICE_T1,
        },
        [ENEMY]: { ...s.players[ENEMY]!, zone: 'landing-anchor' },
      },
    })
  })
  return game
}

const mine = (game: Run) =>
  game.lastNotices.filter((n) => n.playerId === HUMAN).map((n) => n.message)

describe('a held ICE walk at low INTEG holds one hop short', () => {
  it('at exactly the threshold: does not step in, drops the held orders, says why', async () => {
    const game = await heldWalk((max) => integAt(max))
    const max = (await game.me()).maxInteg
    await game.tick()
    const me = await game.me()
    expect(me.zone).toBe(CROSS)
    expect(me.moveTarget ?? null).toBeNull()
    expect(me.attackTarget ?? null).toBeNull()
    const pct = Math.round((integAt(max) / max) * 100)
    expect(mine(game)).toEqual([
      `Holding at ${CROSS}: INTEG ${pct}% — retype \`attack ice:${T1_AUDIT}\` to push in anyway`,
    ])
    // Said once: the next cycle is quiet and the hero stays put.
    await game.tick()
    expect(mine(game)).toEqual([])
    expect((await game.me()).zone).toBe(CROSS)
  })

  it('one INTEG above the threshold: walks in and swings on the next cycle, as before', async () => {
    const game = await heldWalk((max) => integAt(max, 1))
    await game.tick()
    expect((await game.me()).zone).toBe(T1_AUDIT)
    expect(mine(game)).toEqual([])
    await game.tick()
    expect(
      game.lastEvents.some(
        (e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === `ice_${T1_AUDIT}`,
      ),
    ).toBe(true)
  })

  it('retyping the order that cycle overrides the hold — the player pushes in', async () => {
    const game = await heldWalk((max) => integAt(max))
    await game.tick() // held
    game.submit({ type: 'attack', target: ICE_T1 })
    await game.tick()
    const me = await game.me()
    expect(me.zone).toBe(T1_AUDIT)
    expect(me.attackTarget).toEqual(ICE_T1)
    expect(game.lastRejected.filter((r) => r.playerId === HUMAN)).toEqual([])
  })

  it('a dead enemy ICE ahead is no reason to hold', async () => {
    const game = await heldWalk(
      (max) => integAt(max),
      (s) => ({
        ...s,
        ice: s.ice.map((t) => (t.zone === T1_AUDIT ? { ...t, alive: false, integ: 0 } : t)),
        players: {
          ...s.players,
          [HUMAN]: {
            ...s.players[HUMAN]!,
            moveTarget: 'coldstore-t2-audit',
            attackTarget: { kind: 'ice', zone: 'coldstore-t2-audit' },
          },
        },
      }),
    )
    await game.tick()
    expect((await game.me()).zone).toBe(T1_AUDIT)
    expect(mine(game)).toEqual([])
  })

  it('the Terminal walk is NOT held at the enemy base — a Terminal never shoots a hero', async () => {
    const T3_AUDIT = 'coldstore-t3-audit'
    const game = await heldWalk(
      (max) => integAt(max, -20),
      (s) => ({
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
      }),
    )
    await game.tick()
    const me = await game.me()
    expect(me.zone).toBe('landing-terminal')
    expect(me.attackTarget).toEqual({ kind: 'terminal' })
    expect(mine(game)).toEqual([])
  })

  it('a heal used this cycle waives the hold — it is not judged on the pre-heal INTEG', async () => {
    const game = await heldWalk(
      (max) => integAt(max),
      (s) => ({
        ...s,
        players: {
          ...s.players,
          [HUMAN]: { ...s.players[HUMAN]!, items: ['trauma_patch', null, null, null, null, null] },
        },
      }),
    )
    game.submit({ type: 'use', item: 'trauma_patch' })
    await game.tick()
    const me = await game.me()
    expect(me.zone).toBe(T1_AUDIT)
    expect(me.attackTarget).toEqual(ICE_T1)
    expect(me.buffs.some((b) => b.id === 'trauma_patch_regen')).toBe(true)
    expect(mine(game)).toEqual([])
  })

  it('an item active that does not heal still holds', async () => {
    const game = await heldWalk(
      (max) => integAt(max),
      (s) => ({
        ...s,
        players: {
          ...s.players,
          [HUMAN]: { ...s.players[HUMAN]!, items: ['charge_tab', null, null, null, null, null] },
        },
      }),
    )
    game.submit({ type: 'use', item: 'charge_tab' })
    await game.tick()
    expect((await game.me()).zone).toBe(CROSS)
    expect(mine(game)).toHaveLength(1)
  })

  it('a plain `move` walk is not held — only the structure approach is', async () => {
    const game = await heldWalk(
      (max) => integAt(max),
      (s) => ({
        ...s,
        players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, attackTarget: null } },
      }),
    )
    await game.tick()
    expect((await game.me()).zone).toBe(T1_AUDIT)
  })

  it('is replay-safe: re-feeding the logged actions from the same state reproduces the hold', async () => {
    // Live: a TYPED order from two hops back (t1-chaff → cross → T1_AUDIT); the
    // typed hop goes, the held continuation is stopped short at the crossing.
    const game = await heldWalk(
      (max) => integAt(max),
      (s) => ({
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
      }),
    )
    const start = await game.state()
    game.submit({ type: 'attack', target: ICE_T1 })
    await game.tick(4)
    const live = await game.state()
    expect(live.players[HUMAN]!.zone).toBe(CROSS)
    expect(game.allNotices.some((n) => n.message.startsWith(`Holding at ${CROSS}`))).toBe(true)

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
