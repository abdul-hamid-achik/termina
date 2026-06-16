import { describe, it, expect } from 'vitest'
import { seedGame, ENEMY, HUMAN } from './harness'

/**
 * Replaces tests/e2e/flows/game_attack_lands.yml — a human basic attack on a
 * co-located enemy registers hero damage. damageDealt is the regen-independent
 * "the hit landed" signal the original flow used (raw enemy HP is confounded by
 * per-tick regen + the level-6 maxHp recompute).
 */
describe('combat', () => {
  it('attacking a co-located enemy deals hero damage after one tick', async () => {
    // laning_combat co-locates the human + the enemy mid-lane, both at level 6.
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })

    game.attackHero(ENEMY)
    await game.tick()

    const me = await game.me()
    expect(me.damageDealt).toBeGreaterThan(0)
  })

  it('Segfault Blade resets the killer cooldowns on a hero kill', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          items: ['segfault_blade', null, null, null, null, null],
          cooldowns: { q: 5, w: 5, e: 5, r: 5 },
        },
        [ENEMY]: { ...s.players[ENEMY]!, hp: 1 },
      },
    }))

    game.attackHero(ENEMY) // lethal — enemy is at 1 HP
    await game.tick()

    expect((await game.player(ENEMY)).alive).toBe(false)
    expect((await game.me()).cooldowns).toEqual({ q: 0, w: 0, e: 0, r: 0 })
  })

  it('Divine Rapier drops from the victim and is claimed by the killer on a hero kill', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, items: [null, null, null, null, null, null] }, // free slot
        [ENEMY]: {
          ...s.players[ENEMY]!,
          hp: 1,
          items: ['divine_rapier', null, null, null, null, null],
        },
      },
    }))

    game.attackHero(ENEMY) // lethal — enemy is at 1 HP
    await game.tick()

    expect((await game.player(ENEMY)).alive).toBe(false)
    // The Rapier left the victim and landed in the killer's inventory.
    expect((await game.player(ENEMY)).items).not.toContain('divine_rapier')
    expect((await game.me()).items).toContain('divine_rapier')
  })

  it('a damage-over-time debuff deals damage each tick and stops on expiry', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    // A 2-tick DoT on the enemy, sourced to the human. processDoTs treats any
    // buff whose id contains 'dot' as a DoT dealing `stacks` damage/tick.
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [ENEMY]: {
          ...s.players[ENEMY]!,
          buffs: [{ id: 'test_dot', stacks: 120, ticksRemaining: 2, source: HUMAN }],
        },
      },
    }))

    // The DoT is the only source of human→enemy damage (no action is queued), so
    // a matching damage event is the regen-independent "the tick dealt damage" signal.
    const dotTicked = () =>
      game.lastEvents.some(
        (e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === ENEMY,
      )

    await game.tick()
    expect(dotTicked()).toBe(true) // tick 1

    await game.tick()
    expect(dotTicked()).toBe(true) // tick 2 (last active tick)

    await game.tick()
    expect(dotTicked()).toBe(false) // expired — no more DoT damage
  })

  it('a dead hero respawns at full HP in the fountain once the respawn tick passes', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const startTick = (await game.state()).tick
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          alive: false,
          hp: 0,
          mp: 0,
          respawnTick: startTick + 5,
        },
      },
    }))

    await game.tick()
    expect((await game.me()).alive).toBe(false) // well before the respawn tick

    await game.tick(6) // now past the respawn tick
    const me = await game.me()
    expect(me.alive).toBe(true)
    expect(me.hp).toBe(me.maxHp)
    expect(me.respawnTick).toBeNull()
    expect(me.zone).toBe(me.team === 'radiant' ? 'radiant-fountain' : 'dire-fountain')
  })

  it('a shield buff absorbs an incoming attack before HP', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          hp: s.players[HUMAN]!.maxHp,
          buffs: [{ id: 'shield', stacks: 400, ticksRemaining: 5, source: HUMAN }],
        },
      },
    }))

    game.attackHero(HUMAN, ENEMY) // the co-located enemy swings at the shielded human
    await game.tick()

    // The basic-attack path ran absorbShield: the shield ate the hit, so its
    // stacks dropped. (Raw HP is confounded by the level-6 maxHp recompute on the
    // first tick, so the shield-stack delta is the clean "it absorbed" signal.)
    const shield = (await game.me()).buffs.find((b) => b.id === 'shield')
    expect(shield).toBeDefined()
    expect(shield!.stacks).toBeLessThan(400)
  })

  it('a hero sitting in its own fountain heals rapidly to full HP and mana', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => {
      const me = s.players[HUMAN]!
      const fountain = me.team === 'radiant' ? 'radiant-fountain' : 'dire-fountain'
      return {
        ...s,
        players: { ...s.players, [HUMAN]: { ...me, zone: fountain, hp: 50, mp: 0, buffs: [] } },
      }
    })

    const before = (await game.me()).hp
    await game.tick()
    const afterOne = await game.me()
    // Fountain heals ~15% of maxHp per tick — far more than base regen alone.
    expect(afterOne.hp).toBeGreaterThan(before + Math.floor(afterOne.maxHp * 0.1))

    // A handful of ticks tops the hero back off to full.
    await game.tick(8)
    const full = await game.me()
    expect(full.hp).toBe(full.maxHp)
    expect(full.mp).toBe(full.maxMp)
  })

  it('an in-combat hero gets NO fountain healing (the inCombat guard holds)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => {
      const me = s.players[HUMAN]!
      const fountain = me.team === 'radiant' ? 'radiant-fountain' : 'dire-fountain'
      return {
        ...s,
        players: {
          ...s.players,
          [HUMAN]: {
            ...me,
            zone: fountain,
            hp: 50,
            // The soft combat flag the engine checks before fountain healing.
            buffs: [{ id: 'inCombat', stacks: 1, ticksRemaining: 5, source: HUMAN }],
          },
        },
      }
    })

    const before = (await game.me()).hp
    await game.tick()
    const after = await game.me()
    // No 15% fountain heal — at most slow base regen, well under a 10% jump.
    expect(after.hp).toBeLessThan(before + Math.floor(after.maxHp * 0.1))
  })

  it('a hero standing in the enemy base destroys a vulnerable Ancient and wins', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => {
      const me = s.players[HUMAN]!
      const enemyTeam = me.team === 'radiant' ? 'dire' : 'radiant'
      const enemyBase = enemyTeam === 'radiant' ? 'radiant-base' : 'dire-base'
      return {
        ...s,
        players: { ...s.players, [HUMAN]: { ...me, zone: enemyBase } },
        ancients: {
          ...s.ancients,
          // Vulnerable (a T3 has fallen) and at 1 HP — any hit finishes it.
          [enemyTeam]: { ...s.ancients[enemyTeam], hp: 1, alive: true, vulnerable: true },
        },
      }
    })

    game.submit({ type: 'attack', target: { kind: 'ancient' } })
    await game.tick()

    const me = await game.me()
    const enemyTeam = me.team === 'radiant' ? 'dire' : 'radiant'
    const state = await game.state()
    expect(state.ancients[enemyTeam].alive).toBe(false)
    expect(state.winner).toBe(me.team)
    expect(game.lastEvents.some((e) => e._tag === 'ancient_destroyed')).toBe(true)
  })

  it('the Ancient is firewalled until a T3 falls — attacks bounce off while invulnerable', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => {
      const me = s.players[HUMAN]!
      const enemyTeam = me.team === 'radiant' ? 'dire' : 'radiant'
      const enemyBase = enemyTeam === 'radiant' ? 'radiant-base' : 'dire-base'
      return {
        ...s,
        players: { ...s.players, [HUMAN]: { ...me, zone: enemyBase } },
        ancients: {
          ...s.ancients,
          [enemyTeam]: { ...s.ancients[enemyTeam], hp: 500, alive: true, vulnerable: false },
        },
      }
    })

    game.submit({ type: 'attack', target: { kind: 'ancient' } })
    await game.tick()

    const me = await game.me()
    const enemyTeam = me.team === 'radiant' ? 'dire' : 'radiant'
    const ancient = (await game.state()).ancients[enemyTeam]
    // Firewalled: the attack is rejected, so the Ancient takes no damage and lives.
    expect(ancient.alive).toBe(true)
    expect(ancient.hp).toBe(500)
    expect((await game.state()).winner).toBeFalsy()
  })
})
