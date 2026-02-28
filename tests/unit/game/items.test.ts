import { describe, it, expect } from 'vitest'
import { ITEMS, ITEM_IDS, getItem } from '../../../server/game/items/registry'

// ── Tests ──────────────────────────────────────────────────────────

describe('Items Registry', () => {
  describe('registry size', () => {
    it('contains exactly 12 items', () => {
      expect(ITEM_IDS).toHaveLength(12)
      expect(Object.keys(ITEMS)).toHaveLength(12)
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
    const starterIds = ['healing_salve', 'mana_vial', 'iron_branch']
    const coreIds = ['boots_of_speed', 'blink_module', 'null_pointer', 'garbage_collector', 'stack_overflow', 'segfault_blade', 'firewall_item']
    const consumableIds = ['healing_salve', 'mana_vial', 'observer_ward', 'smoke_of_deceit']

    it('starter items cost less than 500g', () => {
      for (const id of starterIds) {
        const item = getItem(id)!
        expect(item.cost).toBeLessThan(500)
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
      const nonConsumable = ITEM_IDS.filter(id => !consumableIds.includes(id))
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
      const itemsWithActive = Object.values(ITEMS).filter(i => i.active)
      expect(itemsWithActive.length).toBeGreaterThan(0)

      for (const item of itemsWithActive) {
        expect(item.active!.id).toBeDefined()
        expect(item.active!.name).toBeDefined()
        expect(item.active!.description).toBeDefined()
        expect(typeof item.active!.cooldownTicks).toBe('number')
      }
    })

    it('items with passive ability have required passive fields', () => {
      const itemsWithPassive = Object.values(ITEMS).filter(i => i.passive)
      expect(itemsWithPassive.length).toBeGreaterThan(0)

      for (const item of itemsWithPassive) {
        expect(item.passive!.id).toBeDefined()
        expect(item.passive!.name).toBeDefined()
        expect(item.passive!.description).toBeDefined()
      }
    })

    it('consumable items with active have zero cooldown', () => {
      const consumablesWithActive = Object.values(ITEMS).filter(i => i.consumable && i.active)
      for (const item of consumablesWithActive) {
        expect(item.active!.cooldownTicks).toBe(0)
      }
    })
  })
})
