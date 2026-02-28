import type { Page } from '@playwright/test'

export class LeaderboardPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/leaderboard')
  }

  get table() {
    return this.page.locator('table')
  }

  get playerRows() {
    return this.table.locator('tbody tr')
  }

  get emptyState() {
    return this.page.getByText('No players found.')
  }

  get columnHeaders() {
    return this.table.locator('thead th')
  }

  playerLink(index: number) {
    return this.playerRows.nth(index).locator('a')
  }
}
