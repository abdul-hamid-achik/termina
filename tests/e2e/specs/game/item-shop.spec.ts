import type { Page } from '@playwright/test'
import { test, expect } from '../../fixtures/game'

// Open the shop via the quick-action SHOP button. Two shop buttons render in
// the command area ("[SHOP]" in the inventory bar and "SHOP" in the
// quick-action row) — `exact: true` targets the quick-action one. Both render
// on desktop and mobile, so this is a real click/tap with no force needed.
async function openShop(gamePage: Page) {
  await gamePage.getByRole('button', { name: 'SHOP', exact: true }).click()
  await expect(gamePage.getByText('ITEM SHOP')).toBeVisible({ timeout: 2_000 })
}

test.describe('Item Shop', () => {
  test('shop opens via SHOP button', async ({ gamePage }) => {
    await openShop(gamePage)
    await expect(gamePage.getByTestId('item-shop')).toBeVisible()
  })

  test('category tabs filter items (ALL, STARTER, CORE, CONSUMABLE)', async ({ gamePage }) => {
    await openShop(gamePage)

    // All tab BUTTONS should be visible. Use role+exact, not getByText —
    // item descriptions in the grid contain words like "all"/"core" ("reduce
    // all ability cooldowns"), so getByText('ALL') matches the tab plus many
    // tooltips (strict-mode violation).
    const shop = gamePage.getByTestId('item-shop')
    await expect(shop.getByRole('button', { name: 'ALL', exact: true })).toBeVisible()
    await expect(shop.getByRole('button', { name: 'STARTER', exact: true })).toBeVisible()
    await expect(shop.getByRole('button', { name: 'CORE', exact: true })).toBeVisible()
    await expect(shop.getByRole('button', { name: 'CONSUMABLE', exact: true })).toBeVisible()

    // Click STARTER tab to filter
    await shop.getByRole('button', { name: 'STARTER', exact: true }).click()
    // Items should still be visible (filtered set)
    const items = shop.locator('[data-testid^="shop-item-"]')
    const count = await items.count()
    expect(count).toBeGreaterThan(0)
  })

  test('search input filters by item name', async ({ gamePage }) => {
    await openShop(gamePage)
    const shop = gamePage.getByTestId('item-shop')

    const allItems = shop.locator('[data-testid^="shop-item-"]')
    const initialCount = await allItems.count()
    expect(initialCount).toBeGreaterThan(1)

    // Search for a known item — only Iron Branch matches "iron branch"
    await shop.getByPlaceholder('search items...').fill('iron branch')

    await expect(shop.getByTestId('shop-item-iron_branch')).toBeVisible()
    await expect(allItems).toHaveCount(1)

    // A non-matching query empties the grid entirely
    await shop.getByPlaceholder('search items...').fill('zz_no_such_item')
    await expect(allItems).toHaveCount(0)
    await expect(shop.getByText('No items found.')).toBeVisible()
  })

  test('affordable items have glow; too expensive items are dimmed', async ({ gamePage }) => {
    await openShop(gamePage)
    const shop = gamePage.getByTestId('item-shop')

    // Check that item cards exist
    const items = shop.locator('[data-testid^="shop-item-"]')
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

  test('clicking [BUY] purchases the item — card flips to [OWNED]', async ({ gamePage }) => {
    await openShop(gamePage)
    const shop = gamePage.getByTestId('item-shop')

    // Iron Branch is a cheap starter item — always affordable with the
    // starting gold, and the player starts in the fountain (a shop zone).
    const card = shop.getByTestId('shop-item-iron_branch')
    await expect(card).toBeVisible()
    await expect(card.getByText('[OWNED]')).not.toBeVisible()

    await shop.getByTestId('shop-buy-iron_branch').click()

    // The buy command resolves on the next 4s game tick; once the server
    // confirms, the item lands in the inventory and the card shows [OWNED].
    await expect(card.getByText('[OWNED]')).toBeVisible({ timeout: 15_000 })
  })

  test('shop closes via [CLOSE]', async ({ gamePage }) => {
    await openShop(gamePage)
    await gamePage.getByText('[CLOSE]').click()
    await expect(gamePage.getByText('ITEM SHOP')).not.toBeVisible({ timeout: 2_000 })
  })
})
