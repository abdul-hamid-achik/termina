import { test, expect } from '../../fixtures/game'

// Chat assertions scope to log entries (data-testid="log-event") — the
// combat log also mirrors the latest event into an aria-live sr-only region,
// which would otherwise make bare text matches ambiguous (strict mode).
test.describe('Chat', () => {
  test('chat team <message> sends team chat', async ({ gamePage }) => {
    const input = gamePage.getByTestId('command-input-field')
    await input.fill('chat team hello from e2e')
    await input.press('Enter')
    // Message round-trips through the server and lands in the combat log
    // tagged with the channel
    const log = gamePage.getByTestId('combat-log')
    const entry = log.getByTestId('log-event').filter({ hasText: 'hello from e2e' })
    await expect(entry).toBeVisible({ timeout: 10_000 })
    await expect(entry).toContainText('[TEAM]')
  })

  test('chat all <message> sends all chat', async ({ gamePage }) => {
    const input = gamePage.getByTestId('command-input-field')
    await input.fill('chat all global e2e message')
    await input.press('Enter')
    const log = gamePage.getByTestId('combat-log')
    const entry = log.getByTestId('log-event').filter({ hasText: 'global e2e message' })
    await expect(entry).toBeVisible({ timeout: 10_000 })
    await expect(entry).toContainText('[ALL]')
  })
})
