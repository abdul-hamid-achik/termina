import { describe, it, expect } from 'vitest'
import {
  formatStats,
  aggregateStats,
  totalCost,
  activeCooldownSeconds,
  byCostAscending,
  browseSections,
  STAT_LABELS,
} from '~~/shared/itemFormat'
import { ITEMS, ITEM_IDS, ITEM_CATEGORIES } from '~~/shared/constants/items'
import type { ItemDef } from '~~/shared/types/items'

const item = (over: Partial<ItemDef>): ItemDef => ({
  id: 'x',
  name: 'X',
  cost: 0,
  stats: {},
  consumable: false,
  ...over,
})

describe('formatStats', () => {
  it('humanizes stat keys and prefixes a +', () => {
    expect(formatStats({ hp: 250, defense: 5 })).toEqual(['+250 HP', '+5 Defense'])
    expect(formatStats({ magicResist: 15 })).toEqual(['+15 Magic Resist'])
  })
  it('keeps a stable stat order regardless of input order', () => {
    expect(formatStats({ defense: 5, hp: 100, attack: 10 })).toEqual([
      '+100 HP',
      '+10 Attack',
      '+5 Defense',
    ])
  })
  it('skips zero / missing stats and returns [] when statless', () => {
    expect(formatStats({ hp: 0, attack: 12 })).toEqual(['+12 Attack'])
    expect(formatStats({})).toEqual([])
  })
})

describe('aggregateStats', () => {
  it('sums stat blocks across items', () => {
    const total = aggregateStats([
      item({ stats: { hp: 100, attack: 10 } }),
      item({ stats: { hp: 250, defense: 5 } }),
    ])
    expect(total).toEqual({ hp: 350, attack: 10, defense: 5 })
  })
  it('is empty for no items', () => {
    expect(aggregateStats([])).toEqual({})
  })
})

describe('totalCost', () => {
  it('adds up item costs', () => {
    expect(totalCost([item({ cost: 150 }), item({ cost: 3500 }), item({ cost: 50 })])).toBe(3700)
  })
  it('is zero for an empty loadout', () => {
    expect(totalCost([])).toBe(0)
  })
})

describe('activeCooldownSeconds', () => {
  it('converts cooldown ticks to seconds at the 4s tick', () => {
    expect(
      activeCooldownSeconds({ id: 'a', name: 'A', description: '', cooldownTicks: 18 }, 4000),
    ).toBe(72)
    expect(
      activeCooldownSeconds({ id: 'a', name: 'A', description: '', cooldownTicks: 0 }, 4000),
    ).toBe(0)
  })
})

describe('byCostAscending', () => {
  it('orders by cost then name without mutating the input', () => {
    const input = [item({ id: 'b', name: 'B', cost: 500 }), item({ id: 'a', name: 'A', cost: 50 })]
    const sorted = byCostAscending(input)
    expect(sorted.map((i) => i.id)).toEqual(['a', 'b'])
    expect(input.map((i) => i.id)).toEqual(['b', 'a']) // original untouched
  })
  it('breaks cost ties by name', () => {
    const sorted = byCostAscending([
      item({ id: 'z', name: 'Zeta', cost: 100 }),
      item({ id: 'a', name: 'Alpha', cost: 100 }),
    ])
    expect(sorted.map((i) => i.id)).toEqual(['a', 'z'])
  })
})

describe('browseSections', () => {
  const cats = ITEM_CATEGORIES
  it("returns every category when filter is 'all' and no search", () => {
    const sections = browseSections(cats, ITEMS, 'all', '')
    expect(sections).toHaveLength(cats.length)
    // each section's items are cost-ascending
    for (const s of sections) {
      const costs = s.items.map((i) => i.cost)
      expect(costs).toEqual([...costs].sort((a, b) => a - b))
    }
  })
  it('narrows to a single section when a category is selected', () => {
    const sections = browseSections(cats, ITEMS, 'attack', '')
    expect(sections).toHaveLength(1)
    expect(sections[0]!.id).toBe('attack')
  })
  it('filters items by a case-insensitive name search across categories', () => {
    const sections = browseSections(cats, ITEMS, 'all', 'WARD')
    const ids = sections.flatMap((s) => s.items.map((i) => i.id))
    expect(ids).toContain('observer_ward')
    expect(ids).toContain('sentry_ward')
    expect(ids).not.toContain('dagon')
  })
  it('drops sections left empty by the search and returns [] on no match', () => {
    expect(browseSections(cats, ITEMS, 'all', 'zzzznotanitem')).toEqual([])
  })
  it('ignores surrounding whitespace in the search', () => {
    const a = browseSections(cats, ITEMS, 'all', '  dagon  ')
    expect(a.flatMap((s) => s.items.map((i) => i.id))).toContain('dagon')
  })
})

describe('STAT_LABELS', () => {
  it('has a label for every ItemStats key', () => {
    expect(Object.keys(STAT_LABELS).sort()).toEqual(
      ['attack', 'defense', 'hp', 'magicResist', 'moveSpeed', 'mp'].sort(),
    )
  })
})

// Structural guard: ITEM_CATEGORIES must partition the ITEMS registry exactly —
// adding an item without categorizing it (or a typo'd id) fails the build.
describe('ITEM_CATEGORIES (structural integrity)', () => {
  const categorized = ITEM_CATEGORIES.flatMap((c) => c.ids)

  it('references only real item ids', () => {
    const unknown = categorized.filter((id) => !(id in ITEMS))
    expect(unknown).toEqual([])
  })

  it('covers every item in the registry', () => {
    const missing = ITEM_IDS.filter((id) => !categorized.includes(id))
    expect(missing).toEqual([])
  })

  it('puts each item in exactly one category (no duplicates)', () => {
    const dupes = categorized.filter((id, i) => categorized.indexOf(id) !== i)
    expect(dupes).toEqual([])
    expect(categorized.length).toBe(ITEM_IDS.length)
  })

  it('gives every category a label and a teaching blurb', () => {
    for (const c of ITEM_CATEGORIES) {
      expect(c.label.length).toBeGreaterThan(0)
      expect(c.blurb.length).toBeGreaterThan(0)
      expect(c.ids.length).toBeGreaterThan(0)
    }
  })
})
