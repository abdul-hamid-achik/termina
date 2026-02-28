import { test, expect } from '@playwright/test'
import { LoginPage } from '../../pages/login.page'

test.describe('Register', () => {
  test('register tab shows confirm password field', async ({ page }) => {
    const loginPage = new LoginPage(page)
    await loginPage.goto()
    await loginPage.switchToRegister()
    await expect(loginPage.confirmPasswordInput).toBeVisible()
  })

  test('username validation: 3-20 chars, alphanumeric only', async ({ page }) => {
    const loginPage = new LoginPage(page)
    await loginPage.goto()
    await loginPage.switchToRegister()
    await loginPage.usernameInput.fill('ab')
    await expect(page.getByText('must be 3-20 characters')).toBeVisible()
    await loginPage.usernameInput.fill('valid_username')
    await expect(page.getByText('ok')).toBeVisible()
  })

  test('password validation: min 8 chars', async ({ page }) => {
    const loginPage = new LoginPage(page)
    await loginPage.goto()
    await loginPage.switchToRegister()
    await loginPage.passwordInput.fill('short')
    await expect(page.getByText(/\/8 chars required/)).toBeVisible()
    await loginPage.passwordInput.fill('longpassword')
    await expect(page.locator('div').filter({ hasText: /^ok$/ })).toBeVisible()
  })

  test('confirm password mismatch shows error', async ({ page }) => {
    const loginPage = new LoginPage(page)
    await loginPage.goto()
    await loginPage.switchToRegister()
    await loginPage.passwordInput.fill('password123')
    await loginPage.confirmPasswordInput.fill('different')
    await expect(page.getByText('passwords do not match')).toBeVisible()
  })

  test('successful registration redirects to /', async ({ page }) => {
    const loginPage = new LoginPage(page)
    await loginPage.goto()
    const username = `tr_${Math.random().toString(36).slice(2, 10)}`
    await loginPage.register(username, 'E2eTestPass123!')
    await page.waitForURL('/', { timeout: 10_000 })
    await expect(page).toHaveURL('/')
  })

  test('duplicate username returns error', async ({ page, request }) => {
    const username = `td_${Math.random().toString(36).slice(2, 10)}`
    const password = 'E2eTestPass123!'
    // Register first via API
    await request.post('/api/auth/register', { data: { username, password } })
    await page.context().clearCookies()

    // Try to register with same username via UI
    const loginPage = new LoginPage(page)
    await loginPage.goto()
    await loginPage.register(username, password)
    await expect(loginPage.errorMessage).toBeVisible({ timeout: 5_000 })
  })
})
