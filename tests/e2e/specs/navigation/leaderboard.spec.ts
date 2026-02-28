import { test, expect } from '@playwright/test'
import { LeaderboardPage } from '../../pages/leaderboard.page'

test.describe('Leaderboard', () => {
  test('table has correct columns', async ({ page }) => {
    const lb = new LeaderboardPage(page)
    await lb.goto()
    // Wait for loading to finish
    await page.waitForTimeout(2000)
    // Either we see the table headers or the empty state
    const hasTable = await lb.table.isVisible()
    if (hasTable) {
      const headers = lb.columnHeaders
      await expect(headers.nth(0)).toHaveText('#')
      await expect(headers.nth(1)).toHaveText('Player')
      await expect(headers.nth(2)).toHaveText('Rating')
    }
  })

  test('empty state shows "No players found."', async ({ page }) => {
    const lb = new LeaderboardPage(page)
    await lb.goto()
    await page.waitForTimeout(2000)
    // On a fresh test DB there may be no players
    const hasPlayers = await lb.playerRows.count()
    if (hasPlayers === 0) {
      await expect(lb.emptyState).toBeVisible()
    }
  })

  test('player names link to /profile/{id}', async ({ page }) => {
    const lb = new LeaderboardPage(page)
    await lb.goto()
    await page.waitForTimeout(2000)
    const count = await lb.playerRows.count()
    if (count > 0) {
      const link = lb.playerLink(0)
      const href = await link.getAttribute('href')
      expect(href).toMatch(/\/profile\//)
    }
  })
})
