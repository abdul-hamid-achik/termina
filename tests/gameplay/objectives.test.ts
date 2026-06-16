import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN } from './harness'

/**
 * Engine-truth coverage for the Roshan / aegis objective loop, driven through
 * the real processTick (no browser/server/DB). Roshan can only be hit from the
 * pit; killing it drops the aegis on the ground; a hero in the pit then claims
 * it with the `aegis` action and gains the respawn buff.
 */
describe('objectives: Roshan & aegis', () => {
  it('a hero in the pit kills Roshan — it dies and the aegis drops to the ground', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'roshan-pit' } },
      // Roshan alive at 1 HP — any basic attack finishes it.
      roshan: { ...s.roshan, alive: true, hp: 1 },
      aegis: null,
    }))

    game.submit({ type: 'attack', target: { kind: 'roshan' } })
    await game.tick()

    const state = await game.state()
    expect(state.roshan.alive).toBe(false)
    expect(state.aegis).not.toBeNull()
    expect(state.aegis?.zone).toBe('roshan-pit')
    expect(game.lastEvents.some((e) => e._tag === 'roshan_killed')).toBe(true)
  })

  it('Roshan cannot be hit from outside the pit (the zone gate holds)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'mid-river' } },
      roshan: { ...s.roshan, alive: true, hp: 100 },
      aegis: null,
    }))

    game.submit({ type: 'attack', target: { kind: 'roshan' } })
    await game.tick()

    const state = await game.state()
    expect(state.roshan.alive).toBe(true)
    expect(state.roshan.hp).toBe(100) // untouched from the wrong zone
    expect(state.aegis).toBeNull()
  })

  it('a hero in the pit claims a grounded aegis and gains the aegis buff', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'roshan-pit', buffs: [] } },
      aegis: { zone: 'roshan-pit', tick: s.tick, holderId: null },
    }))

    game.submit({ type: 'aegis' })
    await game.tick()

    const me = await game.me()
    expect(me.buffs.some((b) => b.id === 'aegis')).toBe(true)
    // The ground aegis is consumed on pickup.
    expect((await game.state()).aegis).toBeNull()
  })
})

describe('objectives: runes', () => {
  it('a hero claims a rune: gains the buff, the rune leaves the ground, and rune_picked fires', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'rune-top', buffs: [] } },
      runes: [{ zone: 'rune-top', type: 'haste', tick: s.tick }],
    }))

    game.submit({ type: 'rune' })
    await game.tick()

    const me = await game.me()
    expect(me.buffs.some((b) => b.id === 'haste')).toBe(true)
    const state = await game.state()
    expect(state.runes.some((r) => r.zone === 'rune-top')).toBe(false) // consumed
    expect(game.lastEvents.some((e) => e._tag === 'rune_picked' && e.playerId === HUMAN)).toBe(true)
  })

  it('a consumed rune cannot be claimed twice (no repeat buff)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'rune-top', buffs: [] } },
      runes: [{ zone: 'rune-top', type: 'dd', tick: s.tick }],
    }))

    game.submit({ type: 'rune' })
    await game.tick()
    expect((await game.me()).buffs.filter((b) => b.id === 'dd')).toHaveLength(1)

    // The rune left the ground on the first pickup, so a second attempt is a
    // no-op — no second Double Damage buff (the bug this fix closes).
    game.submit({ type: 'rune' })
    await game.tick()
    expect((await game.me()).buffs.filter((b) => b.id === 'dd')).toHaveLength(1)
  })
})
