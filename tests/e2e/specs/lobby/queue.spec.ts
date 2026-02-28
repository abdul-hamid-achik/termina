import { test, expect } from '../../fixtures/base'

test.describe('Queue', () => {
  test('shows FIND MATCH button when idle', async ({ authenticatedPage }) => {
    const page = authenticatedPage
    await page.goto('/lobby')
    await expect(page.getByText('FIND MATCH')).toBeVisible()
  })

  test('clicking FIND MATCH enters searching state with timer', async ({ authenticatedPage }) => {
    const page = authenticatedPage
    await page.goto('/lobby')
    await page.getByText('FIND MATCH').click()
    // Should see the MatchQueue with timer and player count
    await expect(page.getByTestId('match-queue')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText(/Players Found/)).toBeVisible()
  })

  test('leave queue returns to idle', async ({ authenticatedPage }) => {
    const page = authenticatedPage
    await page.goto('/lobby')
    await page.getByText('FIND MATCH').click()
    await expect(page.getByTestId('match-queue')).toBeVisible({ timeout: 5_000 })
    await page.getByText('CANCEL').click()
    await expect(page.getByText('FIND MATCH')).toBeVisible({ timeout: 5_000 })
  })

  test('queue updates show player count', async ({ authenticatedPage }) => {
    const page = authenticatedPage
    await page.goto('/lobby')
    await page.getByText('FIND MATCH').click()
    // Wait for at least 1/10 players to show
    await expect(page.getByText(/\d+\/\d+ Players Found/)).toBeVisible({ timeout: 10_000 })
  })
})
