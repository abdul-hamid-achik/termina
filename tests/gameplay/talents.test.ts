import { describe, it, expect } from 'vitest'
import { TALENT_TREES } from '~~/shared/constants/talents'
import { seedGame, HUMAN, ENEMY } from './harness'

/**
 * Replaces the engine-truth half of tests/e2e/flows/game_talent_select.yml —
 * choosing a talent writes it into engine state. The DOM half (the TalentPicker
 * prompt renders + the left button sends the pick) stays in Cairntrace.
 */
describe('talents', () => {
  it('selecting a tier-10 talent records it in engine state', async () => {
    // talent_ready seeds the human at level 10 with no talents chosen.
    const game = await seedGame('talent_ready', { heroSelf: 'echo' })
    const leftTalent = TALENT_TREES.echo.tiers[10][0] // the "left" option

    game.selectTalent(10, leftTalent.id)
    await game.tick()

    const me = await game.me()
    expect(me.talents.tier10).toBe(leftTalent.id)
  })

  it('a +attack stat-bonus talent actually raises basic-attack damage (not just recorded)', async () => {
    // echo's tier-10 left is "+15 Attack Damage" (statBonus attack:15), folded
    // into getEffectiveAttack — so it should visibly increase the damage of a
    // basic hit, proving the talent is APPLIED, not merely stored.
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, level: 10 } }, // tier 10 unlocked
    }))

    const lastHitDamage = () =>
      game.lastEvents.find(
        (e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === ENEMY,
      )?.amount ?? 0

    // Baseline basic-attack damage, no talent.
    game.attackHero(ENEMY)
    await game.tick()
    const before = lastHitDamage()
    expect(before).toBeGreaterThan(0)

    // Take +15 Attack, then swing again — same formula + 15 base attack.
    game.selectTalent(10, 'echo_10_left')
    await game.tick()
    game.attackHero(ENEMY)
    await game.tick()

    expect(lastHitDamage()).toBeGreaterThan(before)
  })

  it('a damage_boost talent amplifies a hero-tailored ability through the full tick (Cipher +30% XOR Strike)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'cipher', heroEnemy: 'daemon' })
    await game.tick() // settle the level-6 maxInteg recompute

    const dmgToEnemy = () =>
      game.lastEvents
        .filter((e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === ENEMY)
        .reduce((sum, e) => sum + (e._tag === 'damage' ? e.amount : 0), 0)

    // Baseline XOR Strike (Q) — no talent, caster buffs cleared, enemy topped up.
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          level: 16,
          cooldowns: { q: 0, w: 0, e: 0, r: 0 },
          buffs: [],
          talents: { tier10: null, tier15: null, tier20: null, tier25: null },
        },
        [ENEMY]: { ...s.players[ENEMY]!, buffs: [], integ: s.players[ENEMY]!.maxInteg },
      },
    }))
    game.cast('q', { kind: 'hero', name: ENEMY })
    await game.tick()
    const baseline = dmgToEnemy()
    expect(baseline).toBeGreaterThan(0)

    // Same cast with the tailored +30% XOR Strike talent → meaningfully more damage.
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          cooldowns: { q: 0, w: 0, e: 0, r: 0 },
          buffs: [],
          talents: { tier10: null, tier15: 'cipher_15_left', tier20: null, tier25: null },
        },
        [ENEMY]: { ...s.players[ENEMY]!, buffs: [], integ: s.players[ENEMY]!.maxInteg },
      },
    }))
    game.cast('q', { kind: 'hero', name: ENEMY })
    await game.tick()
    expect(dmgToEnemy()).toBeGreaterThanOrEqual(Math.round(baseline * 1.2))
  })
})

/**
 * The tier-25 "exotic" cast effects, proven through the full tick (engine truth).
 * double_cast is covered at the unit layer (HeroCastBridge) because it's a
 * probability gated on Math.random; these three are deterministic.
 */
describe('exotic tier-25 cast effects', () => {
  // Assertions use the tick's damage/heal EVENTS (filtered to the caster as
  // source) rather than absolute INTEG — heroes regen during a tick, so INTEG deltas
  // are noisy. `dmgFromMe`/`healOnMe` read game.lastEvents after each tick.

  it('global_ultimate lets Regex R hit an enemy in a far zone', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'regex', heroEnemy: 'daemon' })
    const setup = (tier25: string | null) =>
      game.patch((s) => ({
        ...s,
        players: {
          ...s.players,
          [HUMAN]: {
            ...s.players[HUMAN]!,
            zone: 'mid-river',
            level: 6,
            bw: 500,
            maxBw: 500,
            cooldowns: { q: 0, w: 0, e: 0, r: 0 },
            talents: { tier10: null, tier15: null, tier20: null, tier25 },
          },
          // top-river is NOT adjacent to mid-river → only a global ult can reach it.
          // R4-11: silence is hard control — seed BREACHED so the cast is not teaching-rejected.
          [ENEMY]: {
            ...s.players[ENEMY]!,
            zone: 'top-river',
            bw: 100,
            maxBw: 500,
            buffs: [{ id: 'breached', stacks: 1, ticksRemaining: 5, source: 'test' }],
          },
        },
      }))
    const dmgFromMe = () =>
      game.lastEvents.some(
        (e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === ENEMY,
      )

    // No talent: R is out of range → no damage from the caster.
    await setup(null)
    game.cast('r', { kind: 'hero', name: ENEMY })
    await game.tick()
    expect(dmgFromMe()).toBe(false)

    // regex_25_right (Global Backtracking): R reaches the far zone.
    await setup('regex_25_right')
    game.cast('r', { kind: 'hero', name: ENEMY })
    await game.tick()
    expect(dmgFromMe()).toBe(true)
  })

  it('aoe_bonus lets Null R (Dereference) hit enemies in adjacent zones', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'null_ref', heroEnemy: 'daemon' })
    const setup = (tier25: string | null) =>
      game.patch((s) => ({
        ...s,
        players: {
          ...s.players,
          [HUMAN]: {
            ...s.players[HUMAN]!,
            zone: 'mid-river',
            level: 6,
            bw: 500,
            maxBw: 500,
            cooldowns: { q: 0, w: 0, e: 0, r: 0 },
            talents: { tier10: null, tier15: null, tier20: null, tier25 },
          },
          // mid-t1-audit IS adjacent to mid-river.
          [ENEMY]: { ...s.players[ENEMY]!, zone: 'mid-t1-audit', bw: 500, maxBw: 500 },
        },
      }))
    const dmgFromMe = () =>
      game.lastEvents.some(
        (e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === ENEMY,
      )

    // No talent: Dereference (untargeted AOE) only hits the caster's own zone.
    await setup(null)
    game.cast('r')
    await game.tick()
    expect(dmgFromMe()).toBe(false)

    // null_ref_25_right (Cascading Dereference): AOE reaches adjacent zones.
    await setup('null_ref_25_right')
    game.cast('r')
    await game.tick()
    expect(dmgFromMe()).toBe(true)
  })

  it('spell_lifesteal heals Daemon for a fraction of his ability damage', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'daemon', heroEnemy: 'mutex' })
    const setup = (tier25: string | null) =>
      game.patch((s) => ({
        ...s,
        players: {
          ...s.players,
          [HUMAN]: {
            ...s.players[HUMAN]!,
            zone: 'mid-river',
            level: 6,
            integ: Math.floor(s.players[HUMAN]!.maxInteg / 2), // room to heal
            bw: 500,
            maxBw: 500,
            cooldowns: { q: 0, w: 0, e: 0, r: 0 },
            talents: { tier10: null, tier15: null, tier20: null, tier25 },
          },
          // Below the 30% execute threshold so Daemon's E (Sudo) lands. Reset
          // alive:true — the no-talent cast above may have killed the enemy and
          // the spread would otherwise carry alive:false into this cast.
          [ENEMY]: {
            ...s.players[ENEMY]!,
            zone: 'mid-river',
            integ: 100,
            maxInteg: 1000,
            bw: 500,
            alive: true,
            respawnTick: 0,
          },
        },
      }))
    const healOnMe = () =>
      game.lastEvents.some((e) => e._tag === 'heal' && e.sourceId === HUMAN && e.targetId === HUMAN)

    // No talent: Sudo deals damage but Daemon does not heal.
    await setup(null)
    game.cast('e', { kind: 'hero', name: ENEMY })
    await game.tick()
    expect(healOnMe()).toBe(false)

    // daemon_25_right (Soul Siphon): Daemon heals for 30% of the damage dealt.
    await setup('daemon_25_right')
    game.cast('e', { kind: 'hero', name: ENEMY })
    await game.tick()
    expect(healOnMe()).toBe(true)
  })
})
