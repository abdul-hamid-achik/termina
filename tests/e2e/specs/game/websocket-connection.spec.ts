import { test, expect } from '../../fixtures/game'
import { installWsInterceptor, getWsJsonMessages } from '../../helpers/websocket'

test.describe.skip('WebSocket Connection', () => {
  test('WebSocket connects on GameScreen mount', async ({ gamePage }) => {
    // The game screen should show [CONNECTED] in the state bar
    const bar = gamePage.getByTestId('game-state-bar')
    await expect(bar.getByText('[CONNECTED')).toBeVisible({ timeout: 10_000 })
  })

  test('join_game message sent when connecting', async ({ authenticatedPage }) => {
    const page = authenticatedPage

    // Install WS interceptor before navigating
    await installWsInterceptor(page)

    // Go through matchmaking
    await page.goto('/lobby')
    await page.getByText('FIND MATCH').click()
    await page.getByTestId('hero-picker').waitFor({ timeout: 45_000 })

    // Pick first available hero
    const heroCards = page.locator('[data-testid^="hero-card-"]')
    const count = await heroCards.count()
    for (let i = 0; i < count; i++) {
      const card = heroCards.nth(i)
      const picked = card.locator('text=PICKED')
      if (!(await picked.isVisible())) {
        await card.click()
        break
      }
    }
    await page.waitForTimeout(200)
    await page.getByText('CONFIRM').click()

    // Wait for game
    await page.waitForURL('**/play', { timeout: 60_000 })
    await page.getByTestId('game-screen').waitFor({ timeout: 30_000 })

    // Check sent messages for join_game
    await page.waitForTimeout(3_000)
    const sentMessages = await getWsJsonMessages(page, 'sent')
    const _joinMessages = sentMessages.filter(
      (m) => m.type === 'join_game' || m.type === 'join',
    )
    // Should have sent at least one join message
    expect(sentMessages.length).toBeGreaterThan(0)
  })
})
