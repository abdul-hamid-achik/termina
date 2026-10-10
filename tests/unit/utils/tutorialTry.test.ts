import { describe, it, expect } from 'vitest'
import { liveTutorialTryCommand, skippedDrillFromNotice } from '~~/app/utils/tutorialTry'
import {
  ICE_DRILL_ZONE,
  TUTORIAL_FLOW,
  TUTORIAL_STEP_COUNT,
  liveIceDrillZone,
  tutorialHint,
} from '~~/shared/constants/tutorial'
import { initializeIce } from '~~/server/game/map/zones'
import { structureRefusal } from '~~/shared/utils/structureRules'
import type { TeamId, WaveUnitState } from '~~/shared/types/game'

const stepOf = (id: string) => TUTORIAL_FLOW.findIndex((s) => s.id === id)
const EMPTY = [null, null, null, null, null, null]

/**
 * The TutorialHint `try:` chip used to offer the step's FIRST backticked command
 * forever: "try: move rookery-terminal" while standing in rookery-terminal,
 * "try: buy camtap" with a camtap in the bag (playtest2 #4). The chip offers the
 * first command the player has not already satisfied.
 */
describe('liveTutorialTryCommand', () => {
  it('offers the walk home on the buy step until you are home', () => {
    const step = stepOf('buy')
    expect(liveTutorialTryCommand(step, { zone: 'coldstore-t2-chaff', items: EMPTY })).toBe(
      'move rookery-terminal',
    )
    expect(liveTutorialTryCommand(step, { zone: 'rookery-terminal', items: EMPTY })).toBe(
      'buy edge_kit',
    )
  })

  it('skips the walk when you already stand in a shop (the fountain sells too)', () => {
    expect(
      liveTutorialTryCommand(stepOf('buy'), {
        zone: 'rookery-anchor',
        items: EMPTY,
        inShopZone: true,
      }),
    ).toBe('buy edge_kit')
  })

  it('moves on from `buy camtap` to `tap <your zone>` once you hold one', () => {
    const step = stepOf('tap')
    expect(liveTutorialTryCommand(step, { zone: 'rookery-terminal', items: EMPTY })).toBe(
      'buy camtap',
    )
    const held = ['edge_kit', 'camtap', null, null, null, null]
    expect(liveTutorialTryCommand(step, { zone: 'rookery-terminal', items: held })).toBe(
      'tap rookery-terminal',
    )
  })

  // `attack ice:<zone>` from range is a walk + held attack on the server
  // (ActionResolver.approachStructure), so the ICE drill's chip is the attack
  // itself from anywhere — the same command the step's hint names.
  it('offers `attack ice:<drill ICE>` from anywhere on the map', () => {
    const step = stepOf('ice')
    const want = `attack ice:${ICE_DRILL_ZONE}`
    for (const zone of ['rookery-anchor', 'rookery-terminal', 'coldstore-cross', ICE_DRILL_ZONE]) {
      expect(liveTutorialTryCommand(step, { zone, items: EMPTY }), zone).toBe(want)
    }
  })

  it('liveIceDrillZone prefers the drill ICE, then the lowest tier the server accepts', () => {
    const ice = initializeIce()
    expect(liveIceDrillZone(ice, 'chaff')).toBe(ICE_DRILL_ZONE)
    // Hardened is temporary: an order from range walks — still the drill ICE.
    const hardened = ice.map((t) => (t.team === 'audit' ? { ...t, invulnerable: true } : t))
    expect(liveIceDrillZone(hardened, 'chaff')).toBe(ICE_DRILL_ZONE)
    const t1t2Down = ice.map((t) =>
      t.zone === ICE_DRILL_ZONE || t.zone === 'coldstore-t2-audit'
        ? { ...t, alive: false, integ: 0 }
        : t,
    )
    expect(liveIceDrillZone(t1t2Down, 'chaff')).toBe('coldstore-t3-audit')
    // Not hydrated yet: the static drill ICE.
    expect(liveIceDrillZone([], 'chaff')).toBe(ICE_DRILL_ZONE)
  })

  it('offers the next ICE the server would accept when the drill ICE is already down', () => {
    const step = stepOf('ice')
    const ice = initializeIce().map((t) =>
      t.zone === ICE_DRILL_ZONE ? { ...t, alive: false, integ: 0 } : t,
    )
    const chip = liveTutorialTryCommand(step, {
      zone: 'rookery-anchor',
      items: EMPTY,
      iceDrillZone: liveIceDrillZone(ice, 'chaff'),
    })
    expect(chip).toBe('attack ice:coldstore-t2-audit')
    // And the pre-flight takes it (T1 is down, so T2 is no longer covered).
    expect(structureRefusal(ice, null, 'chaff', { kind: 'ice', zone: 'coldstore-t2-audit' })).toBe(
      null,
    )
  })

  it('the ICE chip is the command the ICE hint tells the player to type', () => {
    const step = stepOf('ice')
    const hinted = [...(tutorialHint(step) ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1])
    expect(hinted[0]).toBe(liveTutorialTryCommand(step, { zone: 'rookery-anchor', items: EMPTY }))
  })

  it('keeps an explicit drill command as-is', () => {
    expect(liveTutorialTryCommand(stepOf('cast'), { zone: 'x', items: EMPTY })).toBe('cast q')
  })

  it('without live context it is the static first command', () => {
    expect(liveTutorialTryCommand(stepOf('move'), {})).toBe('move coldstore-t2-chaff')
  })

  it('is null once the tutorial is complete', () => {
    expect(liveTutorialTryCommand(TUTORIAL_STEP_COUNT, { zone: 'x' })).toBeNull()
  })
})

// Playtest 3: with no wave in the zone the chip said `attack wave:0` and the
// server rejected it. The chip offers only what is legal right now.
describe('liveTutorialTryCommand: wave chips are live', () => {
  let n = 0
  const wave = (team: TeamId, zone: string, integ: number, maxInteg = 400): WaveUnitState => ({
    id: `wave_${team}_${++n}`,
    team,
    zone,
    integ,
    maxInteg,
    type: 'line',
  })
  const T2 = 'coldstore-t2-chaff'
  const ctx = (zone: string, waves: WaveUnitState[]) => ({
    zone,
    items: EMPTY,
    team: 'chaff' as TeamId,
    waves,
  })

  it('no wave in the zone → the walk to the nearest one, never wave:0', () => {
    const step = stepOf('strip')
    const chip = liveTutorialTryCommand(step, ctx(T2, [wave('audit', 'coldstore-t1-chaff', 100)]))
    expect(chip).toBe('move coldstore-t1-chaff')
  })

  // Round-4 review: the walk chip offered a level-1 learner `move
  // coldstore-t1-audit` (into enemy ICE) and `move coldstore-cross`.
  it('never walks a learner onto the crossing or under a live enemy ICE', () => {
    const step = stepOf('strip')
    const ice = initializeIce()
    const at = (zone: string, withIce = true) =>
      liveTutorialTryCommand(step, {
        ...ctx(T2, [wave('audit', zone, 100)]),
        ...(withIce ? { ice } : {}),
      })
    expect(at('coldstore-cross')).toBeNull()
    expect(at('coldstore-t1-audit')).toBeNull()
    expect(at('coldstore-t1-audit', false)).toBeNull() // ICE unknown: covered
    expect(at('landing-terminal')).toBeNull() // the enemy base
    // A safe zone with a unit nearer than an unsafe one wins over "nothing".
    const mixed = [wave('audit', 'coldstore-cross', 100), wave('audit', 'coldstore-t3-chaff', 100)]
    expect(liveTutorialTryCommand(step, { ...ctx(T2, mixed), ice })).toBe('move coldstore-t3-chaff')
    // From home ground with only unsafe units in sight: the walk out to the lane.
    expect(
      liveTutorialTryCommand(step, {
        ...ctx('rookery-anchor', [wave('audit', 'coldstore-cross', 100)]),
        ice,
      }),
    ).toBe(`move ${T2}`)
  })

  it('an enemy ICE zone whose ICE is down is fair ground again', () => {
    const ice = initializeIce().map((t) =>
      t.zone === 'coldstore-t1-audit' ? { ...t, alive: false, integ: 0 } : t,
    )
    expect(
      liveTutorialTryCommand(stepOf('strip'), {
        ...ctx(T2, [wave('audit', 'coldstore-t1-audit', 100)]),
        ice,
      }),
    ).toBe('move coldstore-t1-audit')
  })

  it('names the index of the enemy unit actually in the window', () => {
    // wave:N counts EVERY unit in the zone: my mule is wave:0, the low guard wave:2.
    const waves = [wave('chaff', T2, 300), wave('audit', T2, 390), wave('audit', T2, 90)]
    expect(liveTutorialTryCommand(stepOf('strip'), ctx(T2, waves))).toBe('attack wave:2')
  })

  it('the attack step (hint-derived chip) is judged the same way', () => {
    // Only my own unit here, nothing hostile in sight: no legal swing to offer.
    expect(liveTutorialTryCommand(stepOf('attack'), ctx(T2, [wave('chaff', T2, 300)]))).toBeNull()
    expect(
      liveTutorialTryCommand(
        stepOf('attack'),
        ctx(T2, [wave('chaff', T2, 300), wave('audit', T2, 300)]),
      ),
    ).toBe('attack wave:1')
  })

  it('burn names only one of YOUR units inside the burn window', () => {
    const step = stepOf('burn')
    const waves = [wave('audit', T2, 50), wave('chaff', T2, 390), wave('chaff', T2, 150)]
    expect(liveTutorialTryCommand(step, ctx(T2, waves))).toBe('burn wave:2')
    // Own units nearby but healthy (T1 is one hop), the burnable one two hops
    // back at the base: walk to the one that can actually be burned.
    const away = [
      wave('chaff', T2, 390),
      wave('chaff', 'coldstore-t1-chaff', 390),
      wave('chaff', 'rookery-terminal', 120),
    ]
    expect(liveTutorialTryCommand(step, ctx(T2, away))).toBe('move rookery-terminal')
  })

  it('nothing in sight: home ground walks out to the lane; on the lane there is no chip', () => {
    const step = stepOf('strip')
    expect(liveTutorialTryCommand(step, ctx('rookery-anchor', []))).toBe(`move ${T2}`)
    expect(liveTutorialTryCommand(step, ctx(T2, []))).toBeNull()
  })

  it('without wave context it keeps the static drill command', () => {
    expect(liveTutorialTryCommand(stepOf('strip'), { zone: T2, items: EMPTY })).toBe(
      'attack wave:0',
    )
  })
})

describe('skippedDrillFromNotice', () => {
  it('names the drill a "Moving on" skip notice stands for', () => {
    const cast = TUTORIAL_FLOW[stepOf('cast')]!
    expect(skippedDrillFromNotice(`🎓 Moving on — ${cast.skipNote}`)).toBe('cast')
  })
  it('ignores every other notice', () => {
    expect(skippedDrillFromNotice(TUTORIAL_FLOW[0]!.done)).toBeNull()
    expect(skippedDrillFromNotice('🎓 Moving on — something unknown')).toBeNull()
  })
})
