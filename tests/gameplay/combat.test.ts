import { describe, it, expect } from 'vitest'
import { seedGame, ENEMY, HUMAN } from './harness'
import { calculateBuybackCost } from '~~/server/game/engine/BuybackSystem'
import { GLYPH_DURATION_TICKS } from '~~/shared/constants/balance'

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

  it('dealing hero damage marks BOTH combatants inCombat (the no-heal trigger)', async () => {
    // The gating ("no fountain heal while inCombat") is tested elsewhere with a
    // hand-placed buff; this covers the other half — applyInCombatBuffs actually
    // flagging the attacker AND the target off the damage event.
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })

    game.attackHero(ENEMY)
    await game.tick()

    const me = await game.me()
    const enemy = await game.player(ENEMY)
    expect(me.buffs.some((b) => b.id === 'inCombat')).toBe(true)
    expect(enemy.buffs.some((b) => b.id === 'inCombat')).toBe(true)
  })

  it('stored buyback cost reflects the death just taken (matches what buyback charges)', async () => {
    // Regression: the death handler computed buybackCost from the PRE-increment
    // death count, but buyback() recharges from the post-death count — so the
    // cost shown to the player was 10g (deaths*10) cheaper than what they'd be
    // charged, and a player with exactly the displayed gold got rejected.
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, items: [null, null, null, null, null, null] },
        [ENEMY]: { ...s.players[ENEMY]!, hp: 1, deaths: 3 },
      },
    }))

    game.attackHero(ENEMY)
    await game.tick()

    const victim = await game.player(ENEMY)
    expect(victim.alive).toBe(false)
    expect(victim.deaths).toBe(4)
    // The displayed cost must equal what buyback() will actually charge.
    expect(victim.buybackCost).toBe(calculateBuybackCost(victim))
  })

  it('killing a high-streak (fed) enemy pays the shutdown bounty (anti-snowball)', async () => {
    // Regression: the death handler reset the victim's killStreak to 0 BEFORE
    // awardKill read it, so the streak-scaled shutdown bounty was always 0 — the
    // whole "ending a fed player's run pays out" mechanic was dead. Two identical
    // games differing only in the victim's streak isolate the bonus (same roster
    // ⇒ same comeback multiplier ⇒ the only delta is the shutdown gold).
    async function killGain(victimStreak: number): Promise<number> {
      const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
      await game.patch((s) => ({
        ...s,
        players: {
          ...s.players,
          [HUMAN]: { ...s.players[HUMAN]!, items: [null, null, null, null, null, null] },
          [ENEMY]: { ...s.players[ENEMY]!, hp: 1, killStreak: victimStreak },
        },
      }))
      const before = (await game.me()).gold
      game.attackHero(ENEMY)
      await game.tick()
      return (await game.me()).gold - before
    }

    const cleanKill = await killGain(0)
    const shutdownKill = await killGain(6)
    expect(shutdownKill).toBeGreaterThan(cleanKill)
  })

  it('a kill ends the victim’s streak and grows the killer’s', async () => {
    // State side of the streak machine (the bounty side is covered above): the
    // fed victim's run is broken, and the killer's own snowball ticks up.
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, killStreak: 2 },
        [ENEMY]: { ...s.players[ENEMY]!, hp: 1, killStreak: 5 },
      },
    }))

    game.attackHero(ENEMY)
    await game.tick()

    const killer = await game.me()
    const victim = await game.player(ENEMY)
    expect(victim.alive).toBe(false)
    expect(victim.killStreak).toBe(0) // streak broken (anti-snowball)
    expect(killer.killStreak).toBe(3) // killer's own streak grew 2 → 3
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

  it('killing an enemy hero pays the killer its bounty — gold, XP, a kill credit, and a kill event', async () => {
    // The hero-kill bounty is the snowball engine of the whole match, but the
    // other kill tests only assert item side-effects (Segfault/Rapier). This
    // locks the reward itself: a clean kill (no kill-reward items) advances the
    // killer's economy and is correctly attributed.
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, items: [null, null, null, null, null, null] },
        [ENEMY]: { ...s.players[ENEMY]!, hp: 1 },
      },
    }))

    const before = await game.me()
    const victimBefore = await game.player(ENEMY)

    game.attackHero(ENEMY) // lethal — enemy is at 1 HP
    await game.tick()

    expect((await game.player(ENEMY)).alive).toBe(false)

    const me = await game.me()
    // Kill is attributed to the killer: kill count up and a kill event naming both.
    expect(me.kills).toBe(before.kills + 1)
    expect(
      game.lastEvents.some(
        (e) => e._tag === 'kill' && e.killerId === HUMAN && e.victimId === ENEMY,
      ),
    ).toBe(true)
    // The bounty advances the killer's economy (kill gold + kill XP). Passive
    // income only ever adds, so a strict increase isolates "rewarded, not idle".
    expect(me.gold).toBeGreaterThan(before.gold)
    expect(me.xp).toBeGreaterThan(before.xp)

    // The victim takes the death on its own ledger.
    expect((await game.player(ENEMY)).deaths).toBe(victimBefore.deaths + 1)
  })

  it('a teammate who chipped the victim earns an assist (credit + gold) on the kill', async () => {
    // The complement of the kill bounty: assists are how a support that never
    // lands the last hit still earns off a kill. A third ally chips the enemy,
    // then the human finishes it a tick later — within the 5-tick assist window —
    // so the ally is a windowed contributor while the human is the sole killer.
    const ALLY = 'ally'
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    const myKills = (await game.me()).kills
    await game.patch((s) => {
      const h = s.players[HUMAN]!
      const e = s.players[ENEMY]!
      return {
        ...s,
        players: {
          ...s.players,
          [HUMAN]: { ...h, zone: 'mid-river' },
          [ENEMY]: { ...e, zone: 'mid-river', hp: e.maxHp }, // healthy — survives the chip
          // A second radiant hero co-located with the enemy (distinct id/name so
          // attribution can't confuse it with the human).
          [ALLY]: {
            ...h,
            id: ALLY,
            name: 'Ally',
            zone: 'mid-river',
            kills: 0,
            deaths: 0,
            assists: 0,
          },
        },
      }
    })

    // Tick 1: the ally chips the enemy — registering as a recent damage contributor.
    game.attackHero(ENEMY, ALLY)
    await game.tick()
    expect((await game.player(ENEMY)).alive).toBe(true) // not lethal, just a chip

    // Tick 2 (within the window): drop the enemy to 1 HP and let the HUMAN finish it.
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [ENEMY]: { ...s.players[ENEMY]!, hp: 1 } },
    }))
    const allyBefore = await game.player(ALLY)
    game.attackHero(ENEMY, HUMAN)
    await game.tick()

    expect((await game.player(ENEMY)).alive).toBe(false)
    // The human owns the kill; the ally owns the assist (not a kill).
    expect((await game.me()).kills).toBe(myKills + 1)
    const ally = await game.player(ALLY)
    expect(ally.assists).toBe(allyBefore.assists + 1)
    expect(ally.kills).toBe(0)
    // Assist gold is paid out (a flat split; passive income only adds on top).
    expect(ally.gold).toBeGreaterThan(allyBefore.gold)
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

  it('handleDeaths sets a respawn timer that scales with hero level', async () => {
    // The respawn FORMULA is unit-tested in balance.test.ts; this guards the
    // APPLICATION — a higher-level hero serves a longer death penalty. Compared
    // relatively so it survives the TERMINA_TEST_FAST_GAME respawn rescale.
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        // Both freshly dead this tick (respawnTick null → handleDeaths assigns it).
        [HUMAN]: { ...s.players[HUMAN]!, level: 8, alive: false, hp: 0, respawnTick: null },
        [ENEMY]: { ...s.players[ENEMY]!, level: 1, alive: false, hp: 0, respawnTick: null },
      },
    }))

    await game.tick()

    const me = await game.me()
    const enemy = await game.player(ENEMY)
    expect(me.respawnTick).not.toBeNull()
    expect(enemy.respawnTick).not.toBeNull()
    // Both died on the same tick, so a later respawnTick = a longer wait.
    expect(me.respawnTick!).toBeGreaterThan(enemy.respawnTick!)
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
    // The firewall reason now reaches the player (previously server-logged only),
    // so the endgame "why won't it take damage?" moment isn't a mystery.
    expect(
      game.lastRejected.some((r) => r.playerId === HUMAN && r.reason.includes('firewall')),
    ).toBe(true)
  })

  it('attacking a tower from a different zone is rejected with feedback', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me = await game.me()
    const enemySuffix = me.team === 'radiant' ? 'dire' : 'rad'
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'mid-river' } },
    }))

    // The enemy mid-T1 stands in mid-t1-<suffix>, not mid-river — out of reach.
    game.submit({ type: 'attack', target: { kind: 'tower', zone: `mid-t1-${enemySuffix}` } })
    await game.tick()

    expect(
      game.lastRejected.some((r) => r.playerId === HUMAN && r.reason.includes('not in your zone')),
    ).toBe(true)
  })

  it('a backdoor-protected tower (its front tower still up) tells the player it is protected', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me = await game.me()
    const enemySuffix = me.team === 'radiant' ? 'dire' : 'rad'
    const t2Zone = `mid-t2-${enemySuffix}`
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: t2Zone } },
      // Standing at the T2 (attackable-shaped) while the T1 in front still stands,
      // so backdoor protection holds and the attack should bounce — with a reason.
      towers: s.towers.map((t) =>
        t.zone === t2Zone
          ? { ...t, alive: true, invulnerable: false }
          : t.zone === `mid-t1-${enemySuffix}`
            ? { ...t, alive: true }
            : t,
      ),
    }))

    game.submit({ type: 'attack', target: { kind: 'tower', zone: t2Zone } })
    await game.tick()

    expect(
      game.lastRejected.some((r) => r.playerId === HUMAN && r.reason.includes('protected')),
    ).toBe(true)
  })

  it('destroying a T3 tower lifts the enemy Ancient firewall (vulnerable flips true)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me = await game.me()
    const enemyTeam = me.team === 'radiant' ? 'dire' : 'radiant'

    // Precondition: with every T3 standing, the enemy Ancient is firewalled.
    expect((await game.state()).ancients[enemyTeam].vulnerable).toBe(false)

    // Drop one of the enemy's T3 towers; the next tick recomputes vulnerability.
    await game.patch((s) => ({
      ...s,
      towers: s.towers.map((t) =>
        t.team === enemyTeam && t.zone.includes('-t3-') ? { ...t, alive: false, hp: 0 } : t,
      ),
    }))
    await game.tick()

    expect((await game.state()).ancients[enemyTeam].vulnerable).toBe(true)
  })

  it('a dead player with gold buys back — instantly alive at the fountain, gold spent', async () => {
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
          respawnTick: startTick + 30, // genuinely dead, far from a natural respawn
          gold: 10_000, // plenty for the buyback cost
        },
      },
    }))

    const goldBefore = (await game.me()).gold
    game.submit({ type: 'buyback' })
    await game.tick()

    const me = await game.me()
    expect(me.alive).toBe(true)
    expect(me.respawnTick).toBeNull()
    expect(me.gold).toBeLessThan(goldBefore) // paid the buyback cost
    expect(me.zone).toBe(me.team === 'radiant' ? 'radiant-fountain' : 'dire-fountain')
  })

  it('buyback is refused with insufficient gold — the hero stays dead and keeps its gold', async () => {
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
          respawnTick: startTick + 30,
          gold: 0,
        },
      },
    }))

    game.submit({ type: 'buyback' })
    await game.tick()

    const me = await game.me()
    expect(me.alive).toBe(false)
    expect(me.gold).toBe(0)
  })

  it('buyback goes on cooldown — a second buyback right after is refused with feedback', async () => {
    // The anti-abuse rule the death overlay surfaces: you can't chain buybacks.
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          alive: false,
          hp: 0,
          respawnTick: s.tick + 50,
          gold: 10_000,
          buybackCooldown: null, // no prior buyback
        },
      },
    }))

    // First buyback lands — instantly alive — and arms the buyback cooldown.
    game.submit({ type: 'buyback' })
    await game.tick()
    expect((await game.me()).alive).toBe(true)
    expect((await game.me()).buybackCooldown ?? 0).toBeGreaterThan((await game.state()).tick)

    // Die again while that cooldown is still ticking (the patch keeps it set).
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, alive: false, hp: 0, respawnTick: s.tick + 50 },
      },
    }))

    // The second buyback is refused — the hero stays dead and is told why.
    game.submit({ type: 'buyback' })
    await game.tick()
    expect((await game.me()).alive).toBe(false)
    expect(
      game.lastRejected.some((r) => r.playerId === HUMAN && r.reason.includes('cooldown')),
    ).toBe(true)
  })

  it('a tower fires on a lone enemy hero diving it (no creeps to tank)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    // Tick once up front so the level-6 maxHp recompute is already settled —
    // otherwise the first-tick HP inflation masks the tower hit.
    await game.tick()
    await game.patch((s) => {
      const me = s.players[HUMAN]!
      const enemyTowerZone = me.team === 'radiant' ? 'mid-t1-dire' : 'mid-t1-rad'
      return {
        ...s,
        players: { ...s.players, [HUMAN]: { ...me, zone: enemyTowerZone, hp: 400 } },
        creeps: [], // nothing to soak the tower
      }
    })

    const before = (await game.me()).hp
    await game.tick()
    // TOWER_ATTACK (120, minus defense) far exceeds per-tick regen, so the
    // exposed hero visibly loses HP.
    expect((await game.me()).hp).toBeLessThan(before)
  })

  it('creeps tank the tower — a hero behind its own creep takes no tower fire', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.tick() // settle the maxHp recompute first
    await game.patch((s) => {
      const me = s.players[HUMAN]!
      const enemyTowerZone = me.team === 'radiant' ? 'mid-t1-dire' : 'mid-t1-rad'
      return {
        ...s,
        players: { ...s.players, [HUMAN]: { ...me, zone: enemyTowerZone, hp: 400 } },
        // An allied creep (same team as the hero) soaks the tower instead.
        creeps: [{ id: 'shield0', team: me.team, zone: enemyTowerZone, hp: 300, type: 'melee' }],
      }
    })

    const before = (await game.me()).hp
    await game.tick()

    // The hero is shielded — the tower shot the creep, not the hero (HP only
    // moves up via regen, never down).
    expect((await game.me()).hp).toBeGreaterThanOrEqual(before)
    const creep = (await game.state()).creeps.find((c) => c.id === 'shield0')
    expect(creep && creep.hp < 300).toBe(true)
  })

  it('using Glyph turns all of the team’s towers invulnerable', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me = await game.me()

    game.submit({ type: 'glyph' })
    await game.tick()

    const myTowers = (await game.state()).towers.filter((t) => t.team === me.team)
    expect(myTowers.length).toBeGreaterThan(0)
    expect(myTowers.every((t) => t.invulnerable)).toBe(true)
    expect(game.lastEvents.some((e) => e._tag === 'glyph_used')).toBe(true)
  })

  it('Glyph cannot be reused while on cooldown', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })

    // First glyph: sets the team's glyph cooldown.
    game.submit({ type: 'glyph' })
    await game.tick()
    expect(game.lastEvents.some((e) => e._tag === 'glyph_used')).toBe(true)

    // Second glyph one tick later: still on cooldown, so it's rejected.
    game.submit({ type: 'glyph' })
    await game.tick()
    expect(game.lastEvents.some((e) => e._tag === 'glyph_on_cooldown')).toBe(true)
  })

  it('Glyph wears off after GLYPH_DURATION_TICKS — towers become vulnerable again', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me = await game.me()
    const team = me.team

    // Simulate a glyph cast that's now exactly past its duration: invulnerable
    // towers + a glyphUsedTick old enough that expireGlyph should lift it.
    await game.patch((s) => ({
      ...s,
      teams: {
        ...s.teams,
        [team]: { ...s.teams[team]!, glyphUsedTick: s.tick - GLYPH_DURATION_TICKS },
      },
      towers: s.towers.map((t) => (t.team === team ? { ...t, invulnerable: true } : t)),
    }))

    await game.tick()

    const myTowers = (await game.state()).towers.filter((t) => t.team === team)
    expect(myTowers.length).toBeGreaterThan(0)
    expect(myTowers.every((t) => !t.invulnerable)).toBe(true)
  })

  // Characterization test (documents current behaviour + a known gap). The
  // client UI only ever offers in-zone targets, but a raw/stale command can
  // still name an out-of-zone hero. Today the engine drops such an attack
  // BEFORE validateAction (which only gates stun/fear) — so it deals no damage
  // AND surfaces no rejection reason. If a future change adds whiffed-attack
  // feedback, this test should be updated to assert the new reason.
  it('an attack whiffs WITH feedback when the target jukes out of the zone mid-tick', async () => {
    // The legitimate "silent drop" case: the target is co-located at tick start
    // (so anti-cheat's VISION_BYPASS lets the swing through) but steps away during
    // the movement phase, which resolves before attacks. Previously the swing
    // vanished with no explanation; now the player is told it hit empty air.
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, zone: 'mid-river' },
        [ENEMY]: { ...s.players[ENEMY]!, zone: 'mid-river' }, // co-located at tick start
      },
    }))

    // Both act at once: the enemy juke-steps to an adjacent zone while the human
    // swings. By the attack phase the target has left.
    game.submit({ type: 'move', zone: 'mid-t1-rad' }, ENEMY)
    game.attackHero(ENEMY)
    await game.tick()

    expect((await game.me()).damageDealt).toBe(0) // juked — no damage
    expect(
      game.lastRejected.some((r) => r.playerId === HUMAN && r.reason.includes('not in your zone')),
    ).toBe(true)
  })

  it('armor from an item reduces incoming basic-attack damage (defense applies)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })

    const dmgToHuman = () =>
      game.lastEvents.find(
        (e) => e._tag === 'damage' && e.sourceId === ENEMY && e.targetId === HUMAN,
      )?.amount ?? 0

    // Baseline: both inventories empty (clearing the enemy's removes crit
    // variance), the co-located enemy swings at the human.
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, items: [null, null, null, null, null, null] },
        [ENEMY]: { ...s.players[ENEMY]!, items: [null, null, null, null, null, null] },
      },
    }))
    game.attackHero(HUMAN, ENEMY) // ENEMY swings at HUMAN
    await game.tick()
    const before = dmgToHuman()
    expect(before).toBeGreaterThan(0)

    // Chainmail (+5 defense) raises getEffectiveDefense, so the same swing hurts less.
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, items: ['chainmail', null, null, null, null, null] },
      },
    }))
    game.attackHero(HUMAN, ENEMY)
    await game.tick()

    expect(dmgToHuman()).toBeLessThan(before)
  })

  it("the Kernel 'hardened' passive reduces incoming attack damage (keeps more HP)", async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.tick() // settle the level-6 maxHp recompute

    // Take one ENEMY swing at the HUMAN from full HP with the given HUMAN buffs,
    // and report the HUMAN's HP afterwards. (The hardened reduction lands on HP
    // loss, not the damage event, so HP-retained is the clean signal.)
    const hpAfterSwing = async (
      humanBuffs: { id: string; stacks: number; ticksRemaining: number; source: string }[],
    ) => {
      await game.patch((s) => ({
        ...s,
        players: {
          ...s.players,
          [HUMAN]: { ...s.players[HUMAN]!, hp: s.players[HUMAN]!.maxHp, buffs: humanBuffs },
          [ENEMY]: { ...s.players[ENEMY]!, items: [null, null, null, null, null, null] }, // no crit variance
        },
      }))
      game.attackHero(HUMAN, ENEMY) // ENEMY swings at HUMAN
      await game.tick()
      return (await game.player(HUMAN)).hp
    }

    const hpNoHardened = await hpAfterSwing([])
    const hpHardened = await hpAfterSwing([
      { id: 'hardened', stacks: 1, ticksRemaining: 9999, source: HUMAN },
    ])

    // Both started at full HP and took the same regen; hardened absorbs 10% of
    // the swing, so the hardened human ends with strictly more HP.
    expect(hpHardened).toBeGreaterThan(hpNoHardened)
  })

  it('physical immunity (Ghost) zeroes an incoming basic attack', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })

    const physDmg = () =>
      game.lastEvents.find(
        (e) => e._tag === 'damage' && e.sourceId === ENEMY && e.targetId === HUMAN,
      )?.amount ?? 0

    // Without immunity (and no enemy on-hit items), the basic attack lands.
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, buffs: [] },
        [ENEMY]: { ...s.players[ENEMY]!, items: [null, null, null, null, null, null] },
      },
    }))
    game.attackHero(HUMAN, ENEMY) // ENEMY swings at HUMAN
    await game.tick()
    expect(physDmg()).toBeGreaterThan(0)

    // With ghost_form the physical hit is zeroed (isDamageImmune → damage = 0).
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          buffs: [{ id: 'ghost_form', stacks: 1, ticksRemaining: 5, source: HUMAN }],
        },
      },
    }))
    game.attackHero(HUMAN, ENEMY)
    await game.tick()
    expect(physDmg()).toBe(0)
  })

  it('Blade Mail reflects a basic attack back at the attacker as pure damage', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    // Settle the first-tick maxHp recompute, then strip the attacker's on-hit
    // items so the only cross-hit is the reflect.
    await game.tick()
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [ENEMY]: { ...s.players[ENEMY]!, items: [null, null, null, null, null, null] },
      },
    }))

    // The reflect rides a damage event from the Blade Mail holder (HUMAN) back at
    // the attacker (ENEMY) — the only HUMAN→ENEMY damage in the tick.
    const reflect = () =>
      game.lastEvents.find(
        (e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === ENEMY,
      )

    // Baseline: no Blade Mail → the attacker takes nothing back.
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, buffs: [] } },
    }))
    game.attackHero(HUMAN, ENEMY) // ENEMY swings at HUMAN
    await game.tick()
    expect(reflect()).toBeUndefined()

    // With a Blade Mail shell up, the attacker eats its own hit back as PURE
    // damage (bypasses armor) and loses HP.
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          buffs: [{ id: 'blade_mail', stacks: 100, ticksRemaining: 3, source: HUMAN }],
        },
      },
    }))
    const enemyBefore = (await game.player(ENEMY)).hp
    game.attackHero(HUMAN, ENEMY)
    await game.tick()
    const ev = reflect()
    expect(ev?.amount).toBeGreaterThan(0)
    expect(ev?.damageType).toBe('pure')
    expect((await game.player(ENEMY)).hp).toBeLessThan(enemyBefore)
  })
})
