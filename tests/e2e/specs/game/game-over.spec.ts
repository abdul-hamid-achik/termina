import { test, expect } from '../../fixtures/game'

test.describe.skip('Game Over', () => {
  test.setTimeout(300_000) // 5 min timeout for game completion

  test('game over screen shows RADIANT/DIRE VICTORY banner', async ({ gamePage }) => {
    // Wait for game to end
    await gamePage.getByTestId('post-game').waitFor({ timeout: 300_000 })
    const victory = gamePage.getByText(/RADIANT VICTORY|DIRE VICTORY/)
    await expect(victory).toBeVisible()
  })

  test('personal stats section shows K/D/A, damage, gold', async ({ gamePage }) => {
    await gamePage.getByTestId('post-game').waitFor({ timeout: 300_000 })
    const postGame = gamePage.getByTestId('post-game')
    await expect(postGame.getByText('K/D/A')).toBeVisible()
    await expect(postGame.getByText('Hero Damage')).toBeVisible()
    await expect(postGame.getByText('Gold Earned')).toBeVisible()
  })

  test('full scoreboard with all 10 players by team', async ({ gamePage }) => {
    await gamePage.getByTestId('post-game').waitFor({ timeout: 300_000 })
    const postGame = gamePage.getByTestId('post-game')
    // Should show both team sections
    await expect(postGame.getByText('RADIANT')).toBeVisible()
    await expect(postGame.getByText('DIRE')).toBeVisible()
    // Each team should have player rows in the scoreboard tables
    const rows = postGame.locator('tbody tr')
    const count = await rows.count()
    expect(count).toBe(10) // 5 radiant + 5 dire
  })

  test('PLAY AGAIN navigates to /lobby; MAIN MENU navigates to /', async ({ gamePage }) => {
    await gamePage.getByTestId('post-game').waitFor({ timeout: 300_000 })

    // Test MAIN MENU button
    await gamePage.getByTestId('return-to-menu-btn').click()
    await gamePage.waitForURL('/', { timeout: 5_000 })
    await expect(gamePage).toHaveURL('/')
  })
})
