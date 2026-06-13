import { describe, it, expect } from 'vitest'
import { toGameEvent } from '~~/server/game/protocol/events'
import type { GameEngineEvent } from '~~/server/game/protocol/events'

// toGameEvent is the single wire-serialization point for every engine event:
// it strips the discriminant `_tag` into `type`, keeps `tick` at the top
// level, and folds everything else into `payload`. The client combat log and
// the e2e/integration assertions depend on this exact shape. (This coverage
// previously lived in protocol.test.ts, deleted with the dead @effect/schema
// layer; re-added focused on the live function.)
describe('toGameEvent', () => {
  it('maps _tag -> type, keeps tick top-level, folds the rest into payload', () => {
    const ev: GameEngineEvent = {
      _tag: 'damage',
      tick: 42,
      sourceId: 'github_1',
      targetId: 'creep-3',
      amount: 72,
      damageType: 'physical',
    }
    expect(toGameEvent(ev)).toEqual({
      tick: 42,
      type: 'damage',
      payload: {
        sourceId: 'github_1',
        targetId: 'creep-3',
        amount: 72,
        damageType: 'physical',
      },
    })
  })

  it('never leaks the _tag into the payload', () => {
    const ev: GameEngineEvent = {
      _tag: 'kill',
      tick: 10,
      killerId: 'a',
      victimId: 'b',
      assisters: ['c'],
    }
    const wire = toGameEvent(ev)
    expect(wire.type).toBe('kill')
    expect('_tag' in wire.payload).toBe(false)
    expect(wire.payload).toEqual({ killerId: 'a', victimId: 'b', assisters: ['c'] })
  })

  it('serializes the ancient_destroyed event for the post-game / combat log', () => {
    const ev: GameEngineEvent = {
      _tag: 'ancient_destroyed',
      tick: 124,
      team: 'radiant',
      killerTeam: 'dire',
    }
    expect(toGameEvent(ev)).toEqual({
      tick: 124,
      type: 'ancient_destroyed',
      payload: { team: 'radiant', killerTeam: 'dire' },
    })
  })

  it('preserves tick === 0 (does not drop a falsy tick)', () => {
    const ev: GameEngineEvent = {
      _tag: 'death',
      tick: 0,
      playerId: 'p1',
      respawnTick: 5,
    }
    const wire = toGameEvent(ev)
    expect(wire.tick).toBe(0)
    expect(wire.payload).toEqual({ playerId: 'p1', respawnTick: 5 })
  })
})
