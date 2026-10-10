import { describe, it, expect } from 'vitest'
import type { GameState, WaveUnitState } from '~~/shared/types/game'
import { approachHold, predictedHopDamage } from '~~/server/game/engine/ActionResolver'
import { ZONES } from '~~/shared/constants/zones'
import {
  APPROACH_HOLD_DAMAGE_RATIO,
  ICE_ATTACK,
  LINE_UNIT_ATTACK,
  waveEscalationMultiplier,
} from '~~/shared/constants/balance'

const CROSS = 'coldstore-cross'
const T1 = 'coldstore-t1-audit'

function unit(id: string, team: 'chaff' | 'audit', zone: string): WaveUnitState {
  return { id, team, zone, integ: 400, maxInteg: 400, type: 'line' }
}

/** Minimal state: every zone of the full map, the given live audit ICE, one
 *  chaff hero with no plate / items / buffs (so hits land raw). */
function state(
  heroZone: string,
  moveTarget: string,
  liveIce: string[],
  opts: { integ?: number; cycle?: number; waves?: WaveUnitState[] } = {},
): GameState {
  return {
    cycle: opts.cycle ?? 211,
    zones: Object.fromEntries(ZONES.map((z) => [z.id, { id: z.id, wards: [] }])),
    teams: { chaff: {}, audit: {} },
    events: [],
    neutrals: [],
    caches: [],
    terminals: [],
    waves: opts.waves ?? [],
    ice: liveIce.map((zone) => ({ zone, team: 'audit', alive: true, integ: 1000, maxInteg: 1000 })),
    players: {
      p1: {
        id: 'p1',
        team: 'chaff',
        alive: true,
        zone: heroZone,
        integ: opts.integ ?? 100,
        maxInteg: 600,
        plate: 0,
        ice: 0,
        items: [],
        buffs: [],
        moveTarget,
        attackTarget: { kind: 'ice', zone: moveTarget },
      },
    },
  } as unknown as GameState
}

const four = [1, 2, 3, 4].map((i) => unit(`a${i}`, 'audit', T1))

describe('predictedHopDamage (pure)', () => {
  it('sums every enemy unit at the CURRENT escalation plus the ICE it draws', () => {
    const s = state(CROSS, T1, [T1], { waves: four, cycle: 211 })
    const lineAt211 = Math.round(LINE_UNIT_ATTACK * waveEscalationMultiplier(211))
    expect(lineAt211).toBeGreaterThan(LINE_UNIT_ATTACK) // escalation is in play
    expect(predictedHopDamage(s, s.players.p1!, T1, true)).toEqual({
      damage: 4 * lineAt211 + ICE_ATTACK,
      units: 4,
      ice: true,
      heroes: 0,
      neutrals: 0,
      tenant: false,
    })
  })

  it('the same stack early in the game hits for its base attack', () => {
    const s = state(CROSS, T1, [T1], { waves: four, cycle: 10 })
    expect(predictedHopDamage(s, s.players.p1!, T1, true).damage).toBe(
      4 * LINE_UNIT_ATTACK + ICE_ATTACK,
    )
  })

  it('an allied unit in the zone takes the wave fire; the ICE stays on a hero who strikes it', () => {
    const s = state(CROSS, T1, [T1], { waves: [...four, unit('c1', 'chaff', T1)] })
    expect(predictedHopDamage(s, s.players.p1!, T1, true)).toEqual({
      damage: ICE_ATTACK,
      units: 0,
      ice: true,
      heroes: 0,
      neutrals: 0,
      tenant: false,
    })
    // Just passing through (not striking it), the ICE shoots the escort first.
    expect(predictedHopDamage(s, s.players.p1!, T1, false)).toEqual({
      damage: 0,
      units: 0,
      ice: false,
      heroes: 0,
      neutrals: 0,
      tenant: false,
    })
  })

  it('is not capped at the INTEG the hero has left', () => {
    const s = state(CROSS, T1, [T1], { waves: four, integ: 10, cycle: 10 })
    expect(predictedHopDamage(s, s.players.p1!, T1, true).damage).toBe(
      4 * LINE_UNIT_ATTACK + ICE_ATTACK,
    )
  })
})

describe('approachHold (pure)', () => {
  it('holds from cover when the next hop out-damages the ratio of current INTEG', () => {
    // ICE alone (120) against 100 INTEG.
    expect(approachHold(state(CROSS, T1, [T1]), 'p1')).not.toBeNull()
  })

  it('holds exactly AT the ratio, walks one INTEG above it', () => {
    // ICE alone = ICE_ATTACK; the INTEG at which that is exactly the ratio.
    const atRatio = ICE_ATTACK / APPROACH_HOLD_DAMAGE_RATIO
    expect(Number.isInteger(atRatio)).toBe(true)
    expect(approachHold(state(CROSS, T1, [T1], { integ: atRatio }), 'p1')).not.toBeNull()
    expect(approachHold(state(CROSS, T1, [T1], { integ: atRatio + 1 }), 'p1')).toBeNull()
  })

  it('never holds a hero already standing under enemy fire — stopping there is worse', () => {
    // Under T1's guns already; the next hop is T2 (also live). Dropping the walk
    // would leave the hero standing in the ICE's zone.
    const s = state(T1, 'coldstore-t2-audit', [T1, 'coldstore-t2-audit'])
    expect(approachHold(s, 'p1')).toBeNull()
  })

  it('a next hop that throws nothing never holds, however low the INTEG', () => {
    const s = state(CROSS, T1, [], { integ: 1 })
    expect(approachHold(s, 'p1')).toBeNull()
  })
})
