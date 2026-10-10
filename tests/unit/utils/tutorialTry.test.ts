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
