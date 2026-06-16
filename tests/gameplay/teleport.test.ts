import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN, ENEMY } from './harness'

/**
 * Channeled teleport (town portal scroll) — the rotation backbone. Using a TP
 * scroll starts a multi-tick channel (tp_channeling) toward the hero's fountain;
 * it only moves the hero once the channel finishes, and any incoming damage
 * interrupts it. Both run through the real processTick (buff-tick completion in
 * _base, damage cancel in the attack phase).
 */
describe('teleport (town portal scroll)', () => {
  it('a town portal scroll moves the hero home only after the channel completes', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me0 = await game.me()
    const fountain = me0.team === 'radiant' ? 'radiant-fountain' : 'dire-fountain'
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          zone: 'mid-river',
          items: ['town_portal_scroll', null, null, null, null, null],
          buffs: [],
        },
        [ENEMY]: { ...s.players[ENEMY]!, zone: 'dire-base' }, // far off — can't interrupt
      },
      creeps: [], // nothing to chip the channel and cancel it
    }))

    game.submit({ type: 'use', item: 'town_portal_scroll' })
    await game.tick()

    // The TP is not instant — mid-channel the hero is still at the origin.
    expect((await game.me()).zone).toBe('mid-river')

    // Once the channel resolves, the hero is home at the fountain.
    await game.tick(4)
    expect((await game.me()).zone).toBe(fountain)
  })

  it('taking damage during the channel cancels the teleport — the hero stays put', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          zone: 'mid-river',
          items: ['town_portal_scroll', null, null, null, null, null],
          buffs: [],
        },
        [ENEMY]: { ...s.players[ENEMY]!, zone: 'mid-river' }, // co-located — can interrupt
      },
    }))

    game.submit({ type: 'use', item: 'town_portal_scroll' })
    await game.tick() // channel starts

    // The enemy hits the channeling hero — that breaks the teleport.
    game.attackHero(HUMAN, ENEMY)
    await game.tick(4)

    // Cancelled: the hero never left, and the channel buff is gone (not stuck).
    expect((await game.me()).zone).toBe('mid-river')
    expect((await game.me()).buffs.some((b) => b.id === 'tp_channeling')).toBe(false)
  })
})
