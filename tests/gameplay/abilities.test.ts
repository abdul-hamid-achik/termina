import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN, ENEMY } from './harness'
import { WAVE_ESCALATION_INTERVAL_TICKS, waveUnitMaxHp } from '~~/shared/constants/balance'

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
    game.submit({ type: 'move', zone: 'mid-t1-chaff' })
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
    game.submit({ type: 'move', zone: 'mid-t1-chaff' })
    await game.tick()
    expect((await game.me()).zone).toBe('mid-t1-chaff')
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
    // signal (raw enemy INTEG is confounded by regen + the level-6 maxInteg recompute).
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
    // regex Q (Match) is 70 code damage on a hero target.
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
          buffs: [{ id: 'airgap', stacks: 1, ticksRemaining: 5, source: ENEMY }],
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
    game.submit({ type: 'move', zone: 'mid-t1-chaff' })
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
        [HUMAN]: { ...s.players[HUMAN]!, bw: 1, cooldowns: { q: 0, w: 0, e: 0, r: 0 }, buffs: [] },
      },
    }))

    game.cast('q', { kind: 'hero', name: ENEMY }) // Inject costs 50 mana
    await game.tick()

    const r = game.lastRejected.find((x) => x.playerId === HUMAN)
    expect(r?.reason).toContain('Not enough BW for Inject')
    expect(r?.reason).toMatch(/need \d+/) // the exact cost is hero/level-scaled
    expect(r?.reason).toContain('have 1')
  })

  it('Mirror Shell reflects a single-target nuke back at the caster (charge spent)', async () => {
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
          buffs: [{ id: 'mirror_shell', stacks: 1, ticksRemaining: 5, source: ENEMY }],
        },
      },
    }))

    game.cast('q', { kind: 'hero', name: ENEMY }) // HUMAN nukes the Lotus holder (echo Q — Resonance)
    await game.tick()

    // The spell is reflected: a spell_blocked(mirror_shell) event carrying the bounced
    // amount, a damage event from the holder back at the caster, and the charge spent.
    const blocked = game.lastEvents.find(
      (e) => e._tag === 'spell_blocked' && e.source === 'mirror_shell',
    )
    expect(blocked).toBeDefined()
    expect(blocked?._tag === 'spell_blocked' && blocked.reflected).toBeGreaterThan(0)
    expect(
      game.lastEvents.some(
        (e) => e._tag === 'damage' && e.sourceId === ENEMY && e.targetId === HUMAN,
      ),
    ).toBe(true)
    // The Lotus charge is consumed (one-shot), so it's gone afterwards.
    expect((await game.player(ENEMY)).buffs.some((b) => b.id === 'mirror_shell')).toBe(false)
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

    // The spell fizzles: a spell_blocked(intercept_shell) event, NO damage to the
    // holder (reverted to pre-cast), and the charge spent to stacks 0 (recharging).
    const blocked = game.lastEvents.find(
      (e) => e._tag === 'spell_blocked' && e.source === 'intercept_shell',
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

  it('Ablative Shell blocks a single-target spell (fizzles it, consumes the one-shot)', async () => {
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
      (e) => e._tag === 'spell_blocked' && e.source === 'ablative_shell',
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

  it('Intercept Shell blocks a targeted ITEM active (Burnout), not just abilities', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.tick()
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          items: [...s.players[HUMAN]!.items, 'burnout'],
          buffs: [],
        },
        [ENEMY]: {
          ...s.players[ENEMY]!,
          buffs: [{ id: 'spellblock', stacks: 1, ticksRemaining: 5, source: ENEMY }],
        },
      },
    }))
    const enemyBefore = (await game.player(ENEMY)).integ

    game.submit({ type: 'use', item: 'burnout', target: { kind: 'hero', name: ENEMY } })
    await game.tick()

    // The item nuke fizzles: spell_blocked(intercept_shell), no INTEG lost (reverted),
    // charge spent to 0. Before the fix the block path only covered ability casts.
    expect(
      game.lastEvents.some((e) => e._tag === 'spell_blocked' && e.source === 'intercept_shell'),
    ).toBe(true)
    expect((await game.player(ENEMY)).integ).toBe(enemyBefore)
    expect((await game.player(ENEMY)).buffs.find((b) => b.id === 'spellblock')?.stacks).toBe(0)
  })

  it('Mirror Shell reflects a targeted ITEM nuke (Burnout) back at the user', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.tick()
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          items: [...s.players[HUMAN]!.items, 'burnout'],
          buffs: [],
        },
        [ENEMY]: {
          ...s.players[ENEMY]!,
          buffs: [{ id: 'mirror_shell', stacks: 1, ticksRemaining: 5, source: ENEMY }],
        },
      },
    }))
    const enemyBefore = (await game.player(ENEMY)).integ

    game.submit({ type: 'use', item: 'burnout', target: { kind: 'hero', name: ENEMY } })
    await game.tick()

    const blocked = game.lastEvents.find(
      (e) => e._tag === 'spell_blocked' && e.source === 'mirror_shell',
    )
    expect(blocked).toBeDefined()
    expect(blocked?._tag === 'spell_blocked' && blocked.reflected).toBeGreaterThan(0)
    expect(
      game.lastEvents.some(
        (e) => e._tag === 'damage' && e.sourceId === ENEMY && e.targetId === HUMAN,
      ),
    ).toBe(true)
    expect((await game.player(ENEMY)).integ).toBe(enemyBefore) // negated on the holder
    expect((await game.player(ENEMY)).buffs.some((b) => b.id === 'mirror_shell')).toBe(false)
  })

  it('Intercept Shell negates a disable-only ITEM active (Scythe hex) with no damage', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.tick()
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          items: [...s.players[HUMAN]!.items, 'lockout_shunt'],
          buffs: [],
        },
        [ENEMY]: {
          ...s.players[ENEMY]!,
          buffs: [{ id: 'spellblock', stacks: 1, ticksRemaining: 5, source: ENEMY }],
        },
      },
    }))

    game.submit({ type: 'use', item: 'lockout_shunt', target: { kind: 'hero', name: ENEMY } })
    await game.tick()

    // The hex is fully negated — no hex buff lands, the charge is spent, and the
    // reflect is 0 (a disable carries no INTEG loss to bounce).
    const blocked = game.lastEvents.find(
      (e) => e._tag === 'spell_blocked' && e.source === 'intercept_shell',
    )
    expect(blocked).toBeDefined()
    expect((await game.player(ENEMY)).buffs.some((b) => b.id === 'hex')).toBe(false)
    expect((await game.player(ENEMY)).buffs.find((b) => b.id === 'spellblock')?.stacks).toBe(0)
  })

  it('a taunted enemy is forced to attack the taunter even when idle (Kernel/Firewall E)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.tick()
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [ENEMY]: {
          ...s.players[ENEMY]!,
          buffs: [{ id: 'taunt', stacks: 1, ticksRemaining: 2, source: HUMAN }],
        },
      },
    }))

    // ENEMY submits nothing — the taunt overrides into a forced attack on HUMAN
    // (the taunter), so a damage event flows from ENEMY back at HUMAN.
    await game.tick()
    expect(
      game.lastEvents.some(
        (e) => e._tag === 'damage' && e.sourceId === ENEMY && e.targetId === HUMAN,
      ),
    ).toBe(true)
  })

  it('a BKB (airgap) hero ignores taunt — not forced to attack the taunter', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.tick()
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [ENEMY]: {
          ...s.players[ENEMY]!,
          buffs: [
            { id: 'taunt', stacks: 1, ticksRemaining: 2, source: HUMAN },
            { id: 'airgap', stacks: 1, ticksRemaining: 5, source: ENEMY },
          ],
        },
      },
    }))

    await game.tick()
    // BKB pierces the taunt: the idle ENEMY is NOT force-attacked into HUMAN.
    expect(
      game.lastEvents.some(
        (e) => e._tag === 'damage' && e.sourceId === ENEMY && e.targetId === HUMAN,
      ),
    ).toBe(false)
  })

  it('a hexed hero (Lockout Shunt) is fully disabled — no move AND no cast, with feedback', async () => {
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
    game.submit({ type: 'move', zone: 'mid-t1-chaff' })
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

  it('Phase Shim makes the target kinetic-immune but amplifies code damage', async () => {
    // regex Q (Match) is 70 code damage on a hero target.
    const game = await seedGame('laning_combat', { heroSelf: 'regex', heroEnemy: 'daemon' })
    await game.tick() // settle the level-6 maxInteg recompute

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
        [ENEMY]: { ...s.players[ENEMY]!, buffs: [], integ: s.players[ENEMY]!.maxInteg },
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
          integ: s.players[ENEMY]!.maxInteg,
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

    // The other half: a basic (kinetic) attack on the still-ethereal target is
    // fully absorbed — no kinetic damage event.
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
            { id: 'airgap', stacks: 1, ticksRemaining: 5, source: HUMAN },
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
            { id: 'airgap', stacks: 1, ticksRemaining: 5, source: HUMAN },
          ],
        },
      },
    }))
    game.submit({ type: 'move', zone: 'mid-t1-chaff' })
    await game.tick()
    expect((await game.me()).zone).toBe('mid-t1-chaff')

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
            { id: 'airgap', stacks: 1, ticksRemaining: 5, source: HUMAN },
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
            { id: 'airgap', stacks: 1, ticksRemaining: 5, source: HUMAN },
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

  it("Firewall's DMZ shield explodes for code damage to nearby enemies when it ends", async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'firewall', heroEnemy: 'daemon' })
    await game.tick() // settle the level-6 maxInteg recompute
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
    const enemyBefore = (await game.player(ENEMY)).integ

    // Advance until the DMZ marker expires → it explodes on the co-located enemy.
    await game.tick(3)
    expect((await game.player(ENEMY)).integ).toBeLessThan(enemyBefore)
  })

  it('DMZ explosion now emits a damage event from the caster (kill credit + damage_taken passives)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'firewall', heroEnemy: 'daemon' })
    await game.tick() // settle the level-6 maxInteg recompute
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, cooldowns: { q: 0, w: 0, e: 0, r: 0 } },
      },
    }))

    game.cast('w')
    await game.tick()
    const enemyBefore = (await game.player(ENEMY)).integ
    await game.tick(3) // dmz expires → explosion

    // Bug: the blast changed INTEG but emitted NO damage event, so a lethal blast
    // gave no kill credit/bounty/XP and the victim's damage_taken passives never
    // fired. The only HUMAN→ENEMY code damage this match is the explosion.
    expect((await game.player(ENEMY)).integ).toBeLessThan(enemyBefore)
    const blast = game.allEvents.find(
      (e) =>
        e._tag === 'damage' &&
        e.sourceId === HUMAN &&
        e.targetId === ENEMY &&
        e.damageType === 'code',
    )
    expect(blast).toBeDefined()
    expect(blast!._tag === 'damage' && blast!.amount).toBeGreaterThan(0)
  })

  it('attacking a phase-shifted enemy deals no damage and emits no damage event (no false credit)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.tick() // settle maxInteg
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [ENEMY]: {
          ...s.players[ENEMY]!,
          buffs: [{ id: 'phaseShift', stacks: 1, ticksRemaining: 5, source: ENEMY }],
        },
      },
    }))
    const enemyBefore = (await game.player(ENEMY)).integ

    game.attackHero(ENEMY)
    await game.tick()

    // Dodge: no INTEG lost (regen only ever adds), the phaseShift is consumed, and —
    // the fix — NO damage event is emitted, so the attacker gets no false
    // kill/assist credit and the victim's damage_taken passives don't fire.
    expect((await game.player(ENEMY)).integ).toBeGreaterThanOrEqual(enemyBefore)
    expect((await game.player(ENEMY)).buffs.some((b) => b.id === 'phaseShift')).toBe(false)
    expect(
      game.lastEvents.some(
        (e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === ENEMY,
      ),
    ).toBe(false)
  })

  it('Silver Edge empowers only the first attack from invis, then consumes the bonus + breaks stealth', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.tick() // settle maxInteg
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          buffs: [
            { id: 'ghostwire_edge_invis', stacks: 1, ticksRemaining: 3, source: 'ghostwire_edge' },
            {
              id: 'ghostwire_edge_bonus',
              stacks: 150,
              ticksRemaining: 3,
              source: 'ghostwire_edge',
            },
          ],
        },
      },
    }))

    game.attackHero(ENEMY)
    await game.tick()

    // Bug: the +bonus applied to EVERY attack and invis never broke. Now one
    // attack consumes both — so it can't keep empowering and stealth ends.
    const me = await game.me()
    expect(me.buffs.some((b) => b.id === 'ghostwire_edge_invis')).toBe(false)
    expect(me.buffs.some((b) => b.id === 'ghostwire_edge_bonus')).toBe(false)
  })
})

/**
 * Waveclear. Standing in lane with a wave in front of you and no enemy hero in
 * the zone is the NORMAL early game, and until now every AoE ability was dead
 * weight there: no ability in the game could touch a wave or a neutral, so the
 * only verb that worked on the board in front of you was `attack wave:N`.
 */
describe('abilities vs waves', () => {
  const LANE = 'mid-river'

  /** Seed the human alone in a lane with `hp`-strong enemy waves in front. The
   *  BW pool is widened to the level being faked, since the per-tick recalc
   *  that would grow it only runs AFTER the cast phase. */
  async function laneWithWave(heroSelf: 'mutex' | 'null_ref', waveHp: number[], level = 6) {
    const game = await seedGame('laning_combat', { heroSelf })
    const me = await game.me()
    const enemyTeam = me.team === 'chaff' ? 'audit' : 'chaff'
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          zone: LANE,
          level,
          bw: 900,
          maxBw: 900,
          cooldowns: { q: 0, w: 0, e: 0, r: 0 },
        },
        [ENEMY]: { ...s.players[ENEMY]!, zone: 'audit-fountain' },
      },
      waves: waveHp.map((integ, i) => ({
        id: `wave_${i}`,
        team: enemyTeam,
        zone: LANE,
        integ,
        maxInteg: integ,
        type: 'line' as const,
      })),
    }))
    return game
  }

  it('an AoE cast damages every enemy wave in the zone at once', async () => {
    const game = await laneWithWave('mutex', [400, 400, 400])

    game.cast('e')
    await game.tick()

    const waves = (await game.state()).waves.filter((c) => c.id.startsWith('wave_'))
    expect(waves).toHaveLength(3)
    for (const c of waves) expect(c.integ).toBeLessThan(400)
  })

  it('an ability that finishes a wave banks the bounty and emits wave_strip', async () => {
    const game = await laneWithWave('mutex', [30, 400])
    const goldBefore = (await game.me()).gold

    game.cast('e')
    await game.tick()

    expect(game.lastEvents.some((e) => e._tag === 'wave_strip' && e.playerId === HUMAN)).toBe(true)
    expect((await game.me()).gold).toBeGreaterThan(goldBefore)
    // Reaped from the board by WaveAI the same tick, like any other wave death.
    expect((await game.state()).waves.some((c) => c.id === 'wave_0')).toBe(false)
  })

  it('a wave that has escalated past the nuke survives it — the same cast, a later tick', async () => {
    // Ability damage is flat while wave INTEG compounds with match time, so the
    // tick a cast lands on decides whether it clears the wave. Every other
    // ability fixture sits near tick 0 where the escalation multiplier is 1.0
    // and that relationship is invisible.
    const lateTick = WAVE_ESCALATION_INTERVAL_TICKS * 3
    const freshMax = waveUnitMaxHp('line', 0)
    const lateMax = waveUnitMaxHp('line', lateTick)
    expect(lateMax).toBeGreaterThan(freshMax * 1.5)

    // null_ref R at rank 3 (level 18) is 480 — more than a fresh wave's 400,
    // less than an escalated one's.
    const early = await laneWithWave('null_ref', [freshMax], 18)
    early.cast('r')
    await early.tick()
    expect(early.lastEvents.some((e) => e._tag === 'wave_strip')).toBe(true)

    const late = await laneWithWave('null_ref', [lateMax], 18)
    await late.patch((s) => ({ ...s, tick: lateTick }))
    late.cast('r')
    await late.tick()
    expect(late.lastEvents.some((e) => e._tag === 'wave_strip')).toBe(false)
    const survivor = (await late.state()).waves.find((c) => c.id === 'wave_0')
    expect(survivor && survivor.integ > 0 && survivor.integ < lateMax).toBe(true)
  })

  it('the AOE+ talent widens the cast over the NEXT lane’s wave too', async () => {
    // Mirrors the hero-facing aoe_bonus test in talents.test.ts: the widened
    // footprint the talent grants has to reach waves as well, or Cascading
    // Dereference reads as a talent that only works when a hero is standing there.
    const game = await seedGame('laning_combat', { heroSelf: 'null_ref' })
    const setup = (tier25: string | null) =>
      game.patch((s) => ({
        ...s,
        players: {
          ...s.players,
          [HUMAN]: {
            ...s.players[HUMAN]!,
            zone: 'mid-river',
            level: 6,
            bw: 500,
            maxBw: 500,
            cooldowns: { q: 0, w: 0, e: 0, r: 0 },
            talents: { tier10: null, tier15: null, tier20: null, tier25 },
          },
          [ENEMY]: { ...s.players[ENEMY]!, zone: 'audit-fountain' },
        },
        // mid-t1-audit IS adjacent to mid-river.
        waves: [
          {
            id: 'next_lane',
            team: 'audit',
            zone: 'mid-t1-audit',
            integ: 400,
            maxInteg: 400,
            type: 'line',
          },
        ],
      }))
    const waveHp = async () =>
      (await game.state()).waves.find((c) => c.id === 'next_lane')?.integ ?? 0

    await setup(null)
    game.cast('r')
    await game.tick()
    expect(await waveHp()).toBe(400)

    await setup('null_ref_25_right')
    game.cast('r')
    await game.tick()
    expect(await waveHp()).toBeLessThan(400)
  })

  it('an AoE cast leaves your own wave alone', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'mutex' })
    const me = await game.me()
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, zone: LANE, cooldowns: { q: 0, w: 0, e: 0, r: 0 } },
      },
      waves: [{ id: 'mine', team: me.team, zone: LANE, integ: 400, maxInteg: 400, type: 'line' }],
    }))

    game.cast('e')
    await game.tick()

    const mine = (await game.state()).waves.find((c) => c.id === 'mine')
    expect(mine?.integ).toBe(400)
  })
})
