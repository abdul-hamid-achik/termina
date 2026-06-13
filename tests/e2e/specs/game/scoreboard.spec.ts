import { test, expect } from '../../fixtures/game'
import type { Page } from '@playwright/test'

// Tab is autocomplete while the command input is focused (it autofocuses on
// mount); the scoreboard binding only fires when no input has focus. Blur the
// input first, like a player clicking away before holding Tab.
async function blurCommandInput(page: Page) {
  await page.getByTestId('command-input-field').blur()
}

test.describe('Scoreboard', () => {
  test('Tab key press shows scoreboard overlay', async ({ gamePage }) => {
    await blurCommandInput(gamePage)
    await gamePage.keyboard.down('Tab')
    await expect(gamePage.getByTestId('scoreboard')).toBeVisible({ timeout: 2_000 })
    await gamePage.keyboard.up('Tab')
  })

  test('Tab release hides scoreboard', async ({ gamePage }) => {
    await blurCommandInput(gamePage)
    await gamePage.keyboard.down('Tab')
    await expect(gamePage.getByTestId('scoreboard')).toBeVisible({ timeout: 2_000 })
    await gamePage.keyboard.up('Tab')
    await expect(gamePage.getByTestId('scoreboard')).not.toBeVisible({ timeout: 2_000 })
  })

  test('scoreboard shows both teams with K/D/A, level, gold', async ({ gamePage }) => {
    await blurCommandInput(gamePage)
    await gamePage.keyboard.down('Tab')
    const scoreboard = gamePage.getByTestId('scoreboard')
    await expect(scoreboard).toBeVisible({ timeout: 2_000 })

    // Should show RADIANT and DIRE labels
    await expect(scoreboard.getByText('RADIANT')).toBeVisible()
    await expect(scoreboard.getByText('DIRE')).toBeVisible()

    // Both team blocks render with five player rows each
    await expect(scoreboard.getByTestId('scoreboard-team-radiant')).toBeVisible()
    await expect(scoreboard.getByTestId('scoreboard-team-dire')).toBeVisible()
    await expect(scoreboard.locator('.scoreboard__player-row')).toHaveCount(10)

    // Should show column headers (one set per team block)
    await expect(scoreboard.getByText('Player').first()).toBeVisible()
    await expect(scoreboard.getByText('K/D/A').first()).toBeVisible()
    await expect(scoreboard.getByText('Lv').first()).toBeVisible()
    await expect(scoreboard.getByText('Gold').first()).toBeVisible()

    await gamePage.keyboard.up('Tab')
  })

  test("current player's row is highlighted", async ({ gamePage }) => {
    await blurCommandInput(gamePage)
    await gamePage.keyboard.down('Tab')
    const scoreboard = gamePage.getByTestId('scoreboard')
    await expect(scoreboard).toBeVisible({ timeout: 2_000 })

    // Current player row has special class
    const selfRow = scoreboard.locator('.scoreboard__player-row--self')
    await expect(selfRow).toBeVisible()

    await gamePage.keyboard.up('Tab')
  })
})
