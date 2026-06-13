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
      // Generous timeout: bot-fill + lobby transition is normally ~10-15s, but
      // late in a long suite the single dev server is loaded and matchmaking
      // can crawl — 45s was too tight and flaked. (Faster, load-independent
      // path = a test-only direct start-game hook; documented follow-up.)
      await page.getByTestId('hero-picker').waitFor({ timeout: 90_000 })

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

      // Wait for the first tick_state to land (hero-status renders only once
      // player data exists in the store). This proves the game WS stream is
      // actually live — the dev proxy chain can drop the server side of a
      // fresh socket, and the client needs a heartbeat-watchdog reconnect
      // cycle (~30s) to recover from that.
      await page.getByTestId('hero-status').waitFor({ timeout: 60_000 })

      // Capture the live gameId so teardown can stop the server-side game loop.
      const gameId = await page.getByTestId('game-screen').getAttribute('data-game-id')

      await use(page)

      // Teardown: end this spec's game via the test-only force-end hook so its
      // loop stops ticking. Otherwise every game-fixture spec leaves a game
      // running server-side for the rest of the suite; they accumulate, starve
      // CPU, and slow later specs' matchmaking into flaky timeouts. Best-effort.
      if (gameId) {
        await page
          .request.post('/api/test/force-end', { data: { gameId, winner: 'radiant' } })
          .catch(() => {})
      }
    },
    // Total fixture budget: matchmaking (up to ~90s under load) + load into
    // game + first-tick wait (up to 60s) need headroom beyond the old 180s.
    { timeout: 300_000 },
  ],
})

export { expect } from '@playwright/test'
