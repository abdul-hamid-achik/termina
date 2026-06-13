import { test, expect } from '../../fixtures/game'

test.describe('ASCII Map', () => {
  // The overhaul demotes the map to a compact rail widget (force-mode=compact):
  // a "you are here" card + tappable adjacent zones + a [SHOW MAP OVERVIEW]
  // toggle for the full 5x10 topology. The wide center is now the combat log.
  test('map renders the compact zone widget', async ({ gamePage }) => {
    const map = gamePage.getByTestId('ascii-map')
    await expect(map).toBeVisible()
    // Team headers (exact — the legend/other copy must not match)
    await expect(map.getByText('RADIANT', { exact: true })).toBeVisible()
    await expect(map.getByText('DIRE', { exact: true })).toBeVisible()
    // Compact widget: current-zone card + collapsible full-map overview toggle
    await expect(map.getByTestId('compact-current-zone')).toBeVisible()
    await expect(map.getByTestId('overview-toggle')).toBeVisible()
  })

  test("player's current-zone card shows ►YOU", async ({ gamePage }) => {
    const map = gamePage.getByTestId('ascii-map')
    await expect(map).toBeVisible()
    await expect(map.getByTestId('compact-current-zone')).toContainText('YOU')
  })

  test('adjacent zones are tappable move targets', async ({ gamePage }) => {
    const map = gamePage.getByTestId('ascii-map')
    await expect(map).toBeVisible()
    await expect(
      map.locator('[data-testid="compact-adjacent-zone"]').first(),
    ).toBeVisible({ timeout: 10_000 })
  })

  test('the full topology overview can be expanded', async ({ gamePage }) => {
    const map = gamePage.getByTestId('ascii-map')
    await expect(map).toBeVisible()
    await map.getByTestId('overview-toggle').click()
    // The mini overview grid appears with both Ancients' core readouts.
    await expect(map.getByTestId('mini-overview')).toBeVisible()
  })
})
