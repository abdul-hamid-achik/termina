import { test, expect } from '../../fixtures/game'

test.describe('Inventory', () => {
  test('inventory bar shows 6 slots, all empty at game start', async ({ gamePage }) => {
    // InventoryBar renders one touch-target slot per inventory index
    const slots = gamePage.locator('[data-testid^="inventory-slot-"]')
    await expect(slots).toHaveCount(6)
    // At game start, every slot is empty (rendered as "--")
    for (let i = 0; i < 6; i++) {
      await expect(gamePage.getByTestId(`inventory-slot-${i}`)).toContainText('--')
    }
  })

  test('purchased items appear in inventory', async ({ gamePage }) => {
    // Player spawns in the fountain with starting gold, so a buy submitted on
    // tick N resolves on tick N+1.
    const input = gamePage.getByTestId('command-input-field')
    await input.fill('buy iron_branch')
    await input.press('Enter')

    // "Iron Branch" (> 8 chars) renders abbreviated to its initials "IB"
    const slots = gamePage.locator('[data-testid^="inventory-slot-"]')
    await expect(slots.filter({ hasText: 'IB' })).toHaveCount(1, { timeout: 30_000 })
    // Exactly one slot consumed — the other five stay empty
    await expect(slots.filter({ hasText: '--' })).toHaveCount(5)
  })
})
