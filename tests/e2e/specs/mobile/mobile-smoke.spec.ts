import { test, expect } from '../../fixtures/base'
import { HomePage } from '../../pages/home.page'
import { LoginPage } from '../../pages/login.page'

/**
 * Mobile smoke journey — runs only in the `mobile-chromium` project
 * (Pixel 7: isMobile + hasTouch). Verifies the core entry path renders
 * and is reachable on a touch viewport: landing → login → lobby.
 */
test.describe('Mobile smoke journey', () => {
  test('landing page renders logo, tagline, and CTAs on mobile', async ({ page }) => {
    const home = new HomePage(page)
    await home.goto()

    await expect(home.logo).toBeVisible()
    await expect(home.tagline).toBeVisible()
    await expect(home.enterTerminalButton).toBeVisible()
    await expect(home.enterTerminalButton).toHaveAttribute('href', '/lobby')
    await expect(home.learnCommandsButton).toHaveAttribute('href', '/learn')
  })

  test('login page renders form controls and OAuth options on mobile', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()

    await expect(login.usernameInput).toBeVisible()
    await expect(login.passwordInput).toBeVisible()
    await expect(login.loginTab).toBeVisible()
    await expect(login.registerTab).toBeVisible()
    await expect(login.githubButton).toBeVisible()
  })

  test('authenticated user reaches the lobby and can see FIND MATCH on mobile', async ({
    authenticatedPage,
  }) => {
    const page = authenticatedPage
    await page.goto('/lobby')
    await expect(page.getByText('FIND MATCH')).toBeVisible()
  })
})
