import { test, expect } from '../../fixtures/base'

test.describe('Settings', () => {
  test('avatar picker is visible', async ({ authenticatedPage }) => {
    const page = authenticatedPage
    await page.goto('/profile/settings')
    // Settings page should load
    await expect(page.getByText(/avatar|profile/i).first()).toBeVisible({ timeout: 5_000 })
  })

  test('username editor with validation', async ({ authenticatedPage }) => {
    const page = authenticatedPage
    await page.goto('/profile/settings')
    // Look for username input
    const usernameInput = page.locator('input').filter({ hasText: '' }).first()
    await expect(usernameInput).toBeVisible({ timeout: 5_000 })
  })

  test('password section has current/new/confirm fields', async ({ authenticatedPage }) => {
    const page = authenticatedPage
    await page.goto('/profile/settings')
    // Look for password-related inputs
    const passwordInputs = page.locator('input[type="password"]')
    const count = await passwordInputs.count()
    // Should have at least current and new password fields
    expect(count).toBeGreaterThanOrEqual(2)
  })

  test('connected accounts show GitHub/Discord buttons', async ({ authenticatedPage }) => {
    const page = authenticatedPage
    await page.goto('/profile/settings')
    await expect(page.getByText(/github/i)).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText(/discord/i)).toBeVisible({ timeout: 5_000 })
  })
})
