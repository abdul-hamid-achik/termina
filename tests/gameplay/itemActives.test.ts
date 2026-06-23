import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN, ENEMY } from './harness'

/**
 * Engine-truth coverage for item-active DAMAGE through the real processTick.
 * Item nukes (Dagon, Shiva's Guard) change HP inside useItem but historically
 * emitted no `damage` event, so an item kill credited no one — no kill count,
 * no bounty, no `kill` event, and the damage-taken passives never fired. This
 * locks in that item damage is now a first-class damage source (same path as
 * casts/attacks): it emits a `damage` event and feeds kill/bounty credit.
 */
describe('item-active combat credit', () => {
  it('a Dagon kill credits the user — kill count, a kill event, and a damage event', async () => {
    const game = await seedGame('laning', { heroSelf: 'echo', heroEnemy: 'daemon' })

    // Put both heroes in one zone, arm Dagon, and leave the enemy lethally low.
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          zone: 'mid-river',
          items: ['dagon', null, null, null, null, null],
        },
        [ENEMY]: { ...s.players[ENEMY]!, zone: 'mid-river', hp: 40, alive: true },
      },
    }))

    game.submit({ type: 'use', item: 'dagon', target: { kind: 'hero', name: 'daemon' } })
    await game.tick()

    const enemy = await game.player(ENEMY)
    const me = await game.me()

    expect(enemy.alive).toBe(false)
    // The fix: the item kill now credits the user (was 0 — killerId was null).
    expect(me.kills).toBe(1)
    expect(
      game.allEvents.some(
        (e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === ENEMY,
      ),
    ).toBe(true)
    expect(
      game.allEvents.some((e) => e._tag === 'kill' && e.killerId === HUMAN && e.victimId === ENEMY),
    ).toBe(true)
  })
})
