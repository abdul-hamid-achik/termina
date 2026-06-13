import { test, expect } from '../../fixtures/base'

test.describe('Smoke Test', () => {
  // Tag this test for filtering: bun run test:e2e -- --grep smoke
  test('full game session: home -> register -> lobby -> game -> game over -> profile -> logout', async ({
    page,
  }) => {
    // The game is ended deterministically via the /api/test/force-end hook
    // (see game-over.spec.ts), so the in-game phase is near-instant. Budget
    // covers registration + lobby matchmaking + navigation only.
    test.setTimeout(240_000)

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
    // Scope to the form: a bare button+hasText 'REGISTER' also matches the
    // "> register" tab switcher (case-insensitive substring), which is a
    // strict-mode violation. The submit button is the only button inside <form>.
    await page.locator('form').locator('button').filter({ hasText: 'REGISTER' }).click()
    await page.waitForURL('/', { timeout: 10_000 })

    // 4. Navigate to lobby and find match
    await page.goto('/lobby')
    await page.getByText('FIND MATCH').click()

    // 5. Wait for hero picker (bots auto-fill after ~10s)
    await page.getByTestId('hero-picker').waitFor({ timeout: 45_000 })

    // 6. Pick first available hero. CONFIRM is turn-gated — only click it if
    // it's enabled (it's our turn and a hero is selected). If the turn race
    // is lost, the server auto-picks and the game starts anyway.
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
    const confirmBtn = page.getByText('CONFIRM')
    if (await confirmBtn.isEnabled().catch(() => false)) {
      await confirmBtn.click()
    }

    // 7. Wait for game start
    await page.waitForURL('**/play', { timeout: 60_000 })
    await page.getByTestId('game-screen').waitFor({ timeout: 30_000 })

    // 8. Verify game screen components
    await expect(page.getByTestId('game-state-bar')).toBeVisible()
    await expect(page.getByTestId('ascii-map')).toBeVisible()
    await expect(page.getByTestId('combat-log')).toBeVisible()
    await expect(page.getByTestId('hero-status')).toBeVisible()
    await expect(page.getByTestId('command-input')).toBeVisible()

    // 9. Open scoreboard. Tab is autocomplete while the command input is
    // focused (it autofocuses) — blur it first, like clicking away.
    await page.getByTestId('command-input-field').blur()
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

    // 12. End the game deterministically via the test-only force-end hook
    // (gated on TERMINA_TEST_HOOKS=1 in playwright.config.ts) instead of
    // playing the full bot match to an Ancient kill. The running GameLoop
    // broadcasts game_over on its next tick, so the post-game screen appears
    // almost immediately.
    const gameId = await page.getByTestId('game-screen').getAttribute('data-game-id')
    expect(gameId).toBeTruthy()
    const forceEndRes = await page.request.post('/api/test/force-end', {
      data: { gameId, winner: 'radiant' },
    })
    expect(forceEndRes.ok()).toBe(true)
    await page.getByTestId('post-game').waitFor({ timeout: 30_000 })

    // 13. Verify game over screen — we forced a radiant win.
    await expect(page.getByText('RADIANT VICTORY')).toBeVisible()

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
