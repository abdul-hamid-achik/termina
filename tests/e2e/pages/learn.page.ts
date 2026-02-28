import type { Page } from '@playwright/test'

export class LearnPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/learn')
  }

  get quickStartSection() {
    return this.page.locator('[class*="TerminalPanel"]').filter({ hasText: 'Quick Start Guide' })
  }

  get commandReferenceSection() {
    return this.page.locator('[class*="TerminalPanel"]').filter({ hasText: 'Command Reference' })
  }

  get gameConceptsSection() {
    return this.page.locator('[class*="TerminalPanel"]').filter({ hasText: 'Game Concepts' })
  }

  get commandRows() {
    return this.commandReferenceSection.locator('tbody tr')
  }

  get enterTerminalButton() {
    return this.page.getByRole('link', { name: 'ENTER THE TERMINAL' })
  }

  get viewLeaderboardButton() {
    return this.page.getByRole('link', { name: 'VIEW LEADERBOARD' })
  }
}
