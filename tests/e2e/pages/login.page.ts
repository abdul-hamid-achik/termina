import type { Page } from '@playwright/test'

export class LoginPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/login')
  }

  get usernameInput() {
    return this.page.getByPlaceholder('enter_username')
  }

  get passwordInput() {
    return this.page.locator('input[type="password"]').first()
  }

  get confirmPasswordInput() {
    return this.page.locator('input[type="password"]').nth(1)
  }

  get loginTab() {
    return this.page.getByRole('button', { name: '> login' })
  }

  get registerTab() {
    return this.page.getByRole('button', { name: '> register' })
  }

  get submitButton() {
    return this.page.locator('button').filter({ hasText: /LOGIN|REGISTER|PROCESSING/ })
  }

  get errorMessage() {
    return this.page.locator('[class*="text-dire"]').filter({ hasText: '[ERR]' }).first()
  }

  get githubButton() {
    return this.page.getByText('CONTINUE WITH GITHUB')
  }

  get discordButton() {
    return this.page.getByText('CONTINUE WITH DISCORD')
  }

  async switchToLogin() {
    await this.loginTab.click()
  }

  async switchToRegister() {
    await this.registerTab.click()
  }

  async login(username: string, password: string) {
    await this.switchToLogin()
    await this.usernameInput.fill(username)
    await this.passwordInput.fill(password)
    await this.submitButton.click()
  }

  async register(username: string, password: string) {
    await this.switchToRegister()
    await this.usernameInput.fill(username)
    await this.passwordInput.fill(password)
    await this.confirmPasswordInput.fill(password)
    await this.submitButton.click()
  }
}
