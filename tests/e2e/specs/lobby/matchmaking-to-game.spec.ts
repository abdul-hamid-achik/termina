import { test, expect } from '../../fixtures/game'

test.describe('Matchmaking to Game', () => {
  // These tests require WebSocket to deliver game_starting message
  // which doesn't work through the Nuxt dev proxy in test environments
  test.skip('full flow: queue -> bot fill -> hero pick -> game start -> /play', async ({ gamePage }) => {
    // The gamePage fixture handles the entire flow
    // Just verify we're on /play with the game screen
    await expect(gamePage).toHaveURL(/\/play/)
    await expect(gamePage.getByTestId('game-screen')).toBeVisible()
  })

  test.skip('game screen loads with all UI panels visible', async ({ gamePage }) => {
    await expect(gamePage.getByTestId('game-screen')).toBeVisible()
    await expect(gamePage.getByTestId('game-state-bar')).toBeVisible()
    await expect(gamePage.getByTestId('ascii-map')).toBeVisible()
    await expect(gamePage.getByTestId('combat-log')).toBeVisible()
    await expect(gamePage.getByTestId('hero-status')).toBeVisible()
    await expect(gamePage.getByTestId('command-input')).toBeVisible()
  })
})
