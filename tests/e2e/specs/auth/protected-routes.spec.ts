import { test, expect } from '@playwright/test'

test.describe('Protected routes', () => {
  test('unauthenticated /lobby redirects to /login', async ({ page }) => {
    await page.goto('/lobby')
    await page.waitForURL('**/login', { timeout: 10_000 })
    await expect(page).toHaveURL(/\/login/)
  })

  test('unauthenticated /play redirects to /login', async ({ page }) => {
    await page.goto('/play')
    await page.waitForURL('**/login', { timeout: 10_000 })
    await expect(page).toHaveURL(/\/login/)
  })

  test('unauthenticated /profile/settings redirects to /login', async ({ page }) => {
    await page.goto('/profile/settings')
    await page.waitForURL('**/login', { timeout: 10_000 })
    await expect(page).toHaveURL(/\/login/)
  })

  test('unauthenticated public pages do not redirect', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL('/')

    await page.goto('/learn')
    await expect(page).toHaveURL('/learn')

    await page.goto('/leaderboard')
    await expect(page).toHaveURL('/leaderboard')
  })
})
