import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN } from './harness'

/**
 * Engine-truth coverage for the Tenant / backup objective loop, driven through
 * the real processTick (no browser/server/DB). Tenant can only be hit from the
 * pit; killing it drops the backup on the ground; a hero in the pit then claims
 * it with the `backup` action and gains the respawn buff.
 */
describe('objectives: Tenant & backup', () => {
  it('a hero in the pit kills Tenant — it dies and the backup drops to the ground', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'hollow' } },
      // Tenant alive at 1 HP — any basic attack finishes it.
      tenant: { ...s.tenant, alive: true, hp: 1 },
      backup: null,
    }))

    game.submit({ type: 'attack', target: { kind: 'tenant' } })
    await game.tick()

    const state = await game.state()
    expect(state.tenant.alive).toBe(false)
    expect(state.backup).not.toBeNull()
    expect(state.backup?.zone).toBe('hollow')
    expect(game.lastEvents.some((e) => e._tag === 'tenant_killed')).toBe(true)
  })

  it('Tenant cannot be hit from outside the pit (the zone gate holds)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'mid-river' } },
      tenant: { ...s.tenant, alive: true, hp: 100 },
      backup: null,
    }))

    game.submit({ type: 'attack', target: { kind: 'tenant' } })
    await game.tick()

    const state = await game.state()
    expect(state.tenant.alive).toBe(true)
    expect(state.tenant.hp).toBe(100) // untouched from the wrong zone
    expect(state.backup).toBeNull()
    // ...and the player is told why, rather than the attack vanishing silently.
    expect(
      game.lastRejected.some((r) => r.playerId === HUMAN && r.reason.includes('from the pit')),
    ).toBe(true)
  })

  it('a hero in the pit claims a grounded backup and gains the backup buff', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'hollow', buffs: [] } },
      backup: { zone: 'hollow', tick: s.tick, holderId: null },
    }))

    game.submit({ type: 'backup' })
    await game.tick()

    const me = await game.me()
    expect(me.buffs.some((b) => b.id === 'backup')).toBe(true)
    // The ground backup is consumed on pickup.
    expect((await game.state()).backup).toBeNull()
  })

  it('an backup holder who dies is reborn at full HP, consuming the backup (the payoff)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => {
      const me = s.players[HUMAN]!
      return {
        ...s,
        players: {
          ...s.players,
          [HUMAN]: {
            ...me,
            alive: false, // just died this tick…
            respawnTick: null, // …and not yet sent to the respawn queue
            hp: 0,
            buffs: [{ id: 'backup', stacks: 300, ticksRemaining: 300, source: 'tenant' }],
          },
        },
      }
    })

    await game.tick()

    const me = await game.me()
    expect(me.alive).toBe(true) // reborn, not respawning
    expect(me.respawnTick).toBeNull()
    expect(me.hp).toBe(me.maxHp) // back at full HP
    expect(me.buffs.some((b) => b.id === 'backup')).toBe(false) // backup consumed
    expect(game.lastEvents.some((e) => e._tag === 'backup_used' && e.playerId === HUMAN)).toBe(true)
  })
})

describe('objectives: runes', () => {
  it('a hero claims a rune: gains the buff, the rune leaves the ground, and rune_picked fires', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'cache-top', buffs: [] } },
      runes: [{ zone: 'cache-top', type: 'haste', tick: s.tick }],
    }))

    game.submit({ type: 'rune' })
    await game.tick()

    const me = await game.me()
    expect(me.buffs.some((b) => b.id === 'haste')).toBe(true)
    const state = await game.state()
    expect(state.runes.some((r) => r.zone === 'cache-top')).toBe(false) // consumed
    expect(game.lastEvents.some((e) => e._tag === 'rune_picked' && e.playerId === HUMAN)).toBe(true)
  })

  it('a consumed rune cannot be claimed twice (no repeat buff)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'cache-top', buffs: [] } },
      runes: [{ zone: 'cache-top', type: 'dd', tick: s.tick }],
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

describe('objectives: jungle neutrals', () => {
  it('a hero in the camp last-hits a neutral — it dies, awards its bounty, emits neutral_killed', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'silt-chaff-top' } },
      // A kobold at 1 HP — one basic attack finishes it (bounty 20g / 25xp).
      neutrals: [
        { id: 'camp0', zone: 'silt-chaff-top', hp: 1, maxHp: 250, type: 'kobold', alive: true },
      ],
    }))

    const goldBefore = (await game.me()).gold
    game.submit({ type: 'attack', target: { kind: 'neutral', index: 0 } })
    await game.tick()

    const me = await game.me()
    // Bounty (20) dwarfs the 4/tick passive, so this isolates the camp gold.
    expect(me.gold).toBeGreaterThanOrEqual(goldBefore + 20)
    const state = await game.state()
    expect(state.neutrals.some((n) => n.id === 'camp0')).toBe(false) // removed on death
    expect(game.lastEvents.some((e) => e._tag === 'neutral_killed' && e.playerId === HUMAN)).toBe(
      true,
    )
  })

  it('a neutral cannot be hit from outside its camp zone', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'mid-river' } },
      neutrals: [
        { id: 'camp0', zone: 'silt-chaff-top', hp: 100, maxHp: 250, type: 'kobold', alive: true },
      ],
    }))

    game.submit({ type: 'attack', target: { kind: 'neutral', index: 0 } })
    await game.tick()

    const n = (await game.state()).neutrals.find((x) => x.id === 'camp0')
    expect(n?.alive).toBe(true)
    expect(n?.hp).toBe(100) // untouched from a different zone
    // ...with feedback instead of a silent drop.
    expect(
      game.lastRejected.some((r) => r.playerId === HUMAN && r.reason.includes('not in your zone')),
    ).toBe(true)
  })
})
