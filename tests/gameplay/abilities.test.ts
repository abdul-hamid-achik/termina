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

    // While stunned, the queued Q is rejected — it stays off cooldown.
    game.cast('q', { kind: 'hero', name: ENEMY })
    await game.tick()
    expect((await game.me()).cooldowns.q).toBe(0)

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

    // Rooted: a move to an adjacent zone is dropped — the hero stays put.
    game.submit({ type: 'move', zone: 'mid-t1-rad' })
    await game.tick()
    expect((await game.me()).zone).toBe('mid-river')

    // But casting is unaffected by root — the self-buff W resolves and goes on cooldown.
    game.cast('w')
    await game.tick()
    expect((await game.me()).cooldowns.w).toBeGreaterThan(0)
  })
})
