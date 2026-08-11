import { Effect } from 'effect'
import { describe, it, expect, beforeEach } from 'vitest'
import { seedGame, ENEMY, HUMAN } from './harness'
import { submitAction, processCycle } from '~~/server/game/engine/GameLoop'
import { resetWaveIdCounter } from '~~/server/game/map/spawner'
import { mix, mulberry32 } from '~~/server/game/engine/rng'
import { NULL_POINTER_CRIT_CHANCE } from '~~/shared/constants/balance'

/**
 * THE BATCH CLOCK IS CANON: replaying the same actions against the same state
 * must always produce the same INTEG outcomes. These specs exercise the REAL
 * engine pipeline (StateManager -> GameLoop.processCycle) end to end, proving
 * `state.rngSeed` — not the day's Math.random() — governs every crit roll a
 * cycle resolves.
 *
 * `laning_combat` co-locates the human + one enemy hero so a basic attack has
 * a legal target every cycle; giving the human `null_pointer` (15% crit,
 * NULL_POINTER_CRIT_CHANCE) makes the crit roll the ONLY random draw a cycle
 * takes here — no arc_coil/bulwark_plate/concussion_hammer procs, no wave/
 * neutral/cache spawns this early — so its outcome is a precise probe of
 * which rng stream resolution actually drew from.
 */

beforeEach(() => {
  // wave-*/neutral-* ids come from module-level counters shared across every
  // game in the process (not scoped by gameId) — reset so two independently
  // seeded games spawning waves at the same cycle boundaries get the SAME
  // ids, and a real resolution divergence isn't masked by (or mistaken for)
  // cosmetic id drift left over from a previous test.
  resetWaveIdCounter()
})

/** Seed the human with Null Pointer — the one item whose on-hit proc this
 *  suite probes. Deliberately does NOT touch the enemy's HP: a per-tick stats
 *  recompute (see harness.ts's "first-tick maxInteg recompute" note) clamps
 *  integ/maxInteg back to what level+items actually produce, so inflating it
 *  here would just get silently overwritten — masking rather than isolating
 *  the crit signal. Assertions read the emitted `damage` event's amount
 *  instead of raw integ, per the same harness guidance. */
async function seedDuel() {
  const run = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
  await run.patch((s) => ({
    ...s,
    players: {
      ...s.players,
      [HUMAN]: {
        ...s.players[HUMAN]!,
        items: ['null_pointer', null, null, null, null, null],
      },
    },
  }))
  return run
}

/**
 * Search for a seed whose FIRST-cycle draw (`mix(seed, 1)` through
 * `mulberry32`) lands on the wanted side of `threshold` — the exact rng
 * derivation GameLoop.processCycle uses on a fresh game's first tick
 * (cycle 0 -> 1). This makes the divergence assertion below a proof, not a
 * probabilistic hope: the two seeds are chosen because they PROVABLY roll a
 * crit and a non-crit respectively, not because enough draws piled up to make
 * a coincidence unlikely.
 */
function findSeedForFirstCycleDraw(wantBelowThreshold: boolean, threshold: number): number {
  for (let seed = 0; seed < 100_000; seed++) {
    const draw = mulberry32(mix(seed, 1))()
    if (draw < threshold === wantBelowThreshold) return seed
  }
  throw new Error('no seed found in search range — widen the range or check the rng derivation')
}

describe('resolution determinism (rngSeed)', () => {
  it('same rngSeed + same actions -> identical player/wave/neutral state after 20 cycles', async () => {
    const seed = 424_242

    const runA = await seedDuel()
    await runA.patch((s) => ({ ...s, rngSeed: seed }))
    runA.attackHero(ENEMY)
    await runA.tick(20)
    const stateA = await runA.state()

    resetWaveIdCounter()

    const runB = await seedDuel()
    await runB.patch((s) => ({ ...s, rngSeed: seed }))
    runB.attackHero(ENEMY)
    await runB.tick(20)
    const stateB = await runB.state()

    expect(stateA.players).toEqual(stateB.players)
    expect(stateA.waves).toEqual(stateB.waves)
    expect(stateA.neutrals).toEqual(stateB.neutrals)
  })

  it('different rngSeed -> the crit roll provably diverges on the very first cycle', async () => {
    // Guaranteed by construction, not by probability: seedCrit's first-cycle
    // draw is < NULL_POINTER_CRIT_CHANCE (rolls the crit), seedNoCrit's is not.
    const seedCrit = findSeedForFirstCycleDraw(true, NULL_POINTER_CRIT_CHANCE)
    const seedNoCrit = findSeedForFirstCycleDraw(false, NULL_POINTER_CRIT_CHANCE)
    expect(seedCrit).not.toBe(seedNoCrit)

    const runA = await seedDuel()
    await runA.patch((s) => ({ ...s, rngSeed: seedCrit }))
    runA.attackHero(ENEMY)
    await runA.tick(1)

    const runB = await seedDuel()
    await runB.patch((s) => ({ ...s, rngSeed: seedNoCrit }))
    runB.attackHero(ENEMY)
    await runB.tick(1)

    // Read the amount straight off the emitted damage event rather than raw
    // post-tick integ: a per-tick stats recompute clamps integ/maxInteg to
    // what level+items produce, which would otherwise wash out the delta
    // we're trying to observe (see the harness's "first-tick maxInteg
    // recompute" gotcha).
    const dmgA = runA.lastEvents.find((e) => e._tag === 'damage' && e.targetId === ENEMY)
    const dmgB = runB.lastEvents.find((e) => e._tag === 'damage' && e.targetId === ENEMY)
    expect(dmgA?.amount).toBeGreaterThan(0)
    expect(dmgB?.amount).toBeGreaterThan(0)
    // Same attacker, same target, same starting state, same action — only the
    // seed differs. A crit landing on one side and not the other must deal
    // different damage (NULL_POINTER_CRIT_MULTIPLIER, applied before
    // mitigation, is large enough that post-mitigation rounding can't erase it).
    expect(dmgA?.amount).not.toBe(dmgB?.amount)
  })

  it('an old snapshot without rngSeed still resolves deterministically (gameId hash fallback)', async () => {
    // Simulates a pre-seed snapshot resumed after this feature shipped:
    // rngSeed is absent, so processCycle must fall back to a stable hash of
    // the gameId (hashStringToSeed) — deterministic given the same gameId,
    // not a fresh Math.random() draw every tick.
    //
    // Drives processCycle directly (bypassing the harness's Run wrapper,
    // which mints a fresh gameId per seedGame call) so both invocations below
    // can deliberately reuse ONE gameId and thereby the same fallback seed —
    // exactly the condition under test. Sequential and non-overlapping (no
    // second Run's submissions ever land in between), so it doesn't trip the
    // "unique gameId per Run" invariant the harness itself relies on.
    const template = await seedDuel()
    const templateState = await template.state()
    const { rngSeed: _drop, ...startState } = templateState
    expect(startState.rngSeed).toBeUndefined()

    const gameId = 'rng_fallback_probe'
    const attackCmd = { type: 'attack' as const, target: { kind: 'hero' as const, name: ENEMY } }

    submitAction(gameId, HUMAN, attackCmd)
    const result1 = await Effect.runPromise(processCycle(gameId, startState))

    submitAction(gameId, HUMAN, attackCmd)
    const result2 = await Effect.runPromise(processCycle(gameId, startState))

    expect(result1.state.players).toEqual(result2.state.players)
  })
})
