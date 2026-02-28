import { test, expect } from '../../fixtures/game'

test.describe.skip('Scoreboard', () => {
  test('Tab key press shows scoreboard overlay', async ({ gamePage }) => {
    await gamePage.keyboard.down('Tab')
    await expect(gamePage.getByTestId('scoreboard')).toBeVisible({ timeout: 2_000 })
    await gamePage.keyboard.up('Tab')
  })

  test('Tab release hides scoreboard', async ({ gamePage }) => {
    await gamePage.keyboard.down('Tab')
    await expect(gamePage.getByTestId('scoreboard')).toBeVisible({ timeout: 2_000 })
    await gamePage.keyboard.up('Tab')
    await expect(gamePage.getByTestId('scoreboard')).not.toBeVisible({ timeout: 2_000 })
  })

  test('scoreboard shows both teams with K/D/A, level, gold', async ({ gamePage }) => {
    await gamePage.keyboard.down('Tab')
    const scoreboard = gamePage.getByTestId('scoreboard')
    await expect(scoreboard).toBeVisible({ timeout: 2_000 })

    // Should show RADIANT and DIRE labels
    await expect(scoreboard.getByText('RADIANT')).toBeVisible()
    await expect(scoreboard.getByText('DIRE')).toBeVisible()

    // Should show column headers
    await expect(scoreboard.getByText('Player').first()).toBeVisible()
    await expect(scoreboard.getByText('K/D/A').first()).toBeVisible()
    await expect(scoreboard.getByText('Lv').first()).toBeVisible()
    await expect(scoreboard.getByText('Gold').first()).toBeVisible()

    await gamePage.keyboard.up('Tab')
  })

  test("current player's row is highlighted", async ({ gamePage }) => {
    await gamePage.keyboard.down('Tab')
    const scoreboard = gamePage.getByTestId('scoreboard')
    await expect(scoreboard).toBeVisible({ timeout: 2_000 })

    // Current player row has special class
    const selfRow = scoreboard.locator('.scoreboard__player-row--self')
    await expect(selfRow).toBeVisible()

    await gamePage.keyboard.up('Tab')
  })
})
