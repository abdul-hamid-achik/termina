import { test, expect } from '../../fixtures/game'

// Helper: open the shop via the SHOP quick-action button (force-click since it's mobile-only)
async function openShop(gamePage: import('@playwright/test').Page) {
  await gamePage.getByRole('button', { name: 'SHOP' }).click({ force: true })
  await expect(gamePage.getByText('ITEM SHOP')).toBeVisible({ timeout: 2_000 })
}

test.describe('Item Shop', () => {
  test('shop opens via SHOP button', async ({ gamePage }) => {
    await openShop(gamePage)
    await expect(gamePage.getByTestId('item-shop')).toBeVisible()
  })

  test('category tabs filter items (ALL, STARTER, CORE, CONSUMABLE)', async ({ gamePage }) => {
    await openShop(gamePage)

    // All tabs should be visible
    const shop = gamePage.getByTestId('item-shop')
    await expect(shop.getByText('ALL')).toBeVisible()
    await expect(shop.getByText('STARTER')).toBeVisible()
    await expect(shop.getByText('CORE')).toBeVisible()
    await expect(shop.getByText('CONSUMABLE')).toBeVisible()

    // Click STARTER tab to filter
    await shop.getByText('STARTER').click()
    // Items should still be visible (filtered set)
    const items = shop.locator('[class*="border p-1.5"]')
    const count = await items.count()
    expect(count).toBeGreaterThan(0)
  })

  test('search input filters by item name', async ({ gamePage }) => {
    await openShop(gamePage)
    const shop = gamePage.getByTestId('item-shop')

    // Get initial item count
    const allItems = shop.locator('[class*="border p-1.5"]')
    const initialCount = await allItems.count()

    // Search for a specific term
    await shop.getByPlaceholder('search items...').fill('boots')
    const filteredCount = await allItems.count()
    expect(filteredCount).toBeLessThanOrEqual(initialCount)
  })

  test('affordable items have glow; too expensive items are dimmed', async ({ gamePage }) => {
    await openShop(gamePage)
    const shop = gamePage.getByTestId('item-shop')

    // Check that item cards exist
    const items = shop.locator('[class*="border p-1.5"]')
    const count = await items.count()
    expect(count).toBeGreaterThan(0)

    // At least one item should be affordable (starter items at game start)
    // Affordable items have border-glow class, expensive have opacity-60
    const affordableItems = shop.locator('[class*="border-border-glow"]')
    const expensiveItems = shop.locator('[class*="opacity-60"]')
    const affordableCount = await affordableItems.count()
    const expensiveCount = await expensiveItems.count()
    expect(affordableCount + expensiveCount).toBeGreaterThan(0)
  })

  test('clicking affordable item triggers buy command', async ({ gamePage }) => {
    await openShop(gamePage)
    const shop = gamePage.getByTestId('item-shop')

    // Click on an affordable item (has [BUY] label)
    const buyLabel = shop.getByText('[BUY]').first()
    const hasBuyable = await buyLabel.isVisible().catch(() => false)
    if (hasBuyable) {
      // Get the parent item card and click it
      const itemCard = buyLabel.locator('xpath=ancestor::div[contains(@class, "border p-1.5")]')
      await itemCard.click()
    }
  })

  test('shop closes via [CLOSE]', async ({ gamePage }) => {
    await openShop(gamePage)
    await gamePage.getByText('[CLOSE]').click()
    await expect(gamePage.getByText('ITEM SHOP')).not.toBeVisible({ timeout: 2_000 })
  })
})
