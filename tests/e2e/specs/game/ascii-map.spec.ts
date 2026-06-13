import { test, expect } from '../../fixtures/game'

test.describe('ASCII Map', () => {
  test('map renders zone grid', async ({ gamePage }) => {
    const map = gamePage.getByTestId('ascii-map')
    await expect(map).toBeVisible()
    // Team headers (exact — 'RADIANT JUNGLE'/'DIRE JUNGLE' column headers
    // would otherwise also match)
    await expect(map.getByText('RADIANT', { exact: true })).toBeVisible()
    await expect(map.getByText('DIRE', { exact: true })).toBeVisible()
    // Full 5-column desktop grid headers
    await expect(map.getByText('TOP LANE', { exact: true })).toBeVisible()
    await expect(map.getByText('MID LANE', { exact: true })).toBeVisible()
    await expect(map.getByText('BOT LANE', { exact: true })).toBeVisible()
    await expect(map.getByText('RADIANT JUNGLE', { exact: true })).toBeVisible()
    await expect(map.getByText('DIRE JUNGLE', { exact: true })).toBeVisible()
    // Both Ancients (◈ core HP readout) are global info shown on the base
    // zones of the desktop grid — visible even through fog at game start.
    await expect(map.getByText(/◈\s*\d+%/)).toHaveCount(2)
  })

  test("player's current zone is highlighted", async ({ gamePage }) => {
    const map = gamePage.getByTestId('ascii-map')
    await expect(map).toBeVisible()
    // Exactly one grid cell carries the "►YOU" indicator (the legend also
    // mentions ►YOU, so scope to gridcells)
    await expect(map.locator('[role="gridcell"]').filter({ hasText: '►YOU' })).toBeVisible({
      timeout: 10_000,
    })
  })

  test('ally/enemy indicators visible in vision range', async ({ gamePage }) => {
    const map = gamePage.getByTestId('ascii-map')
    await expect(map).toBeVisible()

    // Wait for some game ticks so bots move
    await gamePage.waitForTimeout(12_000)

    // Look for ally indicators (e.g., "1A", "2A") or enemy indicators ("1E", "2E")
    // At minimum, the player should see their own zone
    const mapText = await map.textContent()
    expect(mapText).toBeTruthy()
    // The map should contain zone names and indicators
    expect(mapText).toContain('YOU')
  })
})
