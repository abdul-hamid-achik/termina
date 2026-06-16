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
})
