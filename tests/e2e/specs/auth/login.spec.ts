import { test, expect } from '@playwright/test'
import { test as authTest } from '../../fixtures/base'
import { LoginPage } from '../../pages/login.page'

test.describe('Login', () => {
  test('renders login form with username, password, and LOGIN button', async ({ page }) => {
    const loginPage = new LoginPage(page)
    await loginPage.goto()
    await expect(loginPage.usernameInput).toBeVisible()
    await expect(loginPage.passwordInput).toBeVisible()
    await expect(loginPage.submitButton).toBeVisible()
    await expect(loginPage.submitButton).toHaveText(/LOGIN/)
  })

  test('successful login redirects to /', async ({ page, request }) => {
    // First register a user via API
    const username = `tl_${Math.random().toString(36).slice(2, 10)}`
    const password = 'E2eTestPass123!'
    await request.post('/api/auth/register', {
      data: { username, password },
    })
    // Clear any cookies from the registration
    await page.context().clearCookies()

    const loginPage = new LoginPage(page)
    await loginPage.goto()
    await loginPage.login(username, password)
    await page.waitForURL('/', { timeout: 10_000 })
    await expect(page).toHaveURL('/')
  })

  test('invalid credentials show [ERR] error message', async ({ page }) => {
    const loginPage = new LoginPage(page)
    await loginPage.goto()
    await loginPage.login('nonexistent_user_xyz', 'wrongpassword')
    await expect(loginPage.errorMessage).toBeVisible({ timeout: 5_000 })
    await expect(loginPage.errorMessage).toContainText('[ERR]')
  })

  test('empty fields prevent submission', async ({ page }) => {
    const loginPage = new LoginPage(page)
    await loginPage.goto()
    // Don't fill anything, try to click submit
    const submitBtn = loginPage.submitButton
    await expect(submitBtn).toBeDisabled()
  })

  authTest('login session persists across page reload', async ({ authenticatedPage }) => {
    const page = authenticatedPage
    await page.goto('/')
    // Should see LOGOUT button (means logged in)
    await expect(page.getByText('[LOGOUT]')).toBeVisible()
    // Reload the page
    await page.reload()
    // Should still be logged in
    await expect(page.getByText('[LOGOUT]')).toBeVisible()
  })
})
