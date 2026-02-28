import { test, expect } from '../../fixtures/game'
import { test as authTest, expect as authExpect } from '../../fixtures/base'

test.describe.skip('Game Screen', () => {
  test('game screen renders grid: map, log, hero status, command input, state bar', async ({ gamePage }) => {
    await expect(gamePage.getByTestId('game-screen')).toBeVisible()
    await expect(gamePage.getByTestId('ascii-map')).toBeVisible()
    await expect(gamePage.getByTestId('combat-log')).toBeVisible()
    await expect(gamePage.getByTestId('hero-status')).toBeVisible()
    await expect(gamePage.getByTestId('command-input')).toBeVisible()
    await expect(gamePage.getByTestId('game-state-bar')).toBeVisible()
  })

  test('GameStateBar shows tick number, game time, gold, K/D/A', async ({ gamePage }) => {
    const bar = gamePage.getByTestId('game-state-bar')
    await expect(bar).toBeVisible()
    await expect(bar.getByText(/Tick:/)).toBeVisible()
    await expect(bar.getByText(/\d{2}:\d{2}/)).toBeVisible()
    await expect(bar.getByText(/Gold:/)).toBeVisible()
    await expect(bar.getByText(/KDA:/)).toBeVisible()
  })

  test('connection indicator shows connected', async ({ gamePage }) => {
    const bar = gamePage.getByTestId('game-state-bar')
    await expect(bar.getByText('[CONNECTED')).toBeVisible({ timeout: 10_000 })
  })
})

authTest.describe('Game Screen - No Game', () => {
  authTest('redirects to /lobby if no gameId/playerId', async ({ authenticatedPage }) => {
    const page = authenticatedPage
    await page.goto('/play')
    await page.waitForURL('**/lobby', { timeout: 10_000 })
    await authExpect(page).toHaveURL(/\/lobby/)
  })
})
