import { test, expect } from '@playwright/test'
import { LearnPage } from '../../pages/learn.page'

test.describe('Learn Page', () => {
  test('Quick Start, Command Reference, and Game Concepts sections render', async ({ page }) => {
    const learnPage = new LearnPage(page)
    await learnPage.goto()
    await expect(page.getByText('Quick Start Guide')).toBeVisible()
    await expect(page.getByText('Command Reference')).toBeVisible()
    await expect(page.getByText('Game Concepts')).toBeVisible()
  })

  test('command reference table lists commands', async ({ page }) => {
    const learnPage = new LearnPage(page)
    await learnPage.goto()
    // Check for key commands in the reference table
    await expect(page.getByText('move <zone>')).toBeVisible()
    await expect(page.getByText('attack <target>')).toBeVisible()
    await expect(page.getByText('cast <q|w|e|r> [target]')).toBeVisible()
    await expect(page.getByText('buy <item>')).toBeVisible()
  })

  test('CTA buttons link to /lobby and /leaderboard', async ({ page }) => {
    const learnPage = new LearnPage(page)
    await learnPage.goto()
    await expect(learnPage.enterTerminalButton).toHaveAttribute('href', '/lobby')
    await expect(learnPage.viewLeaderboardButton).toHaveAttribute('href', '/leaderboard')
  })
})
