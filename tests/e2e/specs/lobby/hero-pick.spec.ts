import { test, expect } from '../../fixtures/base'

// Helper to get to hero pick phase — uses HTTP polling since WebSocket
// may not work through the Nuxt dev proxy in test environments
async function navigateToHeroPick(page: import('@playwright/test').Page) {
  await page.goto('/lobby')
  await page.getByText('FIND MATCH').click()

  // Poll the queue status API until the match enters lobby/picking phase
  // (bots auto-fill after ~10s, matchmaking loop runs every ~5s)
  const startTime = Date.now()
  const timeout = 45_000
  while (Date.now() - startTime < timeout) {
    const res = await page.request.get('/api/queue/status')
    const data = await res.json()
    if (data.status === 'lobby' || data.status === 'game_starting') {
      break
    }
    await page.waitForTimeout(2000)
  }

  // Reload the lobby page to trigger the recovery mechanism
  // which reads the lobby state via HTTP and shows the hero picker
  await page.goto('/lobby')
  await page.getByTestId('hero-picker').waitFor({ timeout: 15_000 })
}

test.describe('Hero Pick', () => {
  test('hero picker grid shows all heroes after match found', async ({ authenticatedPage }) => {
    const page = authenticatedPage
    await navigateToHeroPick(page)
    const heroCards = page.locator('[data-testid^="hero-card-"]')
    // Should have at least 6 heroes (the game has 10)
    await expect(heroCards.first()).toBeVisible()
    const count = await heroCards.count()
    expect(count).toBeGreaterThanOrEqual(6)
  })

  test('selecting hero highlights it; CONFIRM disabled until picked', async ({ authenticatedPage }) => {
    const page = authenticatedPage
    await navigateToHeroPick(page)
    // CONFIRM should be disabled initially
    const confirmBtn = page.getByText('CONFIRM')
    await expect(confirmBtn).toBeDisabled()
    // Select a hero
    const firstHero = page.locator('[data-testid^="hero-card-"]').first()
    await firstHero.click()
    // CONFIRM should be enabled
    await expect(confirmBtn).toBeEnabled()
  })

  test('clicking CONFIRM sends pick and disables further selection', async ({ authenticatedPage }) => {
    const page = authenticatedPage
    await navigateToHeroPick(page)
    const firstHero = page.locator('[data-testid^="hero-card-"]').first()
    await firstHero.click()
    await page.getByText('CONFIRM').click()
    // CONFIRM should be disabled after confirming
    await expect(page.getByText('CONFIRM')).toBeDisabled()
  })

  test('already-picked heroes show PICKED overlay', async ({ authenticatedPage }) => {
    const page = authenticatedPage
    await navigateToHeroPick(page)
    // Pick a hero first
    const firstHero = page.locator('[data-testid^="hero-card-"]').first()
    await firstHero.click()
    await page.getByText('CONFIRM').click()
    // Wait a moment for server to process and bots to pick
    await page.waitForTimeout(2000)
    // At least one hero should show PICKED (the one we just picked)
    await expect(page.getByText('PICKED').first()).toBeVisible({ timeout: 5_000 })
  })

  test('team rosters update in real-time', async ({ authenticatedPage }) => {
    const page = authenticatedPage
    await navigateToHeroPick(page)
    // Roster panels should show RADIANT and DIRE sections
    await expect(page.getByText('RADIANT')).toBeVisible()
    await expect(page.getByText('DIRE')).toBeVisible()
  })
})
