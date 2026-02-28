import type { Page } from '@playwright/test'
import { test as base } from './base'

type GameFixtures = {
  gamePage: Page
}

export const test = base.extend<GameFixtures>({
  gamePage: async ({ authenticatedPage }, use) => {
    const page = authenticatedPage

    // Navigate to lobby and join queue
    await page.goto('/lobby')
    await page.getByText('FIND MATCH').click()

    // Poll status API until match enters lobby phase
    // (bots auto-fill after ~10s, matchmaking loop runs every ~5s)
    const startTime = Date.now()
    while (Date.now() - startTime < 45_000) {
      const res = await page.request.get('/api/queue/status')
      const data = await res.json()
      if (data.status === 'lobby' || data.status === 'game_starting') {
        break
      }
      await page.waitForTimeout(2000)
    }

    // Reload lobby to trigger recovery and show hero picker
    await page.goto('/lobby')
    await page.getByTestId('hero-picker').waitFor({ timeout: 15_000 })

    // Pick the first available hero (not already picked)
    const heroCards = page.locator('[data-testid^="hero-card-"]')
    const count = await heroCards.count()
    for (let i = 0; i < count; i++) {
      const card = heroCards.nth(i)
      const pickedOverlay = card.locator('text=PICKED')
      if (!(await pickedOverlay.isVisible())) {
        await card.click()
        break
      }
    }

    // Confirm pick
    const confirmBtn = page.getByText('CONFIRM')
    await confirmBtn.waitFor({ state: 'visible' })
    // Small delay to ensure hero is selected
    await page.waitForTimeout(200)
    await confirmBtn.click()

    // Poll for game_starting since WebSocket may not work through dev proxy
    const pickTime = Date.now()
    let gameId: string | null = null
    while (Date.now() - pickTime < 60_000) {
      const res = await page.request.get('/api/queue/status')
      const data = await res.json()
      if (data.status === 'game_starting' && data.gameId) {
        gameId = data.gameId
        break
      }
      await page.waitForTimeout(2000)
    }

    if (gameId) {
      // Navigate directly to /play — the game page will connect via WebSocket
      await page.goto(`/play?gameId=${gameId}`)
    } else {
      // Fallback: wait for normal navigation
      await page.waitForURL('**/play', { timeout: 30_000 })
    }

    // Wait for game screen to render
    await page.getByTestId('game-screen').waitFor({ timeout: 30_000 })

    await use(page)
  },
})

export { expect } from '@playwright/test'
