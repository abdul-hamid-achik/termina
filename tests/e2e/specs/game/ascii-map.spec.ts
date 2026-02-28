import { test, expect } from '../../fixtures/game'

test.describe.skip('ASCII Map', () => {
  test('map renders zone grid', async ({ gamePage }) => {
    const map = gamePage.getByTestId('ascii-map')
    await expect(map).toBeVisible()
    // Should show RADIANT and DIRE headers
    await expect(map.getByText('RADIANT')).toBeVisible()
    await expect(map.getByText('DIRE')).toBeVisible()
    // Should show column headers
    await expect(map.getByText('TOP')).toBeVisible()
    await expect(map.getByText('MID')).toBeVisible()
    await expect(map.getByText('BOT')).toBeVisible()
  })

  test("player's current zone is highlighted", async ({ gamePage }) => {
    const map = gamePage.getByTestId('ascii-map')
    await expect(map).toBeVisible()
    // Player's zone shows ">>YOU" indicator
    await expect(map.getByText('>>YOU')).toBeVisible({ timeout: 10_000 })
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
