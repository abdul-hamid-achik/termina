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
})
