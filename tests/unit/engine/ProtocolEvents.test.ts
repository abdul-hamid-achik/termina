import { describe, it, expect } from 'vitest'
import { toGameEvent } from '~~/server/game/protocol/events'
import type { GameEngineEvent } from '~~/server/game/protocol/events'

// toGameEvent is the single wire-serialization point for every engine event:
// it strips the discriminant `_tag` into `type`, keeps `cycle` at the top
// level, and folds everything else into `payload`. The client combat log and
// the e2e/integration assertions depend on this exact shape. (This coverage
// previously lived in protocol.test.ts, deleted with the dead @effect/schema
// layer; re-added focused on the live function.)
describe('toGameEvent', () => {
  it('maps _tag -> type, keeps cycle top-level, folds the rest into payload', () => {
    const ev: GameEngineEvent = {
      _tag: 'damage',
      cycle: 42,
      sourceId: 'github_1',
      targetId: 'wave-3',
      amount: 72,
      damageType: 'kinetic',
    }
    expect(toGameEvent(ev)).toEqual({
      cycle: 42,
      type: 'damage',
      payload: {
        sourceId: 'github_1',
        targetId: 'wave-3',
        amount: 72,
        damageType: 'kinetic',
      },
    })
  })

  it('never leaks the _tag into the payload', () => {
    const ev: GameEngineEvent = {
      _tag: 'kill',
      cycle: 10,
      killerId: 'a',
      victimId: 'b',
      assisters: ['c'],
    }
    const wire = toGameEvent(ev)
    expect(wire.type).toBe('kill')
    expect('_tag' in wire.payload).toBe(false)
    expect(wire.payload).toEqual({ killerId: 'a', victimId: 'b', assisters: ['c'] })
  })

  it('serializes the terminal_destroyed event for the post-game / combat log', () => {
    const ev: GameEngineEvent = {
      _tag: 'terminal_destroyed',
      cycle: 124,
      team: 'chaff',
      killerTeam: 'audit',
    }
    expect(toGameEvent(ev)).toEqual({
      cycle: 124,
      type: 'terminal_destroyed',
      payload: { team: 'chaff', killerTeam: 'audit' },
    })
  })

  it('preserves cycle === 0 (does not drop a falsy cycle)', () => {
    const ev: GameEngineEvent = {
      _tag: 'death',
      cycle: 0,
      playerId: 'p1',
      respawnCycle: 5,
    }
    const wire = toGameEvent(ev)
    expect(wire.cycle).toBe(0)
    expect(wire.payload).toEqual({ playerId: 'p1', respawnCycle: 5 })
  })
})
