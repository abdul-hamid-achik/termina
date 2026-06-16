import { describe, it, expect } from 'vitest'
import { seedGame, ENEMY, HUMAN } from './harness'

/**
 * Replaces tests/e2e/flows/game_attack_lands.yml — a human basic attack on a
 * co-located enemy registers hero damage. damageDealt is the regen-independent
 * "the hit landed" signal the original flow used (raw enemy HP is confounded by
 * per-tick regen + the level-6 maxHp recompute).
 */
describe('combat', () => {
  it('attacking a co-located enemy deals hero damage after one tick', async () => {
    // laning_combat co-locates the human + the enemy mid-lane, both at level 6.
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })

    game.attackHero(ENEMY)
    await game.tick()

    const me = await game.me()
    expect(me.damageDealt).toBeGreaterThan(0)
  })

  it('Segfault Blade resets the killer cooldowns on a hero kill', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          items: ['segfault_blade', null, null, null, null, null],
          cooldowns: { q: 5, w: 5, e: 5, r: 5 },
        },
        [ENEMY]: { ...s.players[ENEMY]!, hp: 1 },
      },
    }))

    game.attackHero(ENEMY) // lethal — enemy is at 1 HP
    await game.tick()

    expect((await game.player(ENEMY)).alive).toBe(false)
    expect((await game.me()).cooldowns).toEqual({ q: 0, w: 0, e: 0, r: 0 })
  })

  it('Divine Rapier drops from the victim and is claimed by the killer on a hero kill', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, items: [null, null, null, null, null, null] }, // free slot
        [ENEMY]: {
          ...s.players[ENEMY]!,
          hp: 1,
          items: ['divine_rapier', null, null, null, null, null],
        },
      },
    }))

    game.attackHero(ENEMY) // lethal — enemy is at 1 HP
    await game.tick()

    expect((await game.player(ENEMY)).alive).toBe(false)
    // The Rapier left the victim and landed in the killer's inventory.
    expect((await game.player(ENEMY)).items).not.toContain('divine_rapier')
    expect((await game.me()).items).toContain('divine_rapier')
  })
})
