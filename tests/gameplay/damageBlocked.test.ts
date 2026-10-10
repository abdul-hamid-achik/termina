import { describe, it, expect } from 'vitest'
import { seedGame, ENEMY, HUMAN } from './harness'
import { eventForViewer } from '~~/server/game/engine/VisionCalculator'
import { toGameEvent } from '~~/server/game/protocol/events'
import type { BuffState } from '~~/shared/types/game'
import type { GameEngineEvent } from '~~/server/game/protocol/events'

/**
 * A damaging hero hit that lands NOTHING — fully shield-absorbed, dodged
 * (phaseShift) or met immunity — emits `damage_blocked`. Before it, a cast
 * like that printed no line at all (the cast bridge reads damage off the INTEG
 * diff, which was 0) and a dodged swing was silent: the player saw BW and a
 * cooldown spent and no reason why.
 */

const SHIELD: BuffState = { id: 'shield', stacks: 5000, cyclesRemaining: 5, source: ENEMY }
const DODGE: BuffState = { id: 'phaseShift', stacks: 1, cyclesRemaining: 5, source: ENEMY }
// Kinetic immunity (Echo's Q and basic attack are kinetic).
const KINETIC_IMMUNE: BuffState = { id: 'ghost_form', stacks: 1, cyclesRemaining: 5, source: ENEMY }

async function duel(enemyBuff: BuffState | null) {
  const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
  await game.patch((s) => ({
    ...s,
    players: {
      ...s.players,
      [HUMAN]: { ...s.players[HUMAN]!, items: [null, null, null, null, null, null] },
      [ENEMY]: {
        ...s.players[ENEMY]!,
        items: [null, null, null, null, null, null],
        buffs: enemyBuff ? [enemyBuff] : [],
      },
    },
  }))
  return game
}

const blockedOn = (events: readonly GameEngineEvent[]) =>
  events.filter((e) => e._tag === 'damage_blocked' && e.targetId === ENEMY)
const damageOn = (events: readonly GameEngineEvent[]) =>
  events.filter((e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === ENEMY)

describe('damage_blocked — a hero cast that deals 0', () => {
  it('a cast fully absorbed by a shield says so, with the INTEG the shield soaked', async () => {
    const game = await duel(SHIELD)
    const before = await game.player(ENEMY)
    game.cast('q', { kind: 'hero', name: ENEMY })
    await game.tick()
    const after = await game.player(ENEMY)
    const soaked =
      (before.buffs.find((b) => b.id === 'shield')?.stacks ?? 0) -
      (after.buffs.find((b) => b.id === 'shield')?.stacks ?? 0)
    expect(soaked).toBeGreaterThan(0)
    expect(damageOn(game.lastEvents)).toEqual([])
    expect(blockedOn(game.lastEvents)).toEqual([
      {
        _tag: 'damage_blocked',
        cycle: (await game.state()).cycle,
        sourceId: HUMAN,
        targetId: ENEMY,
        reason: 'shield',
        amount: soaked,
        damageType: 'kinetic',
        abilityId: 'echo-q',
        zone: after.zone,
      },
    ])
  })

  it('a dodged cast (phaseShift consumed) says so', async () => {
    const game = await duel(DODGE)
    game.cast('q', { kind: 'hero', name: ENEMY })
    await game.tick()
    expect((await game.player(ENEMY)).buffs.some((b) => b.id === 'phaseShift')).toBe(false)
    expect(damageOn(game.lastEvents)).toEqual([])
    expect(blockedOn(game.lastEvents)).toMatchObject([
      { sourceId: HUMAN, reason: 'dodge', abilityId: 'echo-q', damageType: 'kinetic' },
    ])
    expect(blockedOn(game.lastEvents)[0]).not.toHaveProperty('amount')
  })

  it('a cast into immunity says so', async () => {
    const game = await duel(KINETIC_IMMUNE)
    const before = (await game.player(ENEMY)).integ
    game.cast('q', { kind: 'hero', name: ENEMY })
    await game.tick()
    expect(game.lastEvents.some((e) => e._tag === 'ability_used' && e.playerId === HUMAN)).toBe(
      true,
    )
    expect((await game.player(ENEMY)).integ).toBeGreaterThanOrEqual(before)
    expect(blockedOn(game.lastEvents)).toMatchObject([
      { sourceId: HUMAN, reason: 'immune', abilityId: 'echo-q' },
    ])
  })

  it('a cast that lands emits damage and NO damage_blocked', async () => {
    const game = await duel(null)
    game.cast('q', { kind: 'hero', name: ENEMY })
    await game.tick()
    expect(damageOn(game.lastEvents).length).toBeGreaterThan(0)
    expect(blockedOn(game.lastEvents)).toEqual([])
  })
})

describe('damage_blocked — a hero basic attack that deals 0', () => {
  it('a dodged swing (silent before) says so, with the swing it ate', async () => {
    const game = await duel(DODGE)
    game.attackHero(ENEMY)
    await game.tick()
    expect(damageOn(game.lastEvents)).toEqual([])
    const [b] = blockedOn(game.lastEvents)
    expect(b).toMatchObject({ sourceId: HUMAN, reason: 'dodge', damageType: 'kinetic' })
    expect(b && b._tag === 'damage_blocked' ? b.amount : 0).toBeGreaterThan(0)
    expect(b).not.toHaveProperty('abilityId')
  })

  it('an immune swing says so (beside its 0-amount damage line)', async () => {
    const game = await duel(KINETIC_IMMUNE)
    game.attackHero(ENEMY)
    await game.tick()
    expect(damageOn(game.lastEvents)).toMatchObject([{ amount: 0 }])
    const [b] = blockedOn(game.lastEvents)
    expect(b).toMatchObject({ sourceId: HUMAN, reason: 'immune' })
    expect(b && b._tag === 'damage_blocked' ? b.amount : 0).toBeGreaterThan(0)
  })

  it('a swing the shield soaked whole says so (beside its pre-shield damage line)', async () => {
    const game = await duel(SHIELD)
    const before = (await game.player(ENEMY)).integ
    game.attackHero(ENEMY)
    await game.tick()
    const [d] = damageOn(game.lastEvents)
    const [b] = blockedOn(game.lastEvents)
    expect(b).toMatchObject({ sourceId: HUMAN, reason: 'shield' })
    expect(b && b._tag === 'damage_blocked' ? b.amount : -1).toBe(
      d && d._tag === 'damage' ? d.amount : -2,
    )
    expect((await game.player(ENEMY)).integ).toBeGreaterThanOrEqual(before)
  })

  it('a swing that lands emits NO damage_blocked', async () => {
    const game = await duel(null)
    game.attackHero(ENEMY)
    await game.tick()
    expect(blockedOn(game.lastEvents)).toEqual([])
  })
})

describe('damage_blocked — fog', () => {
  it('is located where it landed and reaches both crews', async () => {
    const game = await duel(DODGE)
    game.attackHero(ENEMY)
    await game.tick()
    const s = await game.state()
    const [b] = blockedOn(game.lastEvents)
    expect(b).toMatchObject({ zone: s.players[ENEMY]!.zone })
    const wire = toGameEvent(b!)
    // Each side is a participant (sourceId / targetId), even with the zone fogged.
    expect(eventForViewer(wire, s, 'chaff', new Set())).not.toBeNull()
    expect(eventForViewer(wire, s, 'audit', new Set())).not.toBeNull()
    // A viewer who cannot see the zone loses the location stamp.
    expect(eventForViewer(wire, s, 'audit', new Set())!.payload).not.toHaveProperty('zone')
  })
})
