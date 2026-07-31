import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN, ENEMY } from './harness'

/**
 * W3-3 — combo depth. One action per cycle meant an item active and an ability
 * could never happen in the same 4s tick, so every 2000sc+ active competed with
 * the ultimate for the same slot and blink→stun→nuke was structurally
 * unreachable. Item actives now hold their own per-player queue slot and
 * resolve in their own phase AHEAD of the ability they set up.
 */
describe('same-tick combos', () => {
  it('an item active and an ability both land in one cycle', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.patch((s) => ({
      ...s,
      cycle: 40,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          items: ['hardshell', null, null, null, null, null],
          cooldowns: { q: 0, w: 0, e: 0, r: 0 },
        },
      },
    }))

    game.submit({ type: 'use', item: 'hardshell' })
    game.cast('q', { kind: 'hero', name: ENEMY })
    await game.tick()

    const me = await game.me()
    expect(me.buffs.some((b) => b.id === 'airgap')).toBe(true)
    expect(
      game.lastEvents.some(
        (e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === ENEMY,
      ),
    ).toBe(true)
  })

  it('the item resolves FIRST — blink then attack reaches a hero a zone away', async () => {
    // Order is the whole point: with the active resolving after the main action
    // (where it used to, in the shop phase) the swing lands in the zone the
    // hero has not left yet, and the combo reads backwards.
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.patch((s) => ({
      ...s,
      cycle: 40,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          zone: 'mid-t1-chaff',
          items: ['jump_shunt', null, null, null, null, null],
        },
        [ENEMY]: { ...s.players[ENEMY]!, zone: 'mid-river' },
      },
    }))

    game.submit({ type: 'use', item: 'jump_shunt', target: 'mid-river' })
    game.attackHero(ENEMY)
    await game.tick()

    expect((await game.me()).zone).toBe('mid-river')
    expect(
      game.lastEvents.some(
        (e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === ENEMY,
      ),
    ).toBe(true)
  })

  it('picking a talent no longer deletes the cast queued behind it', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.patch((s) => ({
      ...s,
      cycle: 40,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          level: 10,
          cooldowns: { q: 0, w: 0, e: 0, r: 0 },
          talents: { tier10: null, tier15: null, tier20: null, tier25: null },
        },
      },
    }))

    game.cast('q', { kind: 'hero', name: ENEMY })
    game.selectTalent(10, 'echo_10_left')
    await game.tick()

    const me = await game.me()
    expect(me.talents.tier10).toBe('echo_10_left')
    expect(
      game.lastEvents.some(
        (e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === ENEMY,
      ),
    ).toBe(true)
  })

  it('spending the free item slot does not cost the standing attack order', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.patch((s) => ({
      ...s,
      cycle: 40,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          items: ['hardshell', null, null, null, null, null],
        },
      },
    }))

    game.attackHero(ENEMY)
    await game.tick()
    expect((await game.me()).attackTarget).toEqual({ kind: 'hero', name: ENEMY })

    // Only an item this cycle: the hero keeps swinging AND gains the buff.
    game.submit({ type: 'use', item: 'hardshell' })
    await game.tick()

    const me = await game.me()
    expect(me.buffs.some((b) => b.id === 'airgap')).toBe(true)
    expect(me.attackTarget).toEqual({ kind: 'hero', name: ENEMY })
    expect(
      game.lastEvents.some(
        (e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === ENEMY,
      ),
    ).toBe(true)
  })
})
