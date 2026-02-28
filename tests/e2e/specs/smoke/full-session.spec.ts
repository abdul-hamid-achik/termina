import { test, expect } from '../../fixtures/base'

test.describe.skip('Smoke Test', () => {
  // Tag this test for filtering: bun run test:e2e -- --grep smoke
  test('full game session: home -> register -> lobby -> game -> game over -> profile -> logout', async ({ page }) => {
    test.setTimeout(300_000) // 5 minute timeout for full game

    // 1. Home page loads
    await page.goto('/')
    await expect(page.locator('pre.text-glow').first()).toBeVisible()

    // 2. Click CTA -> redirected to /login (not authenticated)
    await page.getByRole('link', { name: 'ENTER THE TERMINAL' }).click()
    await page.waitForURL('**/login', { timeout: 10_000 })

    // 3. Register new user
    const username = `ts_${Math.random().toString(36).slice(2, 10)}`
    const password = 'E2eTestPass123!'
    await page.getByRole('button', { name: '> register' }).click()
    await page.getByPlaceholder('enter_username').fill(username)
    await page.locator('input[type="password"]').first().fill(password)
    await page.locator('input[type="password"]').nth(1).fill(password)
    await page.locator('button').filter({ hasText: 'REGISTER' }).click()
    await page.waitForURL('/', { timeout: 10_000 })

    // 4. Navigate to lobby and find match
    await page.goto('/lobby')
    await page.getByText('FIND MATCH').click()

    // 5. Wait for hero picker (bots auto-fill after ~10s)
    await page.getByTestId('hero-picker').waitFor({ timeout: 45_000 })

    // 6. Pick first available hero
    const heroCards = page.locator('[data-testid^="hero-card-"]')
    const cardCount = await heroCards.count()
    for (let i = 0; i < cardCount; i++) {
      const card = heroCards.nth(i)
      const picked = card.locator('text=PICKED')
      if (!(await picked.isVisible())) {
        await card.click()
        break
      }
    }
    await page.waitForTimeout(200)
    await page.getByText('CONFIRM').click()

    // 7. Wait for game start
    await page.waitForURL('**/play', { timeout: 60_000 })
    await page.getByTestId('game-screen').waitFor({ timeout: 30_000 })

    // 8. Verify game screen components
    await expect(page.getByTestId('game-state-bar')).toBeVisible()
    await expect(page.getByTestId('ascii-map')).toBeVisible()
    await expect(page.getByTestId('combat-log')).toBeVisible()
    await expect(page.getByTestId('hero-status')).toBeVisible()
    await expect(page.getByTestId('command-input')).toBeVisible()

    // 9. Open scoreboard
    await page.keyboard.down('Tab')
    await expect(page.getByTestId('scoreboard')).toBeVisible({ timeout: 2_000 })
    await page.keyboard.up('Tab')

    // 10. Submit a move command (use the command input)
    const cmdInput = page.getByTestId('command-input-field')
    await cmdInput.fill('status')
    await cmdInput.press('Enter')

    // 11. Send a chat message
    await cmdInput.fill('chat team hello from e2e test')
    await cmdInput.press('Enter')

    // 12. Wait for game to end (up to 5 min)
    // Note: Bot games typically end within 2-3 minutes
    await page.getByTestId('post-game').waitFor({ timeout: 300_000 })

    // 13. Verify game over screen
    const victoryText = page.getByText(/RADIANT VICTORY|DIRE VICTORY/)
    await expect(victoryText).toBeVisible()

    // 14. Click MAIN MENU
    await page.getByTestId('return-to-menu-btn').click()
    await page.waitForURL('/', { timeout: 5_000 })

    // 15. Check leaderboard
    await page.goto('/leaderboard')
    await page.waitForTimeout(2000)

    // 16. Logout
    await page.getByText('[LOGOUT]').click()
    await page.waitForURL('**/login', { timeout: 5_000 })
    await expect(page).toHaveURL(/\/login/)
  })
})
