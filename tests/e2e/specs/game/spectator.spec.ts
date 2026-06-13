import { test, expect } from '../../fixtures/game'
import { generateTestUser, registerAndLogin } from '../../helpers/auth'

/**
 * Live spectator smoke — exercises the full /lobby → /play → /spectate path.
 *
 * Requires the same backing services as the rest of the e2e suite:
 *   docker compose up -d   (Postgres + Redis)
 *   bun run dev            (Nuxt dev server)
 *
 * The first user gets dropped into a real game via the gamePage fixture
 * (single human + nine bots). A second browser context, authenticated as a
 * different user, opens /spectate/<gameId> and we verify the page transitions
 * from CONNECTING to CONNECTED, receives at least one tick, and renders the
 * scoreboard. This catches regressions in the spectator wiring (WS handler,
 * SpectatorRegistry, GameLoop's onSpectatorTick).
 */

test.describe('Live spectator', () => {
  test('a second user can spectate an in-progress game', async ({ gamePage, browser, request }) => {
    // Pull the gameId out of the running game's DOM. The data-game-id attr
    // is set by GameScreen.vue from the gameStore.
    const gameId = await gamePage
      .getByTestId('game-screen')
      .getAttribute('data-game-id', { timeout: 30_000 })
    expect(gameId, 'gameId attribute on game-screen').toBeTruthy()
    expect(gameId!).toMatch(/^game_/)

    // Spectator gets their own auth + browser context — no shared cookies.
    const spectatorUser = generateTestUser()
    const { cookies } = await registerAndLogin(request, spectatorUser)
    const specCtx = await browser.newContext()
    await specCtx.addCookies(
      cookies.cookies.map((c) => ({
        ...c,
        sameSite: (c.sameSite as 'Strict' | 'Lax' | 'None') ?? 'Lax',
      })),
    )
    const specPage = await specCtx.newPage()

    // Hydrate the session before navigating to /spectate (same pattern as
    // the authenticatedPage fixture — /spectate is SSR-disabled so the
    // session needs to be in the cookie store).
    await specPage.goto('/')
    await specPage.waitForLoadState('networkidle')

    await specPage.goto(`/spectate/${gameId}`)

    // Header should print the gameId — confirms the route mounted.
    await expect(specPage.locator('h1')).toContainText(gameId!)

    // The connection-state indicator flips through CONNECTING → CONNECTED.
    await expect(specPage.locator('text=[CONNECTED]')).toBeVisible({ timeout: 30_000 })

    // Once a tick lands the score banner replaces the "waiting" text. Ticks
    // arrive every 4s (faster under TERMINA_TEST_FAST_GAME); allow a few
    // ticks of slack for slow CI.
    await expect(specPage.getByTestId('spectator-score-radiant')).toBeVisible({
      timeout: 20_000,
    })
    await expect(specPage.getByTestId('spectator-score-radiant')).toContainText('RADIANT')
    await expect(specPage.getByTestId('spectator-score-dire')).toContainText('DIRE')

    // A real spectator_tick was processed: the tick counter in the centre
    // panel shows a number > 0.
    await expect(specPage.getByTestId('spectator-tick')).toHaveText(/^[1-9]\d*$/, {
      timeout: 20_000,
    })

    await specCtx.close()
  })
})
