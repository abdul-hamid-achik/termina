import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN, ENEMY } from './harness'
import { ITEMS } from '~~/shared/constants/items'
import { PASSIVE_SCRIP_PER_CYCLE } from '~~/shared/constants/balance'

/**
 * Replaces tests/e2e/flows/game_buy_resolves.yml — a buy action lands the item
 * in the player's inventory across a tick. The human spawns in the fountain (a
 * shop zone) with starting scrip, so scrap_lot is affordable.
 */
describe('shop', () => {
  it('buying an item resolves it into the inventory after one cycle', async () => {
    const game = await seedGame('laning', { heroSelf: 'echo' })

    game.buy('scrap_lot')
    await game.tick()

    const me = await game.me()
    expect(me.items).toContain('scrap_lot')
  })

  it('buying deducts exactly the item cost (net of the tick passive income)', async () => {
    const game = await seedGame('laning', { heroSelf: 'echo' })
    const before = (await game.me()).scrip

    game.buy('scrap_lot')
    await game.tick()

    const me = await game.me()
    // The only scrip movements this idle tick are the buy and passive income.
    expect(me.scrip).toBe(before - ITEMS.scrap_lot!.cost + PASSIVE_SCRIP_PER_CYCLE)
  })

  it('buying emits an item_purchased event so the buy is confirmed in the log', async () => {
    const game = await seedGame('laning', { heroSelf: 'echo' })

    game.buy('scrap_lot')
    await game.tick()

    const purchase = game.lastEvents.find(
      (e) => e._tag === 'item_purchased' && e.playerId === HUMAN && e.itemId === 'scrap_lot',
    )
    expect(purchase).toBeDefined()
    // The event carries the price for the "(-Ng)" confirmation line.
    expect((purchase as { cost: number }).cost).toBeGreaterThan(0)
  })

  it('selling emits an item_sold event confirming the refund', async () => {
    const game = await seedGame('laning', { heroSelf: 'echo' })

    // Buy then sell the same item (the player stays in the shop zone).
    game.buy('scrap_lot')
    await game.tick()
    game.submit({ type: 'sell', item: 'scrap_lot' })
    await game.tick()

    const me = await game.me()
    expect(me.items).not.toContain('scrap_lot')

    const sale = game.lastEvents.find(
      (e) => e._tag === 'item_sold' && e.playerId === HUMAN && e.itemId === 'scrap_lot',
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
          zone: 'coldstore-cross',
          items: ['jump_shunt', null, null, null, null, null],
          buffs: [], // no item cooldown
        },
      },
    }))

    // coldstore-cross is adjacent to coldstore-t1-chaff; blink takes a zone-id string target.
    game.submit({ type: 'use', item: 'jump_shunt', target: 'coldstore-t1-chaff' })
    await game.tick()

    expect((await game.me()).zone).toBe('coldstore-t1-chaff')
  })

  it('using Burnout nukes a targeted enemy for code damage (offensive item active)', async () => {
    // The offensive-item path the auto-target resolves to: `use burnout hero:<id>`
    // runs submitAction → resolveActions → useItem and applies 300 code
    // damage (reduced by ice) to a co-located enemy.
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          items: ['burnout', null, null, null, null, null],
          buffs: [],
        },
        [ENEMY]: { ...s.players[ENEMY]!, integ: 1000, maxInteg: 1000 },
      },
    }))

    const before = (await game.player(ENEMY)).integ
    game.submit({ type: 'use', item: 'burnout', target: { kind: 'hero', name: ENEMY } })
    await game.tick()
    const after = (await game.player(ENEMY)).integ

    // 300 code, reduced by ice (~15%) → ~255 — well above per-cycle regen.
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
          items: ['hardshell', null, null, null, null, null],
          buffs: [],
        },
      },
    }))

    game.submit({ type: 'use', item: 'hardshell' })
    await game.tick()

    // Hardshell applies a multi-tick airgap buff (still present after this cycle).
    expect((await game.me()).buffs.some((b) => b.id === 'airgap')).toBe(true)
  })

  it('Refresher Orb resets a spent ability so it can be cast again (the double-cast combo)', async () => {
    // The reason Refresher exists: an ability you just spent comes back online.
    // The unit test sets cooldowns artificially; this drives the real sequence —
    // cast → on cooldown → refresh → cast again — through processCycle.
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          items: ['redline_splice', null, null, null, null, null],
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
    game.submit({ type: 'use', item: 'redline_splice' })
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

    // Give Edge Kit (+12 attack), then swing again — getEffectiveAttack
    // folds in the item's stat bonus, so the same hit lands for more.
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          items: ['edge_kit', null, null, null, null, null],
        },
      },
    }))
    game.attackHero(ENEMY)
    await game.tick()

    expect(lastHitDamage()).toBeGreaterThan(before)
  })

  it('Stack Overflow (Overclock) doubles the caster’s next ability damage, then spends the charge', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.tick() // settle the level-6 maxInteg recompute

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
        [ENEMY]: { ...s.players[ENEMY]!, integ: s.players[ENEMY]!.maxInteg },
      },
    }))
    game.cast('q', { kind: 'hero', name: ENEMY })
    await game.tick()
    const baseline = dmgToEnemy()
    expect(baseline).toBeGreaterThan(0)

    // Same cast under Overclock (same starting amp + full enemy INTEG) → exactly 2x.
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          cooldowns: { q: 0, w: 0, e: 0, r: 0 },
          buffs: [{ id: 'stack_overflow_buff', stacks: 1, cyclesRemaining: 10, source: HUMAN }],
        },
        [ENEMY]: { ...s.players[ENEMY]!, integ: s.players[ENEMY]!.maxInteg },
      },
    }))
    game.cast('q', { kind: 'hero', name: ENEMY })
    await game.tick()
    expect(dmgToEnemy()).toBe(baseline * 2)
    // The one-shot charge is consumed by that cast.
    expect((await game.me()).buffs.some((b) => b.id === 'stack_overflow_buff')).toBe(false)
  })

  it('Cryo Routine novas every co-located enemy — code damage + a slow', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.tick() // settle the level-6 maxInteg recompute
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          items: ['cryo_routine', null, null, null, null, null],
        },
        [ENEMY]: { ...s.players[ENEMY]!, buffs: [], integ: s.players[ENEMY]!.maxInteg },
      },
    }))

    game.submit({ type: 'use', item: 'cryo_routine' })
    await game.tick()

    const foe = await game.player(ENEMY)
    // The nova both damages (INTEG cut below full) and slows the co-located enemy.
    expect(foe.integ).toBeLessThan(foe.maxInteg)
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
          items: ['discord_routine', null, null, null, null, null],
        },
        [ENEMY]: { ...s.players[ENEMY]!, buffs: [] },
      },
    }))

    game.submit({ type: 'use', item: 'discord_routine' })
    await game.tick()

    // The amp lands on the ENEMY (not the caster) — the magic-vuln debuff that
    // getIncomingDamageMultiplier reads.
    expect((await game.player(ENEMY)).buffs.some((b) => b.id === 'veil_discord')).toBe(true)
    expect((await game.me()).buffs.some((b) => b.id === 'veil_discord')).toBe(false)
  })
})
