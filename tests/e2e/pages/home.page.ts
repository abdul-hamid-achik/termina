import type { Page } from '@playwright/test'

export class HomePage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/')
  }

  get logo() {
    return this.page.locator('pre.text-glow').first()
  }

  get tagline() {
    return this.page.getByText('where every command is a kill').first()
  }

  get enterTerminalButton() {
    return this.page.getByRole('link', { name: 'ENTER THE TERMINAL' })
  }

  get learnCommandsButton() {
    return this.page.getByRole('link', { name: 'LEARN COMMANDS' })
  }

  async clickEnterTerminal() {
    await this.enterTerminalButton.click()
  }

  async clickLearnCommands() {
    await this.learnCommandsButton.click()
  }
}
