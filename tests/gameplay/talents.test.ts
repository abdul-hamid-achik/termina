import { describe, it, expect } from 'vitest'
import { TALENT_TREES } from '~~/shared/constants/talents'
import { seedGame } from './harness'

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
})
