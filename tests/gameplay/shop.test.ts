import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN, ENEMY } from './harness'

/**
 * Replaces tests/e2e/flows/game_buy_resolves.yml — a buy action lands the item
 * in the player's inventory across a tick. The human spawns in the fountain (a
 * shop zone) with starting gold, so iron_branch is affordable.
 */
describe('shop', () => {
  it('buying an item resolves it into the inventory after one tick', async () => {
    const game = await seedGame('laning', { heroSelf: 'echo' })

    game.buy('iron_branch')
    await game.tick()

    const me = await game.me()
    expect(me.items).toContain('iron_branch')
  })

  it('buying emits an item_purchased event so the buy is confirmed in the log', async () => {
    const game = await seedGame('laning', { heroSelf: 'echo' })

    game.buy('iron_branch')
    await game.tick()

    const purchase = game.lastEvents.find(
      (e) => e._tag === 'item_purchased' && e.playerId === HUMAN && e.itemId === 'iron_branch',
    )
    expect(purchase).toBeDefined()
    // The event carries the price for the "(-Ng)" confirmation line.
    expect((purchase as { cost: number }).cost).toBeGreaterThan(0)
  })

  it('selling emits an item_sold event confirming the refund', async () => {
    const game = await seedGame('laning', { heroSelf: 'echo' })

    // Buy then sell the same item (the player stays in the shop zone).
    game.buy('iron_branch')
    await game.tick()
    game.submit({ type: 'sell', item: 'iron_branch' })
    await game.tick()

    const me = await game.me()
    expect(me.items).not.toContain('iron_branch')

    const sale = game.lastEvents.find(
      (e) => e._tag === 'item_sold' && e.playerId === HUMAN && e.itemId === 'iron_branch',
    )
    expect(sale).toBeDefined()
    // The event carries the refund for the "(+Ng)" confirmation line.
    expect((sale as { refund: number }).refund).toBeGreaterThan(0)
  })

  it('using Blink Module teleports the hero to an adjacent zone', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          zone: 'mid-river',
          items: ['blink_module', null, null, null, null, null],
          buffs: [], // no item cooldown
        },
      },
    }))

    // mid-river is adjacent to mid-t1-rad; blink takes a zone-id string target.
    game.submit({ type: 'use', item: 'blink_module', target: 'mid-t1-rad' })
    await game.tick()

    expect((await game.me()).zone).toBe('mid-t1-rad')
  })

  it('using Black King Bar grants magic immunity', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          items: ['black_king_bar', null, null, null, null, null],
          buffs: [],
        },
      },
    }))

    game.submit({ type: 'use', item: 'black_king_bar' })
    await game.tick()

    // BKB applies a multi-tick magic_immune buff (still present after this tick).
    expect((await game.me()).buffs.some((b) => b.id === 'magic_immune')).toBe(true)
  })

  it('Refresher Orb resets a spent ability so it can be cast again (the double-cast combo)', async () => {
    // The reason Refresher exists: an ability you just spent comes back online.
    // The unit test sets cooldowns artificially; this drives the real sequence —
    // cast → on cooldown → refresh → cast again — through processTick.
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          items: ['refresher_orb', null, null, null, null, null],
          cooldowns: { q: 0, w: 0, e: 0, r: 0 },
          buffs: [],
        },
      },
    }))

    // Spend W — it goes on cooldown.
    game.cast('w')
    await game.tick()
    expect((await game.me()).cooldowns.w).toBeGreaterThan(0)

    // Pop Refresher — every ability cooldown is wiped back to zero.
    game.submit({ type: 'use', item: 'refresher_orb' })
    await game.tick()
    expect((await game.me()).cooldowns.w).toBe(0)

    // ...and the refreshed W can immediately be cast again, going back on cooldown.
    game.cast('w')
    await game.tick()
    expect((await game.me()).cooldowns.w).toBeGreaterThan(0)
  })

  it('an attack-stat item raises basic-attack damage (item stats apply in combat)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })

    const lastHitDamage = () =>
      game.lastEvents.find(
        (e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === ENEMY,
      )?.amount ?? 0

    // Baseline basic-attack damage with an empty inventory.
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, items: [null, null, null, null, null, null] },
      },
    }))
    game.attackHero(ENEMY)
    await game.tick()
    const before = lastHitDamage()
    expect(before).toBeGreaterThan(0)

    // Give Blades of Attack (+12 attack), then swing again — getEffectiveAttack
    // folds in the item's stat bonus, so the same hit lands for more.
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          items: ['blades_of_attack', null, null, null, null, null],
        },
      },
    }))
    game.attackHero(ENEMY)
    await game.tick()

    expect(lastHitDamage()).toBeGreaterThan(before)
  })
})
