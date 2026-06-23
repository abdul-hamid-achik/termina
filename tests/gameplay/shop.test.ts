import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN, ENEMY } from './harness'
import { ITEMS } from '~~/shared/constants/items'
import { PASSIVE_GOLD_PER_TICK } from '~~/shared/constants/balance'

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

  it('buying deducts exactly the item cost (net of the tick passive income)', async () => {
    const game = await seedGame('laning', { heroSelf: 'echo' })
    const before = (await game.me()).gold

    game.buy('iron_branch')
    await game.tick()

    const me = await game.me()
    // The only gold movements this idle tick are the buy and passive income.
    expect(me.gold).toBe(before - ITEMS.iron_branch!.cost + PASSIVE_GOLD_PER_TICK)
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

  it('using Dagon nukes a targeted enemy for magical damage (offensive item active)', async () => {
    // The offensive-item path the auto-target resolves to: `use dagon hero:<id>`
    // runs submitAction → resolveActions → useItem and applies 300 magical
    // damage (reduced by magic resist) to a co-located enemy.
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          items: ['dagon', null, null, null, null, null],
          buffs: [],
        },
        [ENEMY]: { ...s.players[ENEMY]!, hp: 1000, maxHp: 1000 },
      },
    }))

    const before = (await game.player(ENEMY)).hp
    game.submit({ type: 'use', item: 'dagon', target: { kind: 'hero', name: ENEMY } })
    await game.tick()
    const after = (await game.player(ENEMY)).hp

    // 300 magical, reduced by magic resist (~15%) → ~255 — well above per-tick regen.
    expect(after).toBeLessThan(before)
    expect(before - after).toBeGreaterThan(200)
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

  it('Stack Overflow (Overclock) doubles the caster’s next ability damage, then spends the charge', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.tick() // settle the level-6 maxHp recompute

    const dmgToEnemy = () =>
      game.lastEvents.find(
        (e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === ENEMY,
      )?.amount ?? 0

    // Baseline cast: no Overclock, caster buffs cleared (no stray amp), enemy
    // topped up so the hit is never HP-capped.
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, cooldowns: { q: 0, w: 0, e: 0, r: 0 }, buffs: [] },
        [ENEMY]: { ...s.players[ENEMY]!, hp: s.players[ENEMY]!.maxHp },
      },
    }))
    game.cast('q', { kind: 'hero', name: ENEMY })
    await game.tick()
    const baseline = dmgToEnemy()
    expect(baseline).toBeGreaterThan(0)

    // Same cast under Overclock (same starting amp + full enemy HP) → exactly 2x.
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          cooldowns: { q: 0, w: 0, e: 0, r: 0 },
          buffs: [{ id: 'stack_overflow_buff', stacks: 1, ticksRemaining: 10, source: HUMAN }],
        },
        [ENEMY]: { ...s.players[ENEMY]!, hp: s.players[ENEMY]!.maxHp },
      },
    }))
    game.cast('q', { kind: 'hero', name: ENEMY })
    await game.tick()
    expect(dmgToEnemy()).toBe(baseline * 2)
    // The one-shot charge is consumed by that cast.
    expect((await game.me()).buffs.some((b) => b.id === 'stack_overflow_buff')).toBe(false)
  })

  it('Shiva’s Guard novas every co-located enemy — magic damage + a slow', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.tick() // settle the level-6 maxHp recompute
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          items: ['shivas_guard', null, null, null, null, null],
        },
        [ENEMY]: { ...s.players[ENEMY]!, buffs: [], hp: s.players[ENEMY]!.maxHp },
      },
    }))

    game.submit({ type: 'use', item: 'shivas_guard' })
    await game.tick()

    const foe = await game.player(ENEMY)
    // The nova both damages (HP cut below full) and slows the co-located enemy.
    expect(foe.hp).toBeLessThan(foe.maxHp)
    expect(foe.buffs.some((b) => b.id === 'slow')).toBe(true)
  })

  it('Veil of Discord debuffs co-located enemies with magic vulnerability', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.tick()
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          items: ['veil_of_discord', null, null, null, null, null],
        },
        [ENEMY]: { ...s.players[ENEMY]!, buffs: [] },
      },
    }))

    game.submit({ type: 'use', item: 'veil_of_discord' })
    await game.tick()

    // The amp lands on the ENEMY (not the caster) — the magic-vuln debuff that
    // getIncomingDamageMultiplier reads.
    expect((await game.player(ENEMY)).buffs.some((b) => b.id === 'veil_discord')).toBe(true)
    expect((await game.me()).buffs.some((b) => b.id === 'veil_discord')).toBe(false)
  })
})
