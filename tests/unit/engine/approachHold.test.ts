import { describe, it, expect } from 'vitest'
import type { GameState } from '~~/shared/types/game'
import { approachHold } from '~~/server/game/engine/ActionResolver'
import { ZONES } from '~~/shared/constants/zones'

/** Minimal state: every zone of the full map, the given live audit ICE, one chaff hero. */
function state(heroZone: string, moveTarget: string, liveIce: string[]): GameState {
  return {
    cycle: 211,
    zones: Object.fromEntries(ZONES.map((z) => [z.id, {}])),
    ice: liveIce.map((zone) => ({ zone, team: 'audit', alive: true, integ: 1000, maxInteg: 1000 })),
    players: {
      p1: {
        id: 'p1',
        team: 'chaff',
        alive: true,
        zone: heroZone,
        integ: 100,
        maxInteg: 600,
        moveTarget,
        attackTarget: { kind: 'ice', zone: moveTarget },
      },
    },
  } as unknown as GameState
}

describe('approachHold (pure)', () => {
  it('holds from cover, one hop short of a live enemy ICE', () => {
    expect(
      approachHold(state('coldstore-cross', 'coldstore-t1-audit', ['coldstore-t1-audit']), 'p1'),
    ).not.toBeNull()
  })

  it('never holds a hero already standing under enemy fire — stopping there is worse', () => {
    // Under T1's guns already; the next hop is T2 (also live). Dropping the walk
    // would leave the hero standing in the ICE's zone.
    const s = state('coldstore-t1-audit', 'coldstore-t2-audit', [
      'coldstore-t1-audit',
      'coldstore-t2-audit',
    ])
    expect(approachHold(s, 'p1')).toBeNull()
  })
})
