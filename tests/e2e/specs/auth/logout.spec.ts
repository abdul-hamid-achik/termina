import { test, expect } from '../../fixtures/base'

test.describe('Logout', () => {
  test('clicking [LOGOUT] clears session and redirects to /login', async ({ authenticatedPage }) => {
    const page = authenticatedPage
    await page.goto('/')
    await page.getByText('[LOGOUT]').click()
    await page.waitForURL('**/login', { timeout: 5_000 })
    await expect(page).toHaveURL(/\/login/)
  })

  test('after logout, /lobby redirects to /login', async ({ authenticatedPage }) => {
    const page = authenticatedPage
    await page.goto('/')
    await page.getByText('[LOGOUT]').click()
    await page.waitForURL('**/login')
    await page.goto('/lobby')
    await page.waitForURL('**/login', { timeout: 5_000 })
    await expect(page).toHaveURL(/\/login/)
  })
})
