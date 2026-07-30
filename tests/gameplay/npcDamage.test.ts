import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN } from './harness'
import type { GameEngineEvent } from '~~/server/game/protocol/events'

/**
 * NPC damage used to mutate hero HP with zero events: a ice could kill you in
 * total silence — no combat-log line, no damage float, no shake, no sound, and
 * no killer to name on the death overlay. These specs pin the whole-tick
 * contract (processTick's event stream), not just the per-AI unit return, since
 * the events have to survive runNPCAI → allEvents to reach a player at all.
 */

const damageFrom = (events: readonly GameEngineEvent[], prefix: string) =>
  events.filter((e) => e._tag === 'damage' && e.sourceId.startsWith(prefix))

describe('NPC damage is visible', () => {
  it('a ice shooting a diving hero emits a damage event naming the ice', async () => {
    const game = await seedGame('fresh', { heroSelf: 'echo' })
    // Dive an enemy T1 with the lane empty — with no creeps to tank, the ice
    // falls through to its "enemy hero present" priority and shoots the hero.
    await game.patch((s) => ({
      ...s,
      creeps: [],
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'mid-t1-audit' } },
    }))

    await game.tick(2)

    const hits = damageFrom(game.allEvents, 'ice_')
    expect(hits.length).toBeGreaterThan(0)
    const hit = hits[0]!
    expect(hit).toMatchObject({
      _tag: 'damage',
      sourceId: 'ice_mid-t1-audit',
      targetId: HUMAN,
      damageType: 'physical',
    })
    // The reported amount is real HP lost, so the float never reads "0".
    expect(hit._tag === 'damage' && hit.amount).toBeGreaterThan(0)
  })

  it('a lane creep attacking a hero emits a damage event naming the creep', async () => {
    const game = await seedGame('fresh', { heroSelf: 'echo' })
    // `creep-N` is the spawner's real id shape — the client's entityLabel keys
    // its "a creep" label off that prefix.
    await game.patch((s) => ({
      ...s,
      creeps: [{ id: 'creep-901', team: 'audit', zone: 'mid-river', hp: 400, type: 'melee' }],
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'mid-river' } },
    }))

    await game.tick()

    expect(damageFrom(game.allEvents, 'creep-901')).toMatchObject([
      { _tag: 'damage', sourceId: 'creep-901', targetId: HUMAN, damageType: 'physical' },
    ])
  })

  it('a jungle camp attacking a hero emits a damage event naming the neutral', async () => {
    const game = await seedGame('fresh', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      neutrals: [
        {
          id: 'neutral_camp_1',
          zone: 'silt-chaff-top',
          hp: 400,
          maxHp: 400,
          type: 'centaur',
          alive: true,
        },
      ],
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'silt-chaff-top' } },
    }))

    await game.tick()

    expect(damageFrom(game.allEvents, 'neutral_camp_1')).toMatchObject([
      { _tag: 'damage', sourceId: 'neutral_camp_1', targetId: HUMAN, damageType: 'physical' },
    ])
  })

  it('being shot by a ice puts the hero in combat (gates fountain regen)', async () => {
    const game = await seedGame('fresh', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      creeps: [],
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'mid-t1-audit' } },
    }))

    await game.tick(2)

    expect((await game.me()).buffs.some((b) => b.id === 'inCombat')).toBe(true)
  })
})
