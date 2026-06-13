import { test, expect } from '../../fixtures/game'

// Games normally end when a team destroys the enemy Ancient — minutes of bot
// play even under the fast-game hook, and highly variable. Instead we end the
// game deterministically: once the gamePage fixture has the live game loaded,
// we read its gameId off the game screen and POST /api/test/force-end (a
// test-only server hook, gated on TERMINA_TEST_HOOKS=1 in playwright.config.ts).
// That flips the game's phase to 'ended'; the running GameLoop broadcasts
// game_over on its next tick (<1s under the fast-game interval), so the
// post-game screen appears almost immediately. The four post-game assertions
// all inspect the SAME end screen, so we end ONE game and assert in sequence.
const GAME_END_TIMEOUT = 30_000 // post-game screen is near-instant after force-end
const TEST_TIMEOUT = 240_000 // budget: fixture matchmaking + lobby + nav

test.describe('Game Over', () => {
  test.setTimeout(TEST_TIMEOUT)

  test('post-game screen shows victory, personal stats, full scoreboard, and navigates home', async ({
    gamePage,
  }) => {
    // The fixture has navigated to /play and waited for the game screen + first
    // tick. Read the live gameId off the game screen, then force the game to end.
    const gameId = await gamePage.getByTestId('game-screen').getAttribute('data-game-id')
    expect(gameId).toBeTruthy()

    const res = await gamePage.request.post('/api/test/force-end', {
      data: { gameId, winner: 'radiant' },
    })
    expect(res.ok()).toBe(true)
    expect((await res.json()).ended).toBe(true)

    // The next tick broadcasts game_over → the client renders the post-game screen.
    const postGame = gamePage.getByTestId('post-game')
    await postGame.waitFor({ timeout: GAME_END_TIMEOUT })

    // Victory banner — we forced a radiant win.
    await expect(gamePage.getByText('RADIANT VICTORY')).toBeVisible()

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
