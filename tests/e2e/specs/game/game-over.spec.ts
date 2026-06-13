import { test, expect } from '../../fixtures/game'

// Games end when a team destroys the enemy Ancient. The fast-game test hook
// (TERMINA_TEST_FAST_GAME, set in playwright.config.ts) shrinks Ancient/tower
// HP and speeds the tick. A live game has one idle human (the test browser)
// plus 9 bots, so it runs longer and far more variably than the all-bot sim —
// the slow tail reaches ~tick 930 (~8 min of real time at factor 8). The four
// post-game assertions all inspect the SAME end screen, so we play ONE game to
// completion and assert everything in sequence rather than replaying a full
// match four times (which is what made the suite take hours).
const GAME_END_TIMEOUT = 540_000 // wait for the post-game screen to appear
const TEST_TIMEOUT = 720_000 // total budget: fixture matchmaking + the game

test.describe('Game Over', () => {
  test.setTimeout(TEST_TIMEOUT)

  test('post-game screen shows victory, personal stats, full scoreboard, and navigates home', async ({
    gamePage,
  }) => {
    // Wait for game to end (a team destroys the enemy Ancient)
    const postGame = gamePage.getByTestId('post-game')
    await postGame.waitFor({ timeout: GAME_END_TIMEOUT })

    // Victory banner
    await expect(gamePage.getByText(/RADIANT VICTORY|DIRE VICTORY/)).toBeVisible()

    // Personal stats section
    await expect(postGame.getByText('K/D/A')).toBeVisible()
    await expect(postGame.getByText('Hero Damage')).toBeVisible()
    await expect(postGame.getByText('Gold Earned')).toBeVisible()

    // Full scoreboard: both team sections (exact — the victory banner also
    // contains the winning team's name as a substring) and 10 player rows.
    await expect(postGame.getByText('RADIANT', { exact: true })).toBeVisible()
    await expect(postGame.getByText('DIRE', { exact: true })).toBeVisible()
    expect(await postGame.locator('tbody tr').count()).toBe(10) // 5 radiant + 5 dire

    // MAIN MENU returns to the landing page (done last — it leaves post-game)
    await gamePage.getByTestId('return-to-menu-btn').click()
    await gamePage.waitForURL('/', { timeout: 5_000 })
    await expect(gamePage).toHaveURL('/')
  })
})
