import { describe, it, expect } from 'vitest'
import { ITEMS, ITEM_IDS, getItem } from '~~/shared/constants/items'

// ── Tests ──────────────────────────────────────────────────────────

describe('Items Registry', () => {
  describe('registry size', () => {
    it('contains at least 40 items', () => {
      expect(ITEM_IDS.length).toBeGreaterThanOrEqual(40)
      expect(Object.keys(ITEMS).length).toBeGreaterThanOrEqual(40)
    })
  })

  describe('required fields', () => {
    it('every item has id, name, cost, and consumable fields', () => {
      for (const item of Object.values(ITEMS)) {
        expect(item.id).toBeDefined()
        expect(typeof item.id).toBe('string')
        expect(item.name).toBeDefined()
        expect(typeof item.name).toBe('string')
        expect(typeof item.cost).toBe('number')
        expect(typeof item.consumable).toBe('boolean')
      }
    })

    it('every item key matches its id', () => {
      for (const [key, item] of Object.entries(ITEMS)) {
        expect(item.id).toBe(key)
      }
    })
  })

  describe('item categories', () => {
    const starterIds = [
      'healing_salve',
      'mana_vial',
      'iron_branch',
      'power_treads',
      'ring_of_health',
      'sobi_mask',
      'blades_of_attack',
      'chainmail',
      'cloak',
      'boots_of_speed',
    ]
    const coreIds = [
      'desolator',
      'daedalus',
      'heart_of_tarrasque',
      'scythe_of_vyse',
      'divine_rapier',
      'black_king_bar',
      'assault_cuirass',
      'blink_module',
      'null_pointer',
      'garbage_collector',
      'stack_overflow',
      'segfault_blade',
      'firewall_item',
    ]
    const consumableIds = [
      'healing_salve',
      'mana_vial',
      'observer_ward',
      'sentry_ward',
      'smoke_of_deceit',
      'dust_of_appearance',
      'town_portal_scroll',
    ]

    it('starter items cost less than 600g', () => {
      for (const id of starterIds) {
        const item = getItem(id)!
        expect(item.cost).toBeLessThan(600)
      }
    })

    it('core items cost 500g or more', () => {
      for (const id of coreIds) {
        const item = getItem(id)!
        expect(item.cost).toBeGreaterThanOrEqual(500)
      }
    })

    it('consumable items have consumable=true', () => {
      for (const id of consumableIds) {
        const item = getItem(id)!
        expect(item.consumable).toBe(true)
      }
    })

    it('non-consumable items have consumable=false', () => {
      const nonConsumable = ITEM_IDS.filter((id) => !consumableIds.includes(id))
      for (const id of nonConsumable) {
        const item = getItem(id)!
        expect(item.consumable).toBe(false)
      }
    })
  })

  describe('item stats/active/passive definitions', () => {
    it('every item has a stats object', () => {
      for (const item of Object.values(ITEMS)) {
        expect(item.stats).toBeDefined()
        expect(typeof item.stats).toBe('object')
      }
    })

    it('items with active ability have required active fields', () => {
      const itemsWithActive = Object.values(ITEMS).filter((i) => i.active)
      expect(itemsWithActive.length).toBeGreaterThan(0)

      for (const item of itemsWithActive) {
        expect(item.active!.id).toBeDefined()
        expect(item.active!.name).toBeDefined()
        expect(item.active!.description).toBeDefined()
        expect(typeof item.active!.cooldownTicks).toBe('number')
      }
    })

    it('items with passive ability have required passive fields', () => {
      const itemsWithPassive = Object.values(ITEMS).filter((i) => i.passive)
      expect(itemsWithPassive.length).toBeGreaterThan(0)

      for (const item of itemsWithPassive) {
        expect(item.passive!.id).toBeDefined()
        expect(item.passive!.name).toBeDefined()
        expect(item.passive!.description).toBeDefined()
      }
    })

    it('consumable items with active have zero cooldown', () => {
      const consumablesWithActive = Object.values(ITEMS).filter((i) => i.consumable && i.active)
      for (const item of consumablesWithActive) {
        expect(item.active!.cooldownTicks).toBe(0)
      }
    })
  })

  describe('data integrity (no silent typos / broken references)', () => {
    const STAT_KEYS = ['hp', 'mp', 'attack', 'defense', 'magicResist', 'moveSpeed']
    const TARGET_TYPES = ['enemy', 'ally', 'self', 'zone']

    it('stats use only known keys with finite numeric values', () => {
      // A typo'd stat key (e.g. "armour") is silently ignored by the engine + UI.
      const bad: string[] = []
      for (const item of Object.values(ITEMS)) {
        for (const [k, v] of Object.entries(item.stats)) {
          if (!STAT_KEYS.includes(k)) bad.push(`${item.id}: unknown stat "${k}"`)
          else if (typeof v !== 'number' || !Number.isFinite(v)) bad.push(`${item.id}.${k} = ${v}`)
        }
      }
      expect(bad, bad.join('; ')).toEqual([])
    })

    it('costs are non-negative', () => {
      for (const item of Object.values(ITEMS)) {
        expect(item.cost, item.id).toBeGreaterThanOrEqual(0)
      }
    })

    it('active targetType (when set) is a valid kind, and cooldown is non-negative', () => {
      // targetType drives client auto-targeting for `use <item>`; a bad value
      // means an offensive active silently rejects server-side.
      const bad: string[] = []
      for (const item of Object.values(ITEMS)) {
        if (!item.active) continue
        if (item.active.cooldownTicks < 0) bad.push(`${item.id}: negative cooldown`)
        const tt = item.active.targetType
        if (tt !== undefined && !TARGET_TYPES.includes(tt)) {
          bad.push(`${item.id}: bad targetType "${tt}"`)
        }
      }
      expect(bad, bad.join('; ')).toEqual([])
    })

    it('buildsFrom references only real items', () => {
      const bad: string[] = []
      for (const item of Object.values(ITEMS)) {
        for (const comp of item.buildsFrom ?? []) {
          if (!(comp in ITEMS)) bad.push(`${item.id}: buildsFrom unknown "${comp}"`)
        }
      }
      expect(bad, bad.join('; ')).toEqual([])
    })

    it('maxStacks (when set) is at least 1', () => {
      for (const item of Object.values(ITEMS)) {
        if (item.maxStacks !== undefined) {
          expect(item.maxStacks, item.id).toBeGreaterThanOrEqual(1)
        }
      }
    })
  })
})
