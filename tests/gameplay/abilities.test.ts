import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN, ENEMY } from './harness'

/**
 * Replaces tests/e2e/flows/game_cast_self_buff.yml — the same engine truth
 * (a self-buff cast goes on cooldown after a tick), now in-process: no browser,
 * no /api/test/* round-trip.
 */
describe('abilities', () => {
  it('a self-buff cast goes on cooldown after one tick (echo W — Phase Shift)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })

    game.cast('w')
    await game.tick()

    const me = await game.me()
    expect(me.cooldowns.w).toBeGreaterThan(0)
  })

  it('a stunned hero cannot cast, then can again once the stun expires', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })

    // Stun the human for a single tick (queued action is dropped by the full loop,
    // not just by a bare validateAction call — this is the engine-truth check).
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          cooldowns: { q: 0, w: 0, e: 0, r: 0 },
          buffs: [{ id: 'stun', stacks: 1, ticksRemaining: 1, source: ENEMY }],
        },
      },
    }))

    // While stunned, the queued Q is rejected — it stays off cooldown AND the
    // player is told why (not a silent drop).
    game.cast('q', { kind: 'hero', name: ENEMY })
    await game.tick()
    expect((await game.me()).cooldowns.q).toBe(0)
    expect(
      game.lastRejected.some((r) => r.playerId === HUMAN && r.reason.includes('stunned')),
    ).toBe(true)

    // The stun has now ticked away; the same cast resolves and sets the cooldown.
    game.cast('q', { kind: 'hero', name: ENEMY })
    await game.tick()
    expect((await game.me()).cooldowns.q).toBeGreaterThan(0)
  })

  it('root blocks movement but — unlike stun — still allows casting', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          zone: 'mid-river',
          cooldowns: { q: 0, w: 0, e: 0, r: 0 },
          buffs: [{ id: 'root', stacks: 1, ticksRemaining: 5, source: ENEMY }],
        },
      },
    }))

    // Rooted: a move to an adjacent zone is dropped — the hero stays put, and
    // the rejection reason reaches the player.
    game.submit({ type: 'move', zone: 'mid-t1-rad' })
    await game.tick()
    expect((await game.me()).zone).toBe('mid-river')
    expect(game.lastRejected.some((r) => r.playerId === HUMAN && r.reason.includes('rooted'))).toBe(
      true,
    )

    // But casting is unaffected by root — the self-buff W resolves and goes on cooldown.
    game.cast('w')
    await game.tick()
    expect((await game.me()).cooldowns.w).toBeGreaterThan(0)
  })

  it('silence blocks casting but — unlike stun — still allows moving', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          zone: 'mid-river',
          cooldowns: { q: 0, w: 0, e: 0, r: 0 },
          buffs: [{ id: 'silence', stacks: 1, ticksRemaining: 5, source: ENEMY }],
        },
      },
    }))

    // Silenced: the self-buff W is dropped — it stays off cooldown.
    game.cast('w')
    await game.tick()
    expect((await game.me()).cooldowns.w).toBe(0)

    // But moving is unaffected by silence — the hero relocates to the adjacent zone.
    game.submit({ type: 'move', zone: 'mid-t1-rad' })
    await game.tick()
    expect((await game.me()).zone).toBe('mid-t1-rad')
  })

  it('a rejected action surfaces a reason to the player (not a silent drop)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          cooldowns: { q: 0, w: 0, e: 0, r: 0 },
          buffs: [{ id: 'silence', stacks: 1, ticksRemaining: 5, source: ENEMY }],
        },
      },
    }))

    game.cast('q', { kind: 'hero', name: ENEMY })
    await game.tick()

    // The cast is rejected with a player-readable reason via the same channel
    // the live game forwards through onActionRejected — not silently swallowed.
    expect(
      game.lastRejected.some((r) => r.playerId === HUMAN && r.reason.includes('silenced')),
    ).toBe(true)
  })

  it('casting a damage ability on a co-located enemy deals damage (echo Q — Resonance)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, cooldowns: { q: 0, w: 0, e: 0, r: 0 } },
      },
    }))

    game.cast('q', { kind: 'hero', name: ENEMY })
    await game.tick()

    // A caster→enemy damage event is the regen-independent "the spell landed"
    // signal (raw enemy HP is confounded by regen + the level-6 maxHp recompute).
    expect(
      game.lastEvents.some(
        (e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === ENEMY,
      ),
    ).toBe(true)
    expect((await game.me()).cooldowns.q).toBeGreaterThan(0)
  })

  it('casting a DoT ability leaves a lasting debuff on the target (daemon Q — Inject)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'daemon', heroEnemy: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, cooldowns: { q: 0, w: 0, e: 0, r: 0 } },
        [ENEMY]: { ...s.players[ENEMY]!, buffs: [] },
      },
    }))

    game.cast('q', { kind: 'hero', name: ENEMY })
    await game.tick()

    // Inject applies a multi-tick damage-over-time debuff on the target (a 1-tick
    // disable like a stun would already be gone by now — tickAllBuffs runs this
    // same tick — so a DoT is the observable "the debuff landed" signal).
    expect((await game.player(ENEMY)).buffs.some((b) => b.id.includes('dot'))).toBe(true)
  })

  it('magic immunity (BKB) fully blocks a magic ability — no damage to the target', async () => {
    // regex Q (Match) is 70 magical damage on a hero target.
    const game = await seedGame('laning_combat', { heroSelf: 'regex', heroEnemy: 'daemon' })

    const magicHit = () =>
      game.lastEvents.some(
        (e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === ENEMY,
      )

    // Sanity: without immunity the magic Q lands.
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, cooldowns: { q: 0, w: 0, e: 0, r: 0 } },
        [ENEMY]: { ...s.players[ENEMY]!, buffs: [] },
      },
    }))
    game.cast('q', { kind: 'hero', name: ENEMY })
    await game.tick()
    expect(magicHit()).toBe(true)

    // Now grant the target magic immunity and cast again — fully absorbed.
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, cooldowns: { q: 0, w: 0, e: 0, r: 0 } },
        [ENEMY]: {
          ...s.players[ENEMY]!,
          buffs: [{ id: 'magic_immune', stacks: 1, ticksRemaining: 5, source: ENEMY }],
        },
      },
    }))
    game.cast('q', { kind: 'hero', name: ENEMY })
    await game.tick()
    expect(magicHit()).toBe(false)
  })

  it('a cycloned hero is fully disabled — no move AND no cast, with feedback (Eul’s)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          zone: 'mid-river',
          cooldowns: { q: 0, w: 0, e: 0, r: 0 },
          buffs: [{ id: 'cyclone', stacks: 1, ticksRemaining: 5, source: ENEMY }],
        },
      },
    }))

    // Move is blocked — the hero stays put — and the reason reaches the player.
    game.submit({ type: 'move', zone: 'mid-t1-rad' })
    await game.tick()
    expect((await game.me()).zone).toBe('mid-river')
    expect(
      game.lastRejected.some((r) => r.playerId === HUMAN && r.reason.includes('cycloned')),
    ).toBe(true)

    // Unlike root/silence (which block one axis), the cyclone also blocks casting.
    game.cast('w')
    await game.tick()
    expect((await game.me()).cooldowns.w).toBe(0)
  })

  it('a cast on cooldown is rejected with the ability name, ticks left, and ready tick', async () => {
    // Design-brief quick win #1: rejections must say WHY and WHEN, concretely.
    const game = await seedGame('laning_combat', { heroSelf: 'daemon', heroEnemy: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, cooldowns: { q: 5, w: 0, e: 0, r: 0 }, buffs: [] },
      },
    }))

    game.cast('q', { kind: 'hero', name: ENEMY })
    await game.tick()

    const r = game.lastRejected.find((x) => x.playerId === HUMAN)
    expect(r?.reason).toContain('Inject') // the ability's NAME, not "ability"
    expect(r?.reason).toContain('cooldown')
    expect(r?.reason).toMatch(/5 ticks left/)
    expect(r?.reason).toMatch(/ready T\d+/)
  })

  it('a cast with too little mana is rejected with need-vs-have', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'daemon', heroEnemy: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, mp: 1, cooldowns: { q: 0, w: 0, e: 0, r: 0 }, buffs: [] },
      },
    }))

    game.cast('q', { kind: 'hero', name: ENEMY }) // Inject costs 50 mana
    await game.tick()

    const r = game.lastRejected.find((x) => x.playerId === HUMAN)
    expect(r?.reason).toContain('Not enough mana for Inject')
    expect(r?.reason).toMatch(/need \d+/) // the exact cost is hero/level-scaled
    expect(r?.reason).toContain('have 1')
  })

  it('Lotus Orb reflects a single-target nuke back at the caster (charge spent)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    // Settle the first-tick recompute, zero the caster's cooldowns, and give the
    // TARGET (ENEMY) a Lotus shell to reflect the incoming nuke.
    await game.tick()
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, cooldowns: { q: 0, w: 0, e: 0, r: 0 } },
        [ENEMY]: {
          ...s.players[ENEMY]!,
          buffs: [{ id: 'lotus_orb', stacks: 1, ticksRemaining: 5, source: ENEMY }],
        },
      },
    }))

    game.cast('q', { kind: 'hero', name: ENEMY }) // HUMAN nukes the Lotus holder (echo Q — Resonance)
    await game.tick()

    // The spell is reflected: a spell_blocked(lotus_orb) event carrying the bounced
    // amount, a damage event from the holder back at the caster, and the charge spent.
    const blocked = game.lastEvents.find(
      (e) => e._tag === 'spell_blocked' && e.source === 'lotus_orb',
    )
    expect(blocked).toBeDefined()
    expect(blocked?._tag === 'spell_blocked' && blocked.reflected).toBeGreaterThan(0)
    expect(
      game.lastEvents.some(
        (e) => e._tag === 'damage' && e.sourceId === ENEMY && e.targetId === HUMAN,
      ),
    ).toBe(true)
    // The Lotus charge is consumed (one-shot), so it's gone afterwards.
    expect((await game.player(ENEMY)).buffs.some((b) => b.id === 'lotus_orb')).toBe(false)
  })

  it('Linken’s Sphere blocks a single-target spell (fizzles it, spends the charge to 0)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.tick()
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, cooldowns: { q: 0, w: 0, e: 0, r: 0 } },
        [ENEMY]: {
          ...s.players[ENEMY]!,
          buffs: [{ id: 'spellblock', stacks: 1, ticksRemaining: 5, source: ENEMY }],
        },
      },
    }))

    game.cast('q', { kind: 'hero', name: ENEMY }) // HUMAN nukes a Linken's holder
    await game.tick()

    // The spell fizzles: a spell_blocked(linkens_sphere) event, NO damage to the
    // holder (reverted to pre-cast), and the charge spent to stacks 0 (recharging).
    const blocked = game.lastEvents.find(
      (e) => e._tag === 'spell_blocked' && e.source === 'linkens_sphere',
    )
    expect(blocked).toBeDefined()
    expect(
      game.lastEvents.some(
        (e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === ENEMY,
      ),
    ).toBe(false)
    const block = (await game.player(ENEMY)).buffs.find((b) => b.id === 'spellblock')
    expect(block?.stacks).toBe(0) // spent, not removed — Linken's auto-recharges
  })

  it('Firewall item blocks a single-target spell (fizzles it, consumes the one-shot)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.tick()
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, cooldowns: { q: 0, w: 0, e: 0, r: 0 } },
        [ENEMY]: {
          ...s.players[ENEMY]!,
          buffs: [{ id: 'firewall_block', stacks: 1, ticksRemaining: 30, source: ENEMY }],
        },
      },
    }))

    game.cast('q', { kind: 'hero', name: ENEMY })
    await game.tick()

    const blocked = game.lastEvents.find(
      (e) => e._tag === 'spell_blocked' && e.source === 'firewall_item',
    )
    expect(blocked).toBeDefined()
    expect(
      game.lastEvents.some(
        (e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === ENEMY,
      ),
    ).toBe(false)
    // The Firewall block is a one-shot — removed entirely after blocking.
    expect((await game.player(ENEMY)).buffs.some((b) => b.id === 'firewall_block')).toBe(false)
  })

  it('a hexed hero (Scythe of Vyse) is fully disabled — no move AND no cast, with feedback', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          zone: 'mid-river',
          cooldowns: { q: 0, w: 0, e: 0, r: 0 },
          buffs: [{ id: 'hex', stacks: 1, ticksRemaining: 5, source: ENEMY }],
        },
      },
    }))

    // Move is blocked — the hero stays put — and the reason reaches the player.
    game.submit({ type: 'move', zone: 'mid-t1-rad' })
    await game.tick()
    expect((await game.me()).zone).toBe('mid-river')
    expect(game.lastRejected.some((r) => r.playerId === HUMAN && r.reason.includes('hexed'))).toBe(
      true,
    )

    // Hex also blocks casting (a self-buff that would otherwise go on cooldown).
    game.cast('w')
    await game.tick()
    expect((await game.me()).cooldowns.w).toBe(0)
  })

  it('Ethereal Blade makes the target physical-immune but amplifies magic damage', async () => {
    // regex Q (Match) is 70 magical damage on a hero target.
    const game = await seedGame('laning_combat', { heroSelf: 'regex', heroEnemy: 'daemon' })
    await game.tick() // settle the level-6 maxHp recompute

    const dmgToEnemy = () =>
      game.lastEvents.find(
        (e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === ENEMY,
      )?.amount ?? 0

    // Baseline magic nuke — enemy clean and topped up (caster buffs cleared so
    // no stray amp drifts the comparison).
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, cooldowns: { q: 0, w: 0, e: 0, r: 0 }, buffs: [] },
        [ENEMY]: { ...s.players[ENEMY]!, buffs: [], hp: s.players[ENEMY]!.maxHp },
      },
    }))
    game.cast('q', { kind: 'hero', name: ENEMY })
    await game.tick()
    const baseMagic = dmgToEnemy()
    expect(baseMagic).toBeGreaterThan(0)

    // Ethereal'd: the same nuke hits substantially harder (+40% via magic_vuln_40).
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, cooldowns: { q: 0, w: 0, e: 0, r: 0 }, buffs: [] },
        [ENEMY]: {
          ...s.players[ENEMY]!,
          hp: s.players[ENEMY]!.maxHp,
          buffs: [
            { id: 'ethereal', stacks: 1, ticksRemaining: 6, source: HUMAN },
            { id: 'magic_vuln_40', stacks: 40, ticksRemaining: 6, source: HUMAN },
          ],
        },
      },
    }))
    game.cast('q', { kind: 'hero', name: ENEMY })
    await game.tick()
    expect(dmgToEnemy()).toBeGreaterThanOrEqual(Math.round(baseMagic * 1.3))

    // The other half: a basic (physical) attack on the still-ethereal target is
    // fully absorbed — no physical damage event.
    game.attackHero(ENEMY)
    await game.tick()
    expect(dmgToEnemy()).toBe(0)
  })

  it('Black King Bar grants debuff immunity — a BKB hero acts through a stun', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          cooldowns: { q: 0, w: 0, e: 0, r: 0 },
          buffs: [
            { id: 'stun', stacks: 1, ticksRemaining: 5, source: ENEMY },
            { id: 'magic_immune', stacks: 1, ticksRemaining: 5, source: HUMAN },
          ],
        },
      },
    }))

    // Stunned but BKB up → the self-buff W resolves (sets cooldown) instead of
    // being rejected, because magic immunity grants debuff immunity.
    game.cast('w')
    await game.tick()
    expect((await game.me()).cooldowns.w).toBeGreaterThan(0)
  })

  it('BKB debuff immunity covers movement (root) and attacks (stun) too', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })

    // Rooted + BKB → the move still goes through.
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          zone: 'mid-river',
          buffs: [
            { id: 'root', stacks: 1, ticksRemaining: 5, source: ENEMY },
            { id: 'magic_immune', stacks: 1, ticksRemaining: 5, source: HUMAN },
          ],
        },
      },
    }))
    game.submit({ type: 'move', zone: 'mid-t1-rad' })
    await game.tick()
    expect((await game.me()).zone).toBe('mid-t1-rad')

    // Stunned + BKB, co-located with the enemy → the attack still lands.
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          zone: s.players[ENEMY]!.zone,
          buffs: [
            { id: 'stun', stacks: 1, ticksRemaining: 5, source: ENEMY },
            { id: 'magic_immune', stacks: 1, ticksRemaining: 5, source: HUMAN },
          ],
        },
      },
    }))
    game.attackHero(ENEMY)
    await game.tick()
    expect(
      game.lastEvents.some(
        (e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === ENEMY,
      ),
    ).toBe(true)
  })

  it('BKB does NOT bypass Cyclone — it pierces magic immunity', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          cooldowns: { q: 0, w: 0, e: 0, r: 0 },
          buffs: [
            { id: 'cyclone', stacks: 1, ticksRemaining: 5, source: HUMAN },
            { id: 'magic_immune', stacks: 1, ticksRemaining: 5, source: HUMAN },
          ],
        },
      },
    }))

    // Cyclone is a hard disable that pierces BKB — the cast is still blocked.
    game.cast('w')
    await game.tick()
    expect((await game.me()).cooldowns.w).toBe(0)
    expect(
      game.lastRejected.some((r) => r.playerId === HUMAN && r.reason.includes('cycloned')),
    ).toBe(true)
  })

  it("Firewall's DMZ shield explodes for magical damage to nearby enemies when it ends", async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'firewall', heroEnemy: 'daemon' })
    await game.tick() // settle the level-6 maxHp recompute
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, cooldowns: { q: 0, w: 0, e: 0, r: 0 } },
      },
    }))

    // Cast DMZ (W) — applies the self-shield + the dmz marker (both 3 ticks).
    game.cast('w')
    await game.tick()
    const enemyBefore = (await game.player(ENEMY)).hp

    // Advance until the DMZ marker expires → it explodes on the co-located enemy.
    await game.tick(3)
    expect((await game.player(ENEMY)).hp).toBeLessThan(enemyBefore)
  })
})
