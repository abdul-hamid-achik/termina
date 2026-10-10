import { describe, it, expect, afterEach, vi } from 'vitest'
import { Effect } from 'effect'
import { seedGame, HUMAN, ENEMY, Run } from './harness'
import { createInMemoryStateManager } from '~~/server/game/engine/StateManager'
import { resetWaveIdCounter } from '~~/server/game/map/spawner'
import { registerBots, cleanupGame } from '~~/server/game/ai/BotManager'
import { HERO_IDS } from '~~/shared/constants/heroes'
import {
  WAVE_XP,
  WAVE_XP_SHARED,
  BURN_XP_RATIO,
  HERO_KILL_XP_BASE,
  HERO_KILL_XP_PER_LEVEL,
  ASSIST_XP_RATIO,
  SILT_DWELLERS,
  XP_CATCHUP_MAX,
  waveUnitMaxHp,
} from '~~/shared/constants/balance'
import type { PlayerState } from '~~/shared/types/game'

/**
 * Individual XP catch-up (playtest 5): a human who never last-hit was Lv1 at
 * 5:00 and Lv2 at 10:00 while their allied bots were Lv5–7. A hero below their
 * own team's average level (teammates only, alive or dead) now earns
 * ×(1 + XP_CATCHUP_PER_LEVEL × levels behind), capped at ×XP_CATCHUP_MAX, on
 * EVERY XP grant — and nothing extra at or above the average.
 *
 * Fixture: human L1 + one ally L3 → the human is 2 levels behind → ×2.0 (the
 * cap). The ally is ahead → ×1. The enemy is L2 so the TEAM comeback on kill
 * XP is neutral (chaff avg 2 vs audit avg 2) and only the individual rule
 * moves the numbers.
 */

const ALLY = 'ally'
/** Not a wave/neutral/cache spawn cycle once ticked — nothing else pays XP. */
const QUIET = 211
const ZONE = 'coldstore-cross'

async function seedBehind(humanLevel = 1): Promise<Run> {
  const game = await seedGame('fresh', {
    players: [
      { id: HUMAN, name: HUMAN, team: 'chaff', heroId: 'echo' },
      { id: ALLY, name: ALLY, team: 'chaff', heroId: 'regex' },
      { id: ENEMY, name: ENEMY, team: 'audit', heroId: 'daemon' },
    ],
  })
  await game.patch((s) => {
    const at = (p: PlayerState, zone: string, level: number): PlayerState => ({
      ...p,
      zone,
      level,
      xp: 0,
      alive: true,
      integ: p.maxInteg,
    })
    return {
      ...s,
      cycle: QUIET,
      waves: [],
      neutrals: [],
      players: {
        ...s.players,
        [HUMAN]: at(s.players[HUMAN]!, ZONE, humanLevel),
        // Far away by default — a test that needs the ally on site moves it.
        [ALLY]: at(s.players[ALLY]!, 'rookery-anchor', 3),
        [ENEMY]: at(s.players[ENEMY]!, 'landing-anchor', 2),
      },
    }
  })
  return game
}

const xpOf = async (game: Run, id: string = HUMAN) => (await game.player(id)).xp

describe('xp catch-up: every XP source pays a behind hero their multiplier', () => {
  it('wave strip (last hit): WAVE_XP × cap', async () => {
    const game = await seedBehind()
    await game.patch((s) => ({
      ...s,
      waves: [{ id: 'u', team: 'audit', zone: ZONE, integ: 1, type: 'line' }],
    }))
    game.submit({ type: 'attack', target: { kind: 'wave', index: 0 } })
    await game.tick()
    expect(await xpOf(game)).toBe(WAVE_XP * XP_CATCHUP_MAX)
  })

  it('…and a hero LEVEL with their team strips for exactly WAVE_XP (no bonus)', async () => {
    const game = await seedBehind(3)
    await game.patch((s) => ({
      ...s,
      waves: [{ id: 'u', team: 'audit', zone: ZONE, integ: 1, type: 'line' }],
    }))
    game.submit({ type: 'attack', target: { kind: 'wave', index: 0 } })
    await game.tick()
    expect(await xpOf(game)).toBe(WAVE_XP)
  })

  it('…and a hero AHEAD of their team strips for exactly WAVE_XP (no penalty)', async () => {
    const game = await seedBehind(6)
    await game.patch((s) => ({
      ...s,
      waves: [{ id: 'u', team: 'audit', zone: ZONE, integ: 1, type: 'line' }],
    }))
    game.submit({ type: 'attack', target: { kind: 'wave', index: 0 } })
    await game.tick()
    expect(await xpOf(game)).toBe(WAVE_XP)
  })

  it('presence on an ally’s strip: WAVE_XP_SHARED × cap to the behind hero, base to the ally', async () => {
    const game = await seedBehind()
    await game.patch((s) => ({
      ...s,
      waves: [{ id: 'u', team: 'audit', zone: ZONE, integ: 1, type: 'line' }],
      players: { ...s.players, [ALLY]: { ...s.players[ALLY]!, zone: ZONE } },
    }))
    game.submit({ type: 'attack', target: { kind: 'wave', index: 0 } }, ALLY)
    await game.tick()
    expect(await xpOf(game)).toBe(WAVE_XP_SHARED * XP_CATCHUP_MAX)
    expect(await xpOf(game, ALLY)).toBe(WAVE_XP) // ahead of the team → ×1
  })

  it('presence on a wave-on-wave kill (WaveAI): WAVE_XP_SHARED × cap', async () => {
    const game = await seedBehind()
    await game.patch((s) => ({
      ...s,
      waves: [
        { id: 'mine', team: 'chaff', zone: ZONE, integ: 400, type: 'line' },
        { id: 'theirs', team: 'audit', zone: ZONE, integ: 1, type: 'line' },
      ],
    }))
    await game.tick()
    expect((await game.state()).waves.some((w) => w.id === 'theirs')).toBe(false)
    expect(await xpOf(game)).toBe(WAVE_XP_SHARED * XP_CATCHUP_MAX)
  })

  it('presence on an ICE kill (IceAI): WAVE_XP_SHARED × cap', async () => {
    const T1 = 'coldstore-t1-chaff'
    const game = await seedBehind()
    await game.patch((s) => ({
      ...s,
      waves: [
        {
          id: 'fodder',
          team: 'audit',
          zone: T1,
          integ: 1,
          maxInteg: waveUnitMaxHp('line', QUIET),
          type: 'line',
        },
      ],
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: T1 } },
    }))
    await game.tick()
    expect((await game.state()).waves.some((w) => w.id === 'fodder')).toBe(false)
    expect(await xpOf(game)).toBe(WAVE_XP_SHARED * XP_CATCHUP_MAX)
  })

  it('burn: the burn XP × cap', async () => {
    const game = await seedBehind()
    await game.patch((s) => ({
      ...s,
      waves: [{ id: 'own', team: 'chaff', zone: ZONE, integ: 20, type: 'line' }],
    }))
    game.submit({ type: 'burn', target: { kind: 'wave', index: 0 } })
    await game.tick()
    expect(await xpOf(game)).toBe(Math.floor(WAVE_XP * BURN_XP_RATIO) * XP_CATCHUP_MAX)
  })

  it('Silt dweller kill: the camp XP × cap', async () => {
    const game = await seedBehind()
    await game.patch((s) => ({
      ...s,
      neutrals: [
        {
          id: 'camp0',
          zone: 'silt-chaff-upper',
          integ: 1,
          maxInteg: 250,
          type: 'stub',
          alive: true,
        },
      ],
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'silt-chaff-upper' } },
    }))
    game.submit({ type: 'attack', target: { kind: 'neutral', index: 0 } })
    await game.tick()
    expect(await xpOf(game)).toBe(SILT_DWELLERS.stub.xp * XP_CATCHUP_MAX)
  })

  it('hero kill + assist: each recipient gets THEIR OWN multiplier (the killer’s never leaks into the assist)', async () => {
    const game = await seedBehind()
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [ALLY]: { ...s.players[ALLY]!, zone: ZONE },
        [ENEMY]: { ...s.players[ENEMY]!, zone: ZONE },
      },
    }))
    // Cycle 1: the ally chips the enemy → a windowed assist contributor.
    game.attackHero(ENEMY, ALLY)
    await game.tick()
    expect((await game.player(ENEMY)).alive).toBe(true)
    // Cycle 2: the human (behind, ×2) finishes it; the ally (ahead, ×1) assists.
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [ENEMY]: { ...s.players[ENEMY]!, integ: 1 },
        [ALLY]: { ...s.players[ALLY]!, attackTarget: null },
      },
    }))
    const humanBefore = await xpOf(game)
    const allyBefore = await xpOf(game, ALLY)
    game.attackHero(ENEMY, HUMAN)
    await game.tick()
    expect((await game.player(ENEMY)).alive).toBe(false)

    const baseKill = HERO_KILL_XP_BASE + HERO_KILL_XP_PER_LEVEL * 2 // victim L2, team comeback ×1
    expect((await xpOf(game)) - humanBefore).toBe(baseKill * XP_CATCHUP_MAX)
    expect((await xpOf(game, ALLY)) - allyBefore).toBe(Math.floor(baseKill * ASSIST_XP_RATIO))
  })
})

// --- the playtest, replayed ------------------------------------------------

/** Deterministic Math.random for bot AI (bots are deliberately off the engine rng). */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const live: string[] = []
afterEach(() => {
  for (const id of live.splice(0)) cleanupGame(id)
  vi.restoreAllMocks()
})

/**
 * 5v5: the human (echo) never swings — it stands on the COLDSTORE crossing,
 * where the waves meet, and retreats to the anchor below 30% INTEG — while nine
 * medium bots play the game. Returns the human's level and the allied bots'
 * average at each mark. (Without catch-up this reproduces the playtest exactly:
 * Lv1 at cycle 75, Lv2 at cycle 150.)
 */
async function passiveHumanGame(seed: number, marks: number[]) {
  vi.spyOn(Math, 'random').mockImplementation(mulberry32(seed * 7919))
  const pool = HERO_IDS.filter((h) => h !== 'echo')
  const roster = [
    { id: HUMAN, name: HUMAN, team: 'chaff' as const, heroId: 'echo' },
    ...[0, 1, 2, 3].map((i) => ({
      id: `bot_r${i}`,
      name: `bot_r${i}`,
      team: 'chaff' as const,
      heroId: pool[i]!,
    })),
    ...[0, 1, 2, 3, 4].map((i) => ({
      id: `bot_d${i}`,
      name: `bot_d${i}`,
      team: 'audit' as const,
      heroId: pool[4 + i]!,
    })),
  ]
  // A FIXED gameId (the engine rng is derived from it) and a reset wave-id
  // counter, so the run does not depend on which tests ran before it.
  resetWaveIdCounter()
  const gameId = `xp_catchup_${seed}`
  const sm = createInMemoryStateManager()
  await Effect.runPromise(sm.createGame(gameId, roster))
  await Effect.runPromise(sm.updateState(gameId, (s) => ({ ...s, phase: 'playing' as const })))
  const game = new Run(sm, gameId)
  live.push(gameId)
  registerBots(
    game.gameId,
    roster.filter((p) => p.id !== HUMAN).map((p) => ({ ...p, playerId: p.id })),
    { difficulty: 'medium' },
  )
  const HOME = 'coldstore-cross'
  const ANCHOR = 'rookery-anchor'
  let recovering = false
  const out: Record<number, { human: number; allies: number }> = {}
  const last = Math.max(...marks)
  for (let c = 0; c < last; c++) {
    const s = await game.state()
    const me = s.players[HUMAN]!
    if (me.alive) {
      const hp = me.integ / me.maxInteg
      if (recovering && hp >= 0.8) recovering = false
      if (!recovering && hp < 0.3) recovering = true
      const goal = recovering ? ANCHOR : HOME
      if (me.zone !== goal && me.moveTarget !== goal) game.submit({ type: 'move', zone: goal })
    }
    await game.tick()
    const after = await game.state()
    if (marks.includes(after.cycle)) {
      const allies = Object.values(after.players).filter(
        (p) => p.team === 'chaff' && p.id !== HUMAN,
      )
      out[after.cycle] = {
        human: after.players[HUMAN]!.level,
        allies: allies.reduce((sum, p) => sum + p.level, 0) / allies.length,
      }
    }
  }
  return out
}

describe('xp catch-up: the playtest-5 passive human', () => {
  it('a human who never last-hits gets a meaningful lift by 5:00 and 10:00', async () => {
    // The same eight seeds under the old rule (XP_CATCHUP_PER_LEVEL = 0): Lv1
    // at cycle 75 in 8/8 and Lv1–2 at cycle 150 in 6/8, against allied averages
    // of ~3.2 and ~6.4 — the playtest, reproduced. With catch-up: Lv2 at 75 and
    // Lv3 at 150 in 7/8. A seed can still be unlucky (the human dies a lot and
    // ×2 of nothing is nothing), hence a count, not every seed.
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8]
    const runs = []
    for (const seed of seeds) runs.push(await passiveHumanGame(seed, [75, 150]))
    const why = JSON.stringify(runs.map((at) => [at[75]!.human, at[150]!.human]))
    expect(runs.filter((at) => at[75]!.human >= 2).length, why).toBeGreaterThanOrEqual(6)
    expect(runs.filter((at) => at[150]!.human >= 3).length, why).toBeGreaterThanOrEqual(6)
  }, 60_000)
})
