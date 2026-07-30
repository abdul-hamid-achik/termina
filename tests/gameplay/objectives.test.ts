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
      // Tenant alive at 1 INTEG — any basic attack finishes it.
      tenant: { ...s.tenant, alive: true, integ: 1 },
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
      tenant: { ...s.tenant, alive: true, integ: 100 },
      backup: null,
    }))

    game.submit({ type: 'attack', target: { kind: 'tenant' } })
    await game.tick()

    const state = await game.state()
    expect(state.tenant.alive).toBe(true)
    expect(state.tenant.integ).toBe(100) // untouched from the wrong zone
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

  it('an backup holder who dies is reborn at full INTEG, consuming the backup (the payoff)', async () => {
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
            integ: 0,
            buffs: [{ id: 'backup', stacks: 300, ticksRemaining: 300, source: 'tenant' }],
          },
        },
      }
    })

    await game.tick()

    const me = await game.me()
    expect(me.alive).toBe(true) // reborn, not respawning
    expect(me.respawnTick).toBeNull()
    expect(me.integ).toBe(me.maxInteg) // back at full INTEG
    expect(me.buffs.some((b) => b.id === 'backup')).toBe(false) // backup consumed
    expect(game.lastEvents.some((e) => e._tag === 'backup_used' && e.playerId === HUMAN)).toBe(true)
  })
})

describe('objectives: caches', () => {
  it('a hero claims a cache: gains the buff, the cache leaves the ground, and cache_picked fires', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'cache-top', buffs: [] } },
      caches: [{ zone: 'cache-top', type: 'haste', tick: s.tick }],
    }))

    game.submit({ type: 'grab' })
    await game.tick()

    const me = await game.me()
    expect(me.buffs.some((b) => b.id === 'haste')).toBe(true)
    const state = await game.state()
    expect(state.caches.some((r) => r.zone === 'cache-top')).toBe(false) // consumed
    expect(game.lastEvents.some((e) => e._tag === 'cache_picked' && e.playerId === HUMAN)).toBe(
      true,
    )
  })

  it('a consumed cache cannot be claimed twice (no repeat buff)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'cache-top', buffs: [] } },
      caches: [{ zone: 'cache-top', type: 'dd', tick: s.tick }],
    }))

    game.submit({ type: 'grab' })
    await game.tick()
    expect((await game.me()).buffs.filter((b) => b.id === 'dd')).toHaveLength(1)

    // The cache left the ground on the first pickup, so a second attempt is a
    // no-op — no second Double Damage buff (the bug this fix closes).
    game.submit({ type: 'grab' })
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
      // A stub at 1 INTEG — one basic attack finishes it (bounty 20g / 25xp).
      neutrals: [
        { id: 'camp0', zone: 'silt-chaff-top', integ: 1, maxInteg: 250, type: 'stub', alive: true },
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
        {
          id: 'camp0',
          zone: 'silt-chaff-top',
          integ: 100,
          maxInteg: 250,
          type: 'stub',
          alive: true,
        },
      ],
    }))

    game.submit({ type: 'attack', target: { kind: 'neutral', index: 0 } })
    await game.tick()

    const n = (await game.state()).neutrals.find((x) => x.id === 'camp0')
    expect(n?.alive).toBe(true)
    expect(n?.integ).toBe(100) // untouched from a different zone
    // ...with feedback instead of a silent drop.
    expect(
      game.lastRejected.some((r) => r.playerId === HUMAN && r.reason.includes('not in your zone')),
    ).toBe(true)
  })
})
