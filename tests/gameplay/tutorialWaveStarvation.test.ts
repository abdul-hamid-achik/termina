import { describe, it, expect, afterEach } from 'vitest'
import { Effect } from 'effect'
import { Run } from './harness'
import { createInMemoryStateManager } from '~~/server/game/engine/StateManager'
import { processCycle } from '~~/server/game/engine/GameLoop'
import { applyScenario } from '~~/server/game/dev/scenarios'
import { registerBots, cleanupGame } from '~~/server/game/ai/BotManager'
import { buildTutorialRoster } from '~~/server/game/modes/tutorial'
import {
  TUTORIAL_FLOW,
  TUTORIAL_FIRST_MOVE_ZONE,
  TUTORIAL_STEP_DEADLINE_CYCLES,
  isTrainingWave,
} from '~~/shared/constants/tutorial'
import {
  STRIP_HP_THRESHOLD,
  BURN_HP_THRESHOLD,
  MAX_WAVE_UNITS_PER_ZONE_PER_TEAM,
  waveUnitMaxHp,
} from '~~/shared/constants/balance'
import type { GameState } from '~~/shared/types/game'

/**
 * LIVE REGRESSION (Oct 2026 playtest): the real tutorial — guest ECHO, mode
 * 'tutorial', one_lane, 2v2 easy bots pinned to coldstore — starved the strip
 * and burn drills of waves. The player parks at `coldstore-t2-chaff` (where the
 * first step sends them); the lines meet at the crossing and die there, and the
 * tutorial's own nudge was planted at step 3.4 — BEFORE the same tick's
 * WaveAI/IceAI pass — so the enemy practice unit was shot dead by the player's
 * own T2 ICE, and the own unit walked off to T1, before anything was shown.
 * The burn coaching also claimed "one of yours is low right now" over an empty
 * zone. These tests play the drills the way the playtester did: read the SCREEN
 * (end-of-tick state), type only what the coaching says.
 */

const HUMAN = 'human_1'
const stepIndex = (id: (typeof TUTORIAL_FLOW)[number]['id']): number =>
  TUTORIAL_FLOW.findIndex((s) => s.id === id)

/** A Run whose tick also keeps the tutorial notices pushed to the human. */
class NoticeRun extends Run {
  lastNotices: string[] = []
  constructor(
    private readonly store: ReturnType<typeof createInMemoryStateManager>,
    gameId: string,
  ) {
    super(store, gameId, HUMAN)
  }
  override async tick(n = 1): Promise<this> {
    for (let i = 0; i < n; i++) {
      const state = await Effect.runPromise(this.store.getState(this.gameId))
      const result = await Effect.runPromise(processCycle(this.gameId, state))
      await Effect.runPromise(this.store.updateState(this.gameId, () => result.state))
      this.lastEvents = result.events
      this.allEvents.push(...result.events)
      this.lastRejected = result.rejectedActions
      this.lastNotices = result.notices.filter((x) => x.playerId === HUMAN).map((x) => x.message)
    }
    return this
  }
}

const live: string[] = []
afterEach(() => {
  for (const id of live.splice(0)) cleanupGame(id)
})

/** The live roster exactly: buildTutorialRoster + easy bots pinned to coldstore. */
async function seedLiveTutorial(heroId = 'echo'): Promise<NoticeRun> {
  const gameId = `tut_live_${Math.random().toString(36).slice(2, 8)}`
  const roster = buildTutorialRoster(HUMAN, heroId, gameId)
  const sm = createInMemoryStateManager()
  await Effect.runPromise(
    sm.createGame(
      gameId,
      roster.map((p) => ({ id: p.playerId, name: p.playerId, team: p.team, heroId: p.heroId })),
      { mapId: 'one_lane', mode: 'tutorial' },
    ),
  )
  await Effect.runPromise(
    sm.updateState(gameId, (s) =>
      applyScenario({ ...s, phase: 'playing' as const }, 'fresh', { humanId: HUMAN }),
    ),
  )
  registerBots(
    gameId,
    roster.filter((p) => p.playerId !== HUMAN),
    { forceLane: 'coldstore', difficulty: 'easy' },
  )
  live.push(gameId)
  return new NoticeRun(sm, gameId)
}

/** Waves in the human's zone, in the order the `wave:N` index counts them. */
const zoneWaves = (s: GameState) => s.waves.filter((w) => w.zone === s.players[HUMAN]!.zone)

/** What the screen offers: the first unit the drill can act on, as the index to type. */
function offered(s: GameState, kind: 'strip' | 'burn'): number {
  const human = s.players[HUMAN]!
  const team = kind === 'strip' ? (human.team === 'chaff' ? 'audit' : 'chaff') : human.team
  const frac = kind === 'strip' ? STRIP_HP_THRESHOLD : BURN_HP_THRESHOLD
  return zoneWaves(s).findIndex(
    (w) =>
      w.team === team && w.integ > 0 && w.integ <= (w.maxInteg ?? waveUnitMaxHp(w.type, 0)) * frac,
  )
}

/**
 * Play from the fountain the way the playtester did: type the taught commands,
 * then PARK at the first-move zone. `lag` = cycles between seeing a target and
 * typing the command (a human is slower than one 4s cycle).
 */
async function playToBurnDone(game: NoticeRun, lag: number, maxCycles = 140) {
  const trace: Array<{ cycle: number; step: number; notices: string[] }> = []
  let seenSince = -1
  let stripDoneAt = -1
  let burnDoneAt = -1
  let attackSwung = false
  game.submit({ type: 'move', zone: TUTORIAL_FIRST_MOVE_ZONE })
  for (let c = 0; c < maxCycles; c++) {
    await game.tick()
    const s = await game.state()
    trace.push({ cycle: s.cycle, step: s.tutorialStep ?? 0, notices: game.lastNotices })
    const step = s.tutorialStep ?? 0
    if (step > stepIndex('burn') && burnDoneAt < 0) burnDoneAt = s.cycle
    if (step > stepIndex('strip') && stripDoneAt < 0) stripDoneAt = s.cycle
    if (step > stepIndex('burn')) break
    const id = TUTORIAL_FLOW[step]!.id
    if (id === 'attack') {
      const i = zoneWaves(s).findIndex((w) => w.team === 'audit' && w.integ > 0)
      if (i >= 0 && !attackSwung)
        game.submit({ type: 'attack', target: { kind: 'wave', index: i } })
      continue
    }
    if (id === 'strip' || id === 'burn') {
      const i = offered(s, id)
      if (i < 0) {
        seenSince = -1
        continue
      }
      if (seenSince < 0) seenSince = c
      if (c - seenSince >= lag) {
        game.submit(
          id === 'strip'
            ? { type: 'attack', target: { kind: 'wave', index: i } }
            : { type: 'burn', target: { kind: 'wave', index: i } },
        )
      }
    }
  }
  return { trace, stripDoneAt, burnDoneAt }
}

describe('tutorial strip/burn drills are not starved of waves (live regression)', () => {
  for (const lag of [0, 2]) {
    it(`a player parked at ${TUTORIAL_FIRST_MOVE_ZONE} (typing ${lag} cycle(s) after seeing a target) strips and burns within a few cycles, no skips`, async () => {
      const game = await seedLiveTutorial()
      const { trace, stripDoneAt, burnDoneAt } = await playToBurnDone(game, lag)
      const s = await game.state()

      expect(s.tutorialSkips ?? 0).toBe(0)
      expect(stripDoneAt, 'strip never completed').toBeGreaterThan(0)
      expect(burnDoneAt, 'burn never completed').toBeGreaterThan(0)

      // "A few cycles": measure each drill from the cycle its step opened.
      const openedAt = (stepId: 'strip' | 'burn') =>
        trace.find((t) => t.step === stepIndex(stepId))?.cycle ?? Infinity
      expect(stripDoneAt - openedAt('strip')).toBeLessThanOrEqual(10)
      expect(burnDoneAt - openedAt('burn')).toBeLessThanOrEqual(10)
    })
  }

  it('every "wave:N" the coaching names is a real, in-window unit in the zone on the very screen it is shown', async () => {
    const game = await seedLiveTutorial()
    game.submit({ type: 'move', zone: TUTORIAL_FIRST_MOVE_ZONE })
    let checked = 0
    for (let c = 0; c < 140; c++) {
      await game.tick()
      const s = await game.state()
      const step = s.tutorialStep ?? 0
      if (step > stepIndex('burn')) break
      const id = TUTORIAL_FLOW[step]?.id
      for (const text of game.lastNotices) {
        const m = text.match(/`(attack|burn) wave:(\d+)`/)
        if (!m || (id !== 'strip' && id !== 'burn')) continue
        // The notice carries the ACTION for the step it belongs to.
        const wantStrip = m[1] === 'attack'
        if (wantStrip !== (id === 'strip')) continue
        // Only lines that CLAIM a unit exist now (the generic fallbacks are
        // allowed to say `wave:N`, a placeholder, never a number).
        const unit = zoneWaves(s)[Number(m[2])]
        expect(unit, `notice "${text}" names wave:${m[2]} but the zone has none`).toBeDefined()
        expect(zoneWaves(s).indexOf(unit!)).toBe(Number(m[2]))
        expect(offered(s, id)).toBe(Number(m[2]))
        checked++
      }
      // Keep the drills moving so the loop reaches burn.
      const i = id === 'strip' || id === 'burn' ? offered(s, id) : -1
      if (id === 'attack') {
        const a = zoneWaves(s).findIndex((w) => w.team === 'audit' && w.integ > 0)
        if (a >= 0) game.submit({ type: 'attack', target: { kind: 'wave', index: a } })
      } else if (i >= 0 && c % 3 === 0) {
        game.submit(
          id === 'strip'
            ? { type: 'attack', target: { kind: 'wave', index: i } }
            : { type: 'burn', target: { kind: 'wave', index: i } },
        )
      }
    }
    expect(checked, 'the coaching never named a concrete unit').toBeGreaterThan(0)
  })

  it('never says a burnable unit exists when the zone is clear (state-true copy)', async () => {
    const game = await seedLiveTutorial()
    // Park the human at T2 with the burn drill open and an EMPTY world: no
    // waves, bots far from the zone. The old copy still said "one of yours is
    // low right now" at the deadline.
    await game.patch((s) => ({
      ...s,
      tutorialStep: stepIndex('burn'),
      tutorialStepSince: s.cycle,
      waves: [],
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, zone: TUTORIAL_FIRST_MOVE_ZONE, alive: true },
      },
    }))
    for (let c = 0; c < 30; c++) {
      await game.tick()
      const s = await game.state()
      if ((s.tutorialStep ?? 0) !== stepIndex('burn')) break
      for (const text of game.lastNotices) {
        if (/low right now/i.test(text)) {
          expect(
            offered(s, 'burn'),
            `"${text}" with no burnable unit in the zone`,
          ).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })

  for (const heroId of ['kernel', 'regex']) {
    it(`${heroId}: the same parked player strips and burns with no skips`, async () => {
      const game = await seedLiveTutorial(heroId)
      const { stripDoneAt, burnDoneAt } = await playToBurnDone(game, 1)
      expect(stripDoneAt).toBeGreaterThan(0)
      expect(burnDoneAt).toBeGreaterThan(0)
      expect((await game.state()).tutorialSkips ?? 0).toBe(0)
    })
  }

  it('a training unit is INERT to the NPC pass: your ICE does not shoot it, waves do not fight or move it', async () => {
    const game = await seedLiveTutorial()
    const unit = (id: string, team: 'chaff' | 'audit') => ({
      id,
      team,
      zone: TUTORIAL_FIRST_MOVE_ZONE,
      integ: 100,
      maxInteg: waveUnitMaxHp('line', 0),
      type: 'line' as const,
    })
    // A training unit of each crew in the human's zone, with a REAL enemy wave
    // beside them (it attacks whatever enemy wave it finds) and the zone's own ICE.
    await game.patch((s) => ({
      ...s,
      // Past the unit drills: nothing here is touched by the tutorial hook.
      tutorialStep: stepIndex('tap'),
      tutorialStepSince: s.cycle,
      waves: [
        unit('wave-tut-audit-1', 'audit'),
        unit('wave-tut-chaff-1', 'chaff'),
        unit('wave-real-chaff', 'chaff'),
      ],
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, zone: TUTORIAL_FIRST_MOVE_ZONE, alive: true },
      },
    }))
    for (let i = 0; i < 6; i++) {
      await game.tick()
      const s = await game.state()
      // Keep tutorial copy out of it: only the engine's NPC pass is under test.
      const training = s.waves.filter(isTrainingWave)
      expect(training.map((w) => [w.id, w.zone, w.integ])).toEqual([
        ['wave-tut-audit-1', TUTORIAL_FIRST_MOVE_ZONE, 100],
        ['wave-tut-chaff-1', TUTORIAL_FIRST_MOVE_ZONE, 100],
      ])
    }
  })

  it('the drill notice names the unit on the broadcast even when the zone is at the wave cap', async () => {
    // The cap (enforceWaveZoneCap) evicts the OLDEST unit of a crowded
    // team+zone, and the planted unit sits first in the array. It used to be
    // planted before the cap ran, so the notice named a unit that was gone by
    // broadcast — and the next cycle planted (and announced) a fresh one.
    const game = await seedLiveTutorial()
    const full = waveUnitMaxHp('line', 0)
    await game.patch((s) => ({
      ...s,
      tutorialStep: stepIndex('strip'),
      tutorialStepSince: s.cycle - 10,
      waves: Array.from({ length: MAX_WAVE_UNITS_PER_ZONE_PER_TEAM }, (_, i) => ({
        id: `wave-crowd-${i}`,
        team: 'audit' as const,
        zone: TUTORIAL_FIRST_MOVE_ZONE,
        integ: full,
        maxInteg: full,
        type: 'line' as const,
      })),
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, zone: TUTORIAL_FIRST_MOVE_ZONE, alive: true },
      },
    }))
    const plantedIds = new Set<string>()
    let named = 0
    for (let c = 0; c < 4; c++) {
      await game.tick()
      const s = await game.state()
      expect(s.tutorialStep).toBe(stepIndex('strip'))
      const training = zoneWaves(s).filter(isTrainingWave)
      expect(training, 'the drill unit is on the broadcast').toHaveLength(1)
      plantedIds.add(training[0]!.id)
      for (const text of game.lastNotices) {
        const m = text.match(/`attack wave:(\d+)`/)
        if (!m) continue
        expect(zoneWaves(s)[Number(m[1])], `"${text}" names a unit not on the screen`).toBe(
          training[0],
        )
        named++
      }
    }
    expect(named, 'the plant was announced').toBeGreaterThan(0)
    // One unit, kept — not evicted and re-planted (and re-announced) each cycle.
    expect([...plantedIds]).toHaveLength(1)
  })
})

describe('tutorial notices are built after the NPC pass', () => {
  it("a deadline notice never names a natural unit the same cycle's ICE shot down", async () => {
    // A natural enemy unit, inside the strip window, stands in the human's
    // zone under the human's own ICE as the strip deadline fires. The notice
    // used to be composed before WaveAI/IceAI — naming that unit as `wave:0`
    // — and the ICE shot it dead before the broadcast.
    const game = await seedLiveTutorial()
    const s0 = await game.state()
    const full = waveUnitMaxHp('line', 0)
    const far = Object.fromEntries(
      Object.entries(s0.players).map(([id, p]) => [
        id,
        id === HUMAN
          ? { ...p, zone: TUTORIAL_FIRST_MOVE_ZONE, alive: true }
          : { ...p, zone: p.team === 'chaff' ? 'rookery-terminal' : 'landing-terminal' },
      ]),
    )
    await game.patch((s) => ({
      ...s,
      tutorialStep: stepIndex('strip'),
      // Next tick is exactly the first deadline (help + unit line).
      tutorialStepSince: s.cycle + 1 - TUTORIAL_STEP_DEADLINE_CYCLES,
      waves: [
        {
          id: 'wave-natural-1',
          team: 'audit' as const,
          zone: TUTORIAL_FIRST_MOVE_ZONE,
          integ: 5,
          maxInteg: full,
          type: 'line' as const,
        },
      ],
      players: far,
    }))
    await game.tick()
    const s = await game.state()
    expect(
      s.waves.some((w) => w.id === 'wave-natural-1'),
      'fixture: the ICE kills it',
    ).toBe(false)
    const named = game.lastNotices.flatMap((t) => [...t.matchAll(/`attack wave:(\d+)`/g)])
    expect(named.length, 'the deadline notice names a unit').toBeGreaterThan(0)
    for (const m of named) {
      const unit = zoneWaves(s)[Number(m[1])]
      expect(unit, `notice names wave:${m[1]} — gone by broadcast`).toBeDefined()
      expect(offered(s, 'strip')).toBe(Number(m[1]))
    }
  })
})

describe('tutorial training units belong to the human drill alone', () => {
  it('no bot strips, burns or damages a training unit (the replanted unit is not a scrip pump)', async () => {
    // The playtest shape: the human parks at the first-move zone, swings once
    // for the attack drill, then idles through strip / burn while the
    // tutorial keeps replanting the drill unit beside the ally bot.
    const game = await seedLiveTutorial()
    game.submit({ type: 'move', zone: TUTORIAL_FIRST_MOVE_ZONE })
    let sawTraining = 0
    for (let c = 0; c < 160; c++) {
      await game.tick()
      const s = await game.state()
      const step = TUTORIAL_FLOW[s.tutorialStep ?? 0]?.id
      if (step === 'attack') {
        const i = zoneWaves(s).findIndex((w) => w.team === 'audit' && w.integ > 0)
        if (i >= 0) game.submit({ type: 'attack', target: { kind: 'wave', index: i } })
      }
      if (s.waves.some(isTrainingWave)) sawTraining++
    }
    expect(sawTraining, 'the drills never planted a unit').toBeGreaterThan(10)
    const foreign = game.allEvents.filter((e) => {
      if (e._tag === 'wave_strip' || e._tag === 'wave_burn') {
        return isTrainingWave({ id: e.waveId }) && e.playerId !== HUMAN
      }
      if (e._tag === 'damage') {
        return isTrainingWave({ id: String(e.targetId) }) && e.sourceId !== HUMAN
      }
      return false
    })
    expect(foreign).toEqual([])
  })

  it("the human's strip of a training unit pays them (the drill's +scrip) and no lane-mate", async () => {
    const game = await seedLiveTutorial()
    const allyId = Object.keys((await game.state()).players).find((id) =>
      id.startsWith('bot_ally'),
    )!
    const full = waveUnitMaxHp('line', 0)
    await game.patch((s) => ({
      ...s,
      tutorialStep: stepIndex('strip'),
      tutorialStepSince: s.cycle,
      waves: [
        {
          id: 'wave-tut-audit-1',
          team: 'audit' as const,
          zone: TUTORIAL_FIRST_MOVE_ZONE,
          integ: 1,
          maxInteg: full,
          type: 'line' as const,
        },
      ],
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, zone: TUTORIAL_FIRST_MOVE_ZONE, alive: true },
        // Held in place (stunned) so it is standing in the zone when the unit falls.
        [allyId]: {
          ...s.players[allyId]!,
          zone: TUTORIAL_FIRST_MOVE_ZONE,
          alive: true,
          buffs: [{ id: 'stun', stacks: 1, cyclesRemaining: 3, source: allyId }],
        },
      },
    }))
    const before = await game.state()
    game.submit({ type: 'attack', target: { kind: 'wave', index: 0 } })
    await game.tick()
    const strip = game.lastEvents.find((e) => e._tag === 'wave_strip')
    expect(strip).toMatchObject({ playerId: HUMAN, waveId: 'wave-tut-audit-1' })
    expect(strip && strip._tag === 'wave_strip' ? strip.scripAwarded : 0).toBeGreaterThan(0)
    const after = await game.state()
    expect(after.tutorialStep).toBe(stepIndex('strip') + 1)
    expect(after.players[allyId]!.zone, 'fixture: the ally stood there').toBe(
      TUTORIAL_FIRST_MOVE_ZONE,
    )
    expect(after.players[allyId]!.xp, 'a lane-mate share for a drill unit').toBe(
      before.players[allyId]!.xp,
    )
  })
})
