import { test, expect } from '../../fixtures/game'
import { test as authTest, expect as authExpect } from '../../fixtures/base'

test.describe('Game Screen', () => {
  test('game screen renders grid: map, log, hero status, command input, state bar', async ({
    gamePage,
  }) => {
    await expect(gamePage.getByTestId('game-screen')).toBeVisible()
    await expect(gamePage.getByTestId('ascii-map')).toBeVisible()
    await expect(gamePage.getByTestId('combat-log')).toBeVisible()
    await expect(gamePage.getByTestId('hero-status')).toBeVisible()
    await expect(gamePage.getByTestId('command-input')).toBeVisible()
    await expect(gamePage.getByTestId('game-state-bar')).toBeVisible()
  })

  test('GameStateBar shows tick number, countdown, game time, gold, K/D/A', async ({
    gamePage,
  }) => {
    const bar = gamePage.getByTestId('game-state-bar')
    await expect(bar).toBeVisible()
    await expect(bar.getByText('Tick', { exact: true })).toBeVisible()
    // Live tick countdown (new): bar + seconds readout
    await expect(bar.getByTestId('tick-countdown')).toBeVisible()
    await expect(bar.getByTestId('tick-countdown').getByText(/\d+\.\ds/)).toBeVisible()
    // Anchored: the day/night remaining readout "(20:00)" would otherwise
    // also match a bare \d{2}:\d{2} pattern
    await expect(bar.getByText(/^\d{2}:\d{2}$/)).toBeVisible()
    await expect(bar.getByText('Gold', { exact: true })).toBeVisible()
    await expect(bar.getByText('KDA', { exact: true })).toBeVisible()
  })

  test('connection indicator shows online with latency', async ({ gamePage }) => {
    const bar = gamePage.getByTestId('game-state-bar')
    await expect(bar.getByText(/\[ONLINE \d+ms\]/)).toBeVisible({ timeout: 10_000 })
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
