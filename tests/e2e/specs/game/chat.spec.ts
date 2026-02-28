import { test, expect } from '../../fixtures/game'

test.describe.skip('Chat', () => {
  test('chat team <message> sends team chat', async ({ gamePage }) => {
    const input = gamePage.getByTestId('command-input-field')
    await input.fill('chat team hello from e2e')
    await input.press('Enter')
    // Message should appear in combat log
    const log = gamePage.getByTestId('combat-log')
    await expect(log.getByText(/hello from e2e/)).toBeVisible({ timeout: 10_000 })
  })

  test('chat all <message> sends all chat', async ({ gamePage }) => {
    const input = gamePage.getByTestId('command-input-field')
    await input.fill('chat all global e2e message')
    await input.press('Enter')
    // Message should appear in combat log
    const log = gamePage.getByTestId('combat-log')
    await expect(log.getByText(/global e2e message/)).toBeVisible({ timeout: 10_000 })
  })
})
