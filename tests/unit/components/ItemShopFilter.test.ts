import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ItemShop from '~~/app/components/game/ItemShop.vue'
import { ITEMS } from '~~/shared/constants/items'

/**
 * Covers ItemShop surfaces the existing test skips: category-tab filtering, the
 * search box, the empty "No items found" state, and the stat/active/passive
 * detail rendering (formatStats + the active-cooldown branch).
 */

import type { ItemCategoryId } from '~~/shared/types/items'
type Category = ItemCategoryId | 'all'

function shopItem(id: string, category: Category) {
  const def = ITEMS[id]!
  return { id, name: def.name, cost: def.cost, def, category }
}

// A mixed catalog spanning every category so tab filtering is observable.
function catalog() {
  return [
    shopItem('scrap_lot', 'street'), // has stats
    shopItem('trauma_patch', 'street'), // active, 0-tick CD
    shopItem('clot_ring', 'street'), // has a passive
    shopItem('ghostwire_edge', 'hardware'), // active with a real cooldown
  ]
}

function mountShop(overrides: Record<string, unknown> = {}) {
  return mount(ItemShop, {
    props: {
      items: catalog(),
      scrip: 10_000,
      ownedItems: [null, null, null, null, null, null],
      pinnedItems: [],
      ...overrides,
    },
  })
}

describe('ItemShop category tabs', () => {
  it('shows every item under the ALL tab by default', () => {
    const w = mountShop()
    expect(w.findAll('[data-testid^="shop-item-"]')).toHaveLength(4)
  })

  it('filters down to a single category when its tab is selected', async () => {
    const w = mountShop()
    const hardwareTab = w.findAll('button').find((b) => b.text() === 'HARDWARE')!
    await hardwareTab.trigger('click')

    const ids = w.findAll('[data-testid^="shop-item-"]').map((el) => el.attributes('data-testid'))
    expect(ids).toContain('shop-item-ghostwire_edge')
    expect(ids).not.toContain('shop-item-clot_ring')
    expect(ids).not.toContain('shop-item-scrap_lot')
    expect(ids).not.toContain('shop-item-trauma_patch')
  })
})

describe('ItemShop search', () => {
  it('narrows the grid to name matches (case-insensitive)', async () => {
    const w = mountShop()
    await w.find('input').setValue('ring')

    const items = w.findAll('[data-testid^="shop-item-"]')
    expect(items).toHaveLength(1)
    expect(items[0]!.attributes('data-testid')).toBe('shop-item-clot_ring')
  })

  it('renders the empty state when nothing matches', async () => {
    const w = mountShop()
    await w.find('input').setValue('zzz-no-such-item')

    expect(w.findAll('[data-testid^="shop-item-"]')).toHaveLength(0)
    expect(w.text()).toContain('No items found.')
  })
})

describe('ItemShop item detail rendering', () => {
  it('lists each non-zero stat as a "+N key" chip', () => {
    const w = mountShop()
    const card = w.find('[data-testid="shop-item-scrap_lot"]')
    expect(card.text()).toContain('+30 integ')
    expect(card.text()).toContain('+3 attack')
  })

  it('shows a passive description for passive items', () => {
    const w = mountShop()
    const card = w.find('[data-testid="shop-item-clot_ring"]')
    expect(card.text()).toContain('Passive:')
    expect(card.text()).toContain('Restore')
  })

  it('shows an active description with the cooldown for active items that have one', () => {
    const w = mountShop()
    const card = w.find('[data-testid="shop-item-ghostwire_edge"]')
    expect(card.text()).toContain('Active:')
    expect(card.text()).toContain('18t CD')
  })

  it('shows an active description without a CD suffix when cooldown is zero', () => {
    const w = mountShop()
    const card = w.find('[data-testid="shop-item-trauma_patch"]')
    expect(card.text()).toContain('Active:')
    expect(card.text()).not.toContain('t CD)')
  })
})
