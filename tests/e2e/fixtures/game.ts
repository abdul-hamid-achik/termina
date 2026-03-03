import type { Page } from '@playwright/test'
import { test as base } from './base'

type GameFixtures = {
  gamePage: Page
}

export const test = base.extend<GameFixtures>({
  gamePage: [
    async ({ authenticatedPage }, use) => {
      const page = authenticatedPage

      // Navigate to lobby and click FIND MATCH
      await page.goto('/lobby')
      await page.getByText('FIND MATCH').click()

      // Wait for hero picker to appear naturally via WS lobby_state.
      // DO NOT reload the page — that disconnects WS and cancels the lobby.
      await page.getByTestId('hero-picker').waitFor({ timeout: 45_000 })

      // Try to pick a hero before bots take them all.
      // If the confirm fails (race with auto-pick), that's fine — the game
      // will start via server auto-pick for all players.
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
      const confirmBtn = page.getByText('CONFIRM')
      // Only click CONFIRM if it's enabled (hero was successfully selected)
      if (await confirmBtn.isEnabled().catch(() => false)) {
        await confirmBtn.click()
      }

      // Wait for navigation to /play. The lobby page auto-navigates when
      // game_starting arrives via WS. If picks were auto-completed, the game
      // starts without user interaction — just wait for it.
      await page.waitForURL('**/play', { timeout: 90_000 })

      // Wait for game screen to render
      await page.getByTestId('game-screen').waitFor({ timeout: 30_000 })

      await use(page)
    },
    { timeout: 180_000 },
  ],
})

export { expect } from '@playwright/test'
