import { describe, it, expect } from 'vitest'
import { seedGame } from './harness'

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
})
