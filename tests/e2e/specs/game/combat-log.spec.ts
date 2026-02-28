import { test, expect } from '../../fixtures/game'

test.describe.skip('Combat Log', () => {
  test('after first tick, "Connected to game server" message appears', async ({ gamePage }) => {
    const log = gamePage.getByTestId('combat-log')
    await expect(log).toBeVisible()
    await expect(log.getByText('Connected to game server')).toBeVisible({ timeout: 15_000 })
  })

  test('events are color-coded by type', async ({ gamePage }) => {
    const log = gamePage.getByTestId('combat-log')
    await expect(log).toBeVisible()

    // Wait for some events to appear
    await gamePage.waitForTimeout(8_000)

    // Log entries should have border-l-2 styling for color coding
    const entries = log.locator('[class*="border-l-2"]')
    const count = await entries.count()
    expect(count).toBeGreaterThan(0)
  })

  test('log auto-scrolls; manual scroll shows pin indicator', async ({ gamePage }) => {
    const log = gamePage.getByTestId('combat-log')
    await expect(log).toBeVisible()

    // Wait for events
    await gamePage.waitForTimeout(8_000)

    // Scroll to top manually
    const scrollContainer = log.locator('[class*="overflow-y-auto"]')
    await scrollContainer.evaluate((el) => {
      el.scrollTop = 0
    })

    // Pin indicator should appear
    await expect(log.getByText(/scroll pinned/)).toBeVisible({ timeout: 3_000 })
  })
})
