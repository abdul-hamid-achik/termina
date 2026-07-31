import { describe, it, expect } from 'vitest'
import { seedGame, ENEMY, HUMAN } from './harness'
import { calculateBuybackCost } from '~~/server/game/engine/BuybackSystem'
import { HARDEN_DURATION_CYCLES } from '~~/shared/constants/balance'

/**
 * Replaces tests/e2e/flows/game_attack_lands.yml — a human basic attack on a
 * co-located enemy registers hero damage. damageDealt is the regen-independent
 * "the hit landed" signal the original flow used (raw enemy INTEG is confounded by
 * per-cycle regen + the level-6 maxInteg recompute).
 */
describe('combat', () => {
  it('attacking a co-located enemy deals hero damage after one cycle', async () => {
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
    // cost shown to the player was 10sc (deaths*10) cheaper than what they'd be
    // charged, and a player with exactly the displayed scrip got rejected.
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, items: [null, null, null, null, null, null] },
        [ENEMY]: { ...s.players[ENEMY]!, integ: 1, deaths: 3 },
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
    // ⇒ same comeback multiplier ⇒ the only delta is the shutdown scrip).
    async function killGain(victimStreak: number): Promise<number> {
      const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
      await game.patch((s) => ({
        ...s,
        players: {
          ...s.players,
          [HUMAN]: { ...s.players[HUMAN]!, items: [null, null, null, null, null, null] },
          [ENEMY]: { ...s.players[ENEMY]!, integ: 1, killStreak: victimStreak },
        },
      }))
      const before = (await game.me()).scrip
      game.attackHero(ENEMY)
      await game.tick()
      return (await game.me()).scrip - before
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
        [ENEMY]: { ...s.players[ENEMY]!, integ: 1, killStreak: 5 },
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
        [ENEMY]: { ...s.players[ENEMY]!, integ: 1 },
      },
    }))

    game.attackHero(ENEMY) // lethal — enemy is at 1 HP
    await game.tick()

    expect((await game.player(ENEMY)).alive).toBe(false)
    expect((await game.me()).cooldowns).toEqual({ q: 0, w: 0, e: 0, r: 0 })
  })

  it('killing an enemy hero pays the killer its bounty — scrip, XP, a kill credit, and a kill event', async () => {
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
        [ENEMY]: { ...s.players[ENEMY]!, integ: 1 },
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
    // The bounty advances the killer's economy (kill scrip + kill XP). Passive
    // income only ever adds, so a strict increase isolates "rewarded, not idle".
    expect(me.scrip).toBeGreaterThan(before.scrip)
    expect(me.xp).toBeGreaterThan(before.xp)

    // The victim takes the death on its own ledger.
    expect((await game.player(ENEMY)).deaths).toBe(victimBefore.deaths + 1)
  })

  it('a teammate who chipped the victim earns an assist (credit + scrip) on the kill', async () => {
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
          [ENEMY]: { ...e, zone: 'mid-river', integ: e.maxInteg }, // healthy — survives the chip
          // A second chaff hero co-located with the enemy (distinct id/name so
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

    // Tick 2 (within the window): drop the enemy to 1 INTEG and let the HUMAN finish it.
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [ENEMY]: { ...s.players[ENEMY]!, integ: 1 } },
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
    // Assist scrip is paid out (a flat split; passive income only adds on top).
    expect(ally.scrip).toBeGreaterThan(allyBefore.scrip)
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
          integ: 1,
          items: ['last_word', null, null, null, null, null],
        },
      },
    }))

    game.attackHero(ENEMY) // lethal — enemy is at 1 HP
    await game.tick()

    expect((await game.player(ENEMY)).alive).toBe(false)
    // The Rapier left the victim and landed in the killer's inventory.
    expect((await game.player(ENEMY)).items).not.toContain('last_word')
    expect((await game.me()).items).toContain('last_word')
  })

  it('a damage-over-time debuff deals damage each cycle and stops on expiry', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    // A 2-tick DoT on the enemy, sourced to the human. processDoTs treats any
    // buff whose id contains 'dot' as a DoT dealing `stacks` damage/tick.
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [ENEMY]: {
          ...s.players[ENEMY]!,
          buffs: [{ id: 'test_dot', stacks: 120, cyclesRemaining: 2, source: HUMAN }],
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

  it('a dead hero respawns at full INTEG in the fountain once the respawn tick passes', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const startTick = (await game.state()).cycle
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          alive: false,
          integ: 0,
          bw: 0,
          respawnCycle: startTick + 5,
        },
      },
    }))

    await game.tick()
    expect((await game.me()).alive).toBe(false) // well before the respawn tick

    await game.tick(6) // now past the respawn tick
    const me = await game.me()
    expect(me.alive).toBe(true)
    expect(me.integ).toBe(me.maxInteg)
    expect(me.respawnCycle).toBeNull()
    expect(me.zone).toBe(me.team === 'chaff' ? 'chaff-fountain' : 'audit-fountain')
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
        // Both freshly dead this cycle (respawnCycle null → handleDeaths assigns it).
        [HUMAN]: { ...s.players[HUMAN]!, level: 8, alive: false, integ: 0, respawnCycle: null },
        [ENEMY]: { ...s.players[ENEMY]!, level: 1, alive: false, integ: 0, respawnCycle: null },
      },
    }))

    await game.tick()

    const me = await game.me()
    const enemy = await game.player(ENEMY)
    expect(me.respawnCycle).not.toBeNull()
    expect(enemy.respawnCycle).not.toBeNull()
    // Both died on the same tick, so a later respawnCycle = a longer wait.
    expect(me.respawnCycle!).toBeGreaterThan(enemy.respawnCycle!)
  })

  it('a shield buff absorbs an incoming attack before INTEG', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          integ: s.players[HUMAN]!.maxInteg,
          buffs: [{ id: 'shield', stacks: 400, cyclesRemaining: 5, source: HUMAN }],
        },
      },
    }))

    game.attackHero(HUMAN, ENEMY) // the co-located enemy swings at the shielded human
    await game.tick()

    // The basic-attack path ran absorbShield: the shield ate the hit, so its
    // stacks dropped. (Raw INTEG is confounded by the level-6 maxInteg recompute on the
    // first tick, so the shield-stack delta is the clean "it absorbed" signal.)
    const shield = (await game.me()).buffs.find((b) => b.id === 'shield')
    expect(shield).toBeDefined()
    expect(shield!.stacks).toBeLessThan(400)
  })

  it('a hero sitting in its own fountain heals rapidly to full INTEG and BW', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => {
      const me = s.players[HUMAN]!
      const fountain = me.team === 'chaff' ? 'chaff-fountain' : 'audit-fountain'
      return {
        ...s,
        players: { ...s.players, [HUMAN]: { ...me, zone: fountain, integ: 50, bw: 0, buffs: [] } },
      }
    })

    const before = (await game.me()).integ
    await game.tick()
    const afterOne = await game.me()
    // Fountain heals ~15% of maxInteg per cycle — far more than base regen alone.
    expect(afterOne.integ).toBeGreaterThan(before + Math.floor(afterOne.maxInteg * 0.1))

    // A handful of ticks tops the hero back off to full.
    await game.tick(8)
    const full = await game.me()
    expect(full.integ).toBe(full.maxInteg)
    expect(full.bw).toBe(full.maxBw)
  })

  it('an in-combat hero gets NO fountain healing (the inCombat guard holds)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => {
      const me = s.players[HUMAN]!
      const fountain = me.team === 'chaff' ? 'chaff-fountain' : 'audit-fountain'
      return {
        ...s,
        players: {
          ...s.players,
          [HUMAN]: {
            ...me,
            zone: fountain,
            integ: 50,
            // The soft combat flag the engine checks before fountain healing.
            buffs: [{ id: 'inCombat', stacks: 1, cyclesRemaining: 5, source: HUMAN }],
          },
        },
      }
    })

    const before = (await game.me()).integ
    await game.tick()
    const after = await game.me()
    // No 15% fountain heal — at most slow base regen, well under a 10% jump.
    expect(after.integ).toBeLessThan(before + Math.floor(after.maxInteg * 0.1))
  })

  it('a hero standing in the enemy base destroys a vulnerable Ancient and wins', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => {
      const me = s.players[HUMAN]!
      const enemyTeam = me.team === 'chaff' ? 'audit' : 'chaff'
      const enemyBase = enemyTeam === 'chaff' ? 'chaff-base' : 'audit-base'
      return {
        ...s,
        players: { ...s.players, [HUMAN]: { ...me, zone: enemyBase } },
        terminals: {
          ...s.terminals,
          // Vulnerable (a T3 has fallen) and at 1 INTEG — any hit finishes it.
          [enemyTeam]: { ...s.terminals[enemyTeam], integ: 1, alive: true, vulnerable: true },
        },
      }
    })

    game.submit({ type: 'attack', target: { kind: 'terminal' } })
    await game.tick()

    const me = await game.me()
    const enemyTeam = me.team === 'chaff' ? 'audit' : 'chaff'
    const state = await game.state()
    expect(state.terminals[enemyTeam].alive).toBe(false)
    expect(state.winner).toBe(me.team)
    expect(game.lastEvents.some((e) => e._tag === 'terminal_destroyed')).toBe(true)
    // The win used to also push a playerless scrip sentinel, which the feed
    // rendered as the literal line "? earned 0sc (game_over:chaff)" at the
    // exact moment of victory. Nothing consumed it.
    expect(game.lastEvents.filter((e) => e._tag === 'gold_change')).toEqual([])
  })

  it('the Ancient is firewalled until a T3 falls — attacks bounce off while invulnerable', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => {
      const me = s.players[HUMAN]!
      const enemyTeam = me.team === 'chaff' ? 'audit' : 'chaff'
      const enemyBase = enemyTeam === 'chaff' ? 'chaff-base' : 'audit-base'
      return {
        ...s,
        players: { ...s.players, [HUMAN]: { ...me, zone: enemyBase } },
        terminals: {
          ...s.terminals,
          [enemyTeam]: { ...s.terminals[enemyTeam], integ: 500, alive: true, vulnerable: false },
        },
      }
    })

    game.submit({ type: 'attack', target: { kind: 'terminal' } })
    await game.tick()

    const me = await game.me()
    const enemyTeam = me.team === 'chaff' ? 'audit' : 'chaff'
    const ancient = (await game.state()).terminals[enemyTeam]
    // Firewalled: the attack is rejected, so the Ancient takes no damage and lives.
    expect(ancient.alive).toBe(true)
    expect(ancient.integ).toBe(500)
    expect((await game.state()).winner).toBeFalsy()
    // The firewall reason now reaches the player (previously server-logged only),
    // so the endgame "why won't it take damage?" moment isn't a mystery.
    expect(
      game.lastRejected.some((r) => r.playerId === HUMAN && r.reason.includes('firewall')),
    ).toBe(true)
  })

  it('attacking a ice from a different zone is rejected with feedback', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me = await game.me()
    const enemySuffix = me.team === 'chaff' ? 'audit' : 'chaff'
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'mid-river' } },
    }))

    // The enemy mid-T1 stands in mid-t1-<suffix>, not mid-river — out of reach.
    game.submit({ type: 'attack', target: { kind: 'ice', zone: `mid-t1-${enemySuffix}` } })
    await game.tick()

    expect(
      game.lastRejected.some((r) => r.playerId === HUMAN && r.reason.includes('not in your zone')),
    ).toBe(true)
  })

  it('a backdoor-protected ice (its front ice still up) tells the player it is protected', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me = await game.me()
    const enemySuffix = me.team === 'chaff' ? 'audit' : 'chaff'
    const t2Zone = `mid-t2-${enemySuffix}`
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: t2Zone } },
      // Standing at the T2 (attackable-shaped) while the T1 in front still stands,
      // so backdoor protection holds and the attack should bounce — with a reason.
      ice: s.ice.map((t) =>
        t.zone === t2Zone
          ? { ...t, alive: true, invulnerable: false }
          : t.zone === `mid-t1-${enemySuffix}`
            ? { ...t, alive: true }
            : t,
      ),
    }))

    game.submit({ type: 'attack', target: { kind: 'ice', zone: t2Zone } })
    await game.tick()

    expect(
      game.lastRejected.some((r) => r.playerId === HUMAN && r.reason.includes('protected')),
    ).toBe(true)
  })

  it('destroying a T3 ice lifts the enemy Ancient firewall (vulnerable flips true)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me = await game.me()
    const enemyTeam = me.team === 'chaff' ? 'audit' : 'chaff'

    // Precondition: with every T3 standing, the enemy Ancient is firewalled.
    expect((await game.state()).terminals[enemyTeam].vulnerable).toBe(false)

    // Drop one of the enemy's T3 ice; the next cycle recomputes vulnerability.
    await game.patch((s) => ({
      ...s,
      ice: s.ice.map((t) =>
        t.team === enemyTeam && t.zone.includes('-t3-') ? { ...t, alive: false, integ: 0 } : t,
      ),
    }))
    await game.tick()

    expect((await game.state()).terminals[enemyTeam].vulnerable).toBe(true)
  })

  it('a dead player with scrip buys back — instantly alive at the fountain, scrip spent', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const startTick = (await game.state()).cycle
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          alive: false,
          integ: 0,
          respawnCycle: startTick + 30, // genuinely dead, far from a natural respawn
          scrip: 10_000, // plenty for the buyback cost
        },
      },
    }))

    const scripBefore = (await game.me()).scrip
    game.submit({ type: 'buyback' })
    await game.tick()

    const me = await game.me()
    expect(me.alive).toBe(true)
    expect(me.respawnCycle).toBeNull()
    expect(me.scrip).toBeLessThan(scripBefore) // paid the buyback cost
    expect(me.zone).toBe(me.team === 'chaff' ? 'chaff-fountain' : 'audit-fountain')
  })

  it('buyback is refused with insufficient scrip — the hero stays dead and keeps its gold', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const startTick = (await game.state()).cycle
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          alive: false,
          integ: 0,
          respawnCycle: startTick + 30,
          scrip: 0,
        },
      },
    }))

    game.submit({ type: 'buyback' })
    await game.tick()

    const me = await game.me()
    expect(me.alive).toBe(false)
    expect(me.scrip).toBe(0)
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
          integ: 0,
          respawnCycle: s.cycle + 50,
          scrip: 10_000,
          buybackCooldown: null, // no prior buyback
        },
      },
    }))

    // First buyback lands — instantly alive — and arms the buyback cooldown.
    game.submit({ type: 'buyback' })
    await game.tick()
    expect((await game.me()).alive).toBe(true)
    expect((await game.me()).buybackCooldown ?? 0).toBeGreaterThan((await game.state()).cycle)

    // Die again while that cooldown is still ticking (the patch keeps it set).
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, alive: false, integ: 0, respawnCycle: s.cycle + 50 },
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

  it('a ice fires on a lone enemy hero diving it (no waves to tank)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    // Tick once up front so the level-6 maxInteg recompute is already settled —
    // otherwise the first-tick INTEG inflation masks the ice hit.
    await game.tick()
    await game.patch((s) => {
      const me = s.players[HUMAN]!
      const enemyIceZone = me.team === 'chaff' ? 'mid-t1-audit' : 'mid-t1-chaff'
      return {
        ...s,
        players: { ...s.players, [HUMAN]: { ...me, zone: enemyIceZone, integ: 400 } },
        waves: [], // nothing to soak the ice
      }
    })

    const before = (await game.me()).integ
    await game.tick()
    // ICE_ATTACK (120, minus plate) far exceeds per-cycle regen, so the
    // exposed hero visibly loses INTEG.
    expect((await game.me()).integ).toBeLessThan(before)
  })

  it('waves tank the ice — a hero behind its own wave takes no ice fire', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.tick() // settle the maxInteg recompute first
    await game.patch((s) => {
      const me = s.players[HUMAN]!
      const enemyIceZone = me.team === 'chaff' ? 'mid-t1-audit' : 'mid-t1-chaff'
      return {
        ...s,
        players: { ...s.players, [HUMAN]: { ...me, zone: enemyIceZone, integ: 400 } },
        // An allied wave (same team as the hero) soaks the ice instead.
        waves: [{ id: 'shield0', team: me.team, zone: enemyIceZone, integ: 300, type: 'line' }],
      }
    })

    const before = (await game.me()).integ
    await game.tick()

    // The hero is shielded — the ice shot the wave, not the hero (INTEG only
    // moves up via regen, never down).
    expect((await game.me()).integ).toBeGreaterThanOrEqual(before)
    const wave = (await game.state()).waves.find((c) => c.id === 'shield0')
    expect(wave && wave.integ < 300).toBe(true)
  })

  it('using Harden turns all of the team’s ice invulnerable', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me = await game.me()

    game.submit({ type: 'harden' })
    await game.tick()

    const myIce = (await game.state()).ice.filter((t) => t.team === me.team)
    expect(myIce.length).toBeGreaterThan(0)
    expect(myIce.every((t) => t.invulnerable)).toBe(true)
    expect(game.lastEvents.some((e) => e._tag === 'harden_used')).toBe(true)
  })

  it('Harden cannot be reused while on cooldown', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })

    // First harden: sets the team's harden cooldown.
    game.submit({ type: 'harden' })
    await game.tick()
    expect(game.lastEvents.some((e) => e._tag === 'harden_used')).toBe(true)

    // Second harden one cycle later: still on cooldown, so it's rejected.
    game.submit({ type: 'harden' })
    await game.tick()
    expect(game.lastEvents.some((e) => e._tag === 'harden_on_cooldown')).toBe(true)
  })

  it('Harden wears off after HARDEN_DURATION_CYCLES — ice become vulnerable again', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me = await game.me()
    const team = me.team

    // Simulate a harden cast that's now exactly past its duration: invulnerable
    // ice + a hardenUsedCycle old enough that expireGlyph should lift it.
    await game.patch((s) => ({
      ...s,
      teams: {
        ...s.teams,
        [team]: { ...s.teams[team]!, hardenUsedCycle: s.cycle - HARDEN_DURATION_CYCLES },
      },
      ice: s.ice.map((t) => (t.team === team ? { ...t, invulnerable: true } : t)),
    }))

    await game.tick()

    const myIce = (await game.state()).ice.filter((t) => t.team === team)
    expect(myIce.length).toBeGreaterThan(0)
    expect(myIce.every((t) => !t.invulnerable)).toBe(true)
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
    game.submit({ type: 'move', zone: 'mid-t1-chaff' }, ENEMY)
    game.attackHero(ENEMY)
    await game.tick()

    expect((await game.me()).damageDealt).toBe(0) // juked — no damage
    expect(
      game.lastRejected.some((r) => r.playerId === HUMAN && r.reason.includes('not in your zone')),
    ).toBe(true)
  })

  it('plate from an item reduces incoming basic-attack damage (plate applies)', async () => {
    // kernel is kinetic AA — plate only mitigates kinetic (daemon is code).
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'kernel' })

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

    // Plate Weave (+5 plate) raises getEffectivePlate, so the same swing hurts less.
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, items: ['plate_weave', null, null, null, null, null] },
      },
    }))
    game.attackHero(HUMAN, ENEMY)
    await game.tick()

    expect(dmgToHuman()).toBeLessThan(before)
  })

  it("the Kernel 'hardened' passive reduces incoming attack damage (keeps more INTEG)", async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.tick() // settle the level-6 maxInteg recompute

    // Take one ENEMY swing at the HUMAN from full INTEG with the given HUMAN buffs,
    // and report the HUMAN's INTEG afterwards. (The hardened reduction lands on HP
    // loss, not the damage event, so HP-retained is the clean signal.)
    const hpAfterSwing = async (
      humanBuffs: { id: string; stacks: number; cyclesRemaining: number; source: string }[],
    ) => {
      await game.patch((s) => ({
        ...s,
        players: {
          ...s.players,
          [HUMAN]: { ...s.players[HUMAN]!, integ: s.players[HUMAN]!.maxInteg, buffs: humanBuffs },
          [ENEMY]: { ...s.players[ENEMY]!, items: [null, null, null, null, null, null] }, // no crit variance
        },
      }))
      game.attackHero(HUMAN, ENEMY) // ENEMY swings at HUMAN
      await game.tick()
      return (await game.player(HUMAN)).integ
    }

    const hpNoHardened = await hpAfterSwing([])
    const hpHardened = await hpAfterSwing([
      { id: 'hardened', stacks: 1, cyclesRemaining: 9999, source: HUMAN },
    ])

    // Both started at full INTEG and took the same regen; hardened absorbs 10% of
    // the swing, so the hardened human ends with strictly more INTEG.
    expect(hpHardened).toBeGreaterThan(hpNoHardened)
  })

  it("Daemon's first attack from stealth deals +50% (Stealth Process)", async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'daemon', heroEnemy: 'echo' })
    await game.tick() // settle the level-6 maxInteg recompute

    // One HUMAN(daemon) swing at the ENEMY from full enemy INTEG, with the given
    // daemon buffs; report the enemy's INTEG afterwards (more damage → lower INTEG).
    const enemyHpAfterSwing = async (
      daemonBuffs: { id: string; stacks: number; cyclesRemaining: number; source: string }[],
    ) => {
      await game.patch((s) => ({
        ...s,
        players: {
          ...s.players,
          [HUMAN]: {
            ...s.players[HUMAN]!,
            items: [null, null, null, null, null, null], // no crit variance
            buffs: daemonBuffs,
          },
          [ENEMY]: { ...s.players[ENEMY]!, integ: s.players[ENEMY]!.maxInteg, buffs: [] },
        },
      }))
      game.attackHero(ENEMY) // HUMAN (daemon) swings at ENEMY
      await game.tick()
      return (await game.player(ENEMY)).integ
    }

    const normal = await enemyHpAfterSwing([])
    const fromStealth = await enemyHpAfterSwing([
      { id: 'stealth', stacks: 1, cyclesRemaining: 99, source: HUMAN },
    ])

    // The opening strike out of stealth hits 50% harder, so the enemy ends lower.
    expect(fromStealth).toBeLessThan(normal)
  })

  it('kinetic immunity (Ghost) zeroes an incoming basic attack', async () => {
    // Ghost only blocks kinetic — attacker must be a kinetic AA hero (not daemon/code).
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'kernel' })

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

    // With ghost_form the kinetic hit is zeroed (isDamageImmune → damage = 0).
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          buffs: [{ id: 'ghost_form', stacks: 1, cyclesRemaining: 5, source: HUMAN }],
        },
      },
    }))
    game.attackHero(HUMAN, ENEMY)
    await game.tick()
    expect(physDmg()).toBe(0)
  })

  it('Ghost form prevents the holder from attacking (the Ghost Scepter downside)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          buffs: [{ id: 'ghost_form', stacks: 1, cyclesRemaining: 5, source: HUMAN }],
        },
      },
    }))

    game.attackHero(ENEMY) // HUMAN (ghost-formed) tries to swing
    await game.tick()

    // Rejected with feedback, and no damage lands on the enemy.
    expect(game.lastRejected.some((r) => r.playerId === HUMAN && r.reason.includes('ghost'))).toBe(
      true,
    )
    expect(
      game.lastEvents.some(
        (e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === ENEMY,
      ),
    ).toBe(false)
  })

  it('Spite Plate reflects a basic attack back at the attacker as black damage', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    // Settle the first-tick maxInteg recompute, then strip the attacker's on-hit
    // items so the only cross-hit is the reflect.
    await game.tick()
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [ENEMY]: { ...s.players[ENEMY]!, items: [null, null, null, null, null, null] },
      },
    }))

    // The reflect rides a damage event from the Spite Plate holder (HUMAN) back at
    // the attacker (ENEMY) — the only HUMAN→ENEMY damage in the tick.
    const reflect = () =>
      game.lastEvents.find(
        (e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === ENEMY,
      )

    // Baseline: no Spite Plate → the attacker takes nothing back.
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, buffs: [] } },
    }))
    game.attackHero(HUMAN, ENEMY) // ENEMY swings at HUMAN
    await game.tick()
    expect(reflect()).toBeUndefined()

    // With a Spite Plate shell up, the attacker eats its own hit back as PURE
    // damage (bypasses armor) and loses INTEG.
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          buffs: [{ id: 'spite_plate', stacks: 100, cyclesRemaining: 3, source: HUMAN }],
        },
      },
    }))
    const enemyBefore = (await game.player(ENEMY)).integ
    game.attackHero(HUMAN, ENEMY)
    await game.tick()
    const ev = reflect()
    expect(ev?.amount).toBeGreaterThan(0)
    expect(ev?.damageType).toBe('black')
    expect((await game.player(ENEMY)).integ).toBeLessThan(enemyBefore)
  })

  it('Spite Plate reflects ABILITY damage too (not only basic attacks)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.tick() // settle the level-6 maxInteg recompute
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, cooldowns: { q: 0, w: 0, e: 0, r: 0 } },
        [ENEMY]: {
          ...s.players[ENEMY]!,
          buffs: [{ id: 'spite_plate', stacks: 100, cyclesRemaining: 3, source: ENEMY }],
        },
      },
    }))

    // The reflect rides a black-damage event from the Spite Plate holder (ENEMY)
    // back at the caster (HUMAN).
    const reflect = () =>
      game.lastEvents.find(
        (e) =>
          e._tag === 'damage' &&
          e.sourceId === ENEMY &&
          e.targetId === HUMAN &&
          e.damageType === 'black',
      )

    const casterBefore = (await game.me()).integ
    game.cast('q', { kind: 'hero', name: ENEMY }) // HUMAN nukes the Spite Plate holder
    await game.tick()

    expect(reflect()).toBeDefined()
    expect((await game.me()).integ).toBeLessThan(casterBefore)
  })
})

describe('BREACH access state', () => {
  it('breach opens a window on an enemy hero in zone', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, bw: 200, maxBw: 200 },
      },
    }))
    game.submit({ type: 'breach', target: { kind: 'hero', name: ENEMY } })
    await game.tick()
    const enemy = await game.player(ENEMY)
    const breached = enemy.buffs.find((b) => b.id === 'breached')
    expect(breached).toBeDefined()
    expect(breached!.cyclesRemaining).toBeGreaterThan(0)
  })
})

describe('attackType basic-attack mitigation (R4-08)', () => {
  it('a code-attacking hero is mitigated by ice; a kinetic one by plate', async () => {
    // ping = code AA, kernel = kinetic AA (R4-08 registry mapping).
    // Seed both with identical attack and zero plate/ice on one target then
    // raise ice vs plate to prove the route.
    const codeGame = await seedGame('laning_combat', { heroSelf: 'ping', heroEnemy: 'daemon' })
    await codeGame.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, plate: 0, ice: 0 },
        [ENEMY]: { ...s.players[ENEMY]!, plate: 0, ice: 50, integ: 2000, maxInteg: 2000 },
      },
    }))
    codeGame.attackHero(ENEMY)
    await codeGame.tick()
    const codeDmg = codeGame.lastEvents.find(
      (e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === ENEMY,
    )
    expect(codeDmg).toBeDefined()
    expect(codeDmg!.damageType).toBe('code')

    const kineticGame = await seedGame('laning_combat', { heroSelf: 'kernel', heroEnemy: 'echo' })
    await kineticGame.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, plate: 0, ice: 0 },
        [ENEMY]: { ...s.players[ENEMY]!, plate: 50, ice: 0, integ: 2000, maxInteg: 2000 },
      },
    }))
    kineticGame.attackHero(ENEMY)
    await kineticGame.tick()
    const kinDmg = kineticGame.lastEvents.find(
      (e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === ENEMY,
    )
    expect(kinDmg).toBeDefined()
    expect(kinDmg!.damageType).toBe('kinetic')
  })
})

describe('BREACH teaching rejection (R4-11)', () => {
  it('casting a stun at a closed target names the target and the word breach', async () => {
    // kernel Q = Interrupt stun
    const game = await seedGame('laning_combat', { heroSelf: 'kernel', heroEnemy: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          cooldowns: { q: 0, w: 0, e: 0, r: 0 },
          bw: 300,
          maxBw: 300,
        },
        [ENEMY]: {
          ...s.players[ENEMY]!,
          // closed — no breached
          buffs: [],
        },
      },
    }))
    game.cast('q', { kind: 'hero', name: ENEMY })
    await game.tick()
    const rejected = game.lastRejected.find((r) => r.playerId === HUMAN)
    expect(rejected?.reason).toMatch(/CLOSED/i)
    expect(rejected?.reason).toMatch(/breach/i)
  })
})
