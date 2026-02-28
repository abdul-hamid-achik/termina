import { describe, it, expect } from 'vitest'
import { ITEMS, ITEM_IDS, getItem } from '../../../server/game/items/registry'
import type { ItemDef } from '../../../shared/types/items'

// ── Tests ──────────────────────────────────────────────────────────

describe('Item Registry', () => {
  describe('ITEMS', () => {
    it('contains all expected items', () => {
      const expectedIds = [
        'healing_salve',
        'mana_vial',
        'iron_branch',
        'boots_of_speed',
        'blink_module',
        'null_pointer',
        'garbage_collector',
        'stack_overflow',
        'segfault_blade',
        'firewall_item',
        'observer_ward',
        'smoke_of_deceit',
      ]
      for (const id of expectedIds) {
        expect(ITEMS[id]).toBeDefined()
      }
    })

    it('has unique item IDs', () => {
      const ids = Object.keys(ITEMS)
      const unique = new Set(ids)
      expect(unique.size).toBe(ids.length)
    })

    it('every item has id matching its key', () => {
      for (const [key, item] of Object.entries(ITEMS)) {
        expect(item.id).toBe(key)
      }
    })

    it('every item has a positive cost', () => {
      for (const item of Object.values(ITEMS)) {
        expect(item.cost).toBeGreaterThan(0)
      }
    })

    it('every item has a name', () => {
      for (const item of Object.values(ITEMS)) {
        expect(item.name.length).toBeGreaterThan(0)
      }
    })

    it('every item has a stats object', () => {
      for (const item of Object.values(ITEMS)) {
        expect(item.stats).toBeDefined()
        expect(typeof item.stats).toBe('object')
      }
    })
  })

  describe('ITEM_IDS', () => {
    it('matches keys of ITEMS', () => {
      expect(ITEM_IDS.sort()).toEqual(Object.keys(ITEMS).sort())
    })

    it('contains exactly the right number of items', () => {
      expect(ITEM_IDS.length).toBe(12)
    })
  })

  describe('getItem', () => {
    it('returns item definition for valid ID', () => {
      const item = getItem('healing_salve')
      expect(item).toBeDefined()
      expect(item!.id).toBe('healing_salve')
      expect(item!.name).toBe('Healing Salve')
    })

    it('returns undefined for unknown item ID', () => {
      expect(getItem('nonexistent_item')).toBeUndefined()
    })

    it('returns undefined for empty string', () => {
      expect(getItem('')).toBeUndefined()
    })

    it('returns correct item for each item ID', () => {
      for (const id of ITEM_IDS) {
        const item = getItem(id)
        expect(item).toBeDefined()
        expect(item!.id).toBe(id)
      }
    })
  })

  describe('consumable items', () => {
    it('healing_salve is consumable with max stacks', () => {
      const item = getItem('healing_salve')!
      expect(item.consumable).toBe(true)
      expect(item.maxStacks).toBe(3)
    })

    it('mana_vial is consumable with max stacks', () => {
      const item = getItem('mana_vial')!
      expect(item.consumable).toBe(true)
      expect(item.maxStacks).toBe(3)
    })

    it('observer_ward is consumable with max stacks', () => {
      const item = getItem('observer_ward')!
      expect(item.consumable).toBe(true)
      expect(item.maxStacks).toBe(4)
    })

    it('smoke_of_deceit is consumable', () => {
      const item = getItem('smoke_of_deceit')!
      expect(item.consumable).toBe(true)
      expect(item.maxStacks).toBe(3)
    })

    it('non-consumable items do not have maxStacks', () => {
      const nonConsumable = ['boots_of_speed', 'null_pointer', 'segfault_blade']
      for (const id of nonConsumable) {
        const item = getItem(id)!
        expect(item.consumable).toBe(false)
        expect(item.maxStacks).toBeUndefined()
      }
    })
  })

  describe('item abilities', () => {
    it('blink_module has an active ability with cooldown', () => {
      const item = getItem('blink_module')!
      expect(item.active).toBeDefined()
      expect(item.active!.id).toBe('blink_module_active')
      expect(item.active!.cooldownTicks).toBe(12)
    })

    it('null_pointer has a passive ability', () => {
      const item = getItem('null_pointer')!
      expect(item.passive).toBeDefined()
      expect(item.passive!.id).toBe('null_pointer_passive')
    })

    it('stack_overflow has an active ability', () => {
      const item = getItem('stack_overflow')!
      expect(item.active).toBeDefined()
      expect(item.active!.id).toBe('stack_overflow_active')
      expect(item.active!.cooldownTicks).toBe(20)
    })

    it('segfault_blade has a passive ability', () => {
      const item = getItem('segfault_blade')!
      expect(item.passive).toBeDefined()
      expect(item.passive!.name).toBe('Segmentation Fault')
    })

    it('firewall_item has an active ability', () => {
      const item = getItem('firewall_item')!
      expect(item.active).toBeDefined()
      expect(item.active!.id).toBe('firewall_item_active')
      expect(item.active!.cooldownTicks).toBe(30)
    })

    it('boots_of_speed has no active or passive', () => {
      const item = getItem('boots_of_speed')!
      expect(item.active).toBeUndefined()
      expect(item.passive).toBeUndefined()
    })

    it('iron_branch has no active or passive', () => {
      const item = getItem('iron_branch')!
      expect(item.active).toBeUndefined()
      expect(item.passive).toBeUndefined()
    })
  })

  describe('item stats', () => {
    it('iron_branch provides all basic stats', () => {
      const item = getItem('iron_branch')!
      expect(item.stats.hp).toBe(30)
      expect(item.stats.mp).toBe(30)
      expect(item.stats.attack).toBe(3)
      expect(item.stats.defense).toBe(3)
      expect(item.stats.magicResist).toBe(3)
    })

    it('boots_of_speed provides moveSpeed', () => {
      const item = getItem('boots_of_speed')!
      expect(item.stats.moveSpeed).toBe(1)
    })

    it('segfault_blade provides high attack', () => {
      const item = getItem('segfault_blade')!
      expect(item.stats.attack).toBe(60)
    })

    it('firewall_item provides hp and defense', () => {
      const item = getItem('firewall_item')!
      expect(item.stats.hp).toBe(300)
      expect(item.stats.defense).toBe(10)
    })

    it('garbage_collector provides hp', () => {
      const item = getItem('garbage_collector')!
      expect(item.stats.hp).toBe(200)
    })
  })

  describe('item cost ordering', () => {
    it('starter items cost less than core items', () => {
      const starterCosts = ['healing_salve', 'mana_vial', 'iron_branch'].map(
        (id) => getItem(id)!.cost,
      )
      const coreCosts = ['blink_module', 'null_pointer', 'stack_overflow'].map(
        (id) => getItem(id)!.cost,
      )

      const maxStarter = Math.max(...starterCosts)
      const minCore = Math.min(...coreCosts)

      expect(maxStarter).toBeLessThan(minCore)
    })

    it('segfault_blade is the most expensive item', () => {
      const segfault = getItem('segfault_blade')!
      for (const item of Object.values(ITEMS)) {
        expect(segfault.cost).toBeGreaterThanOrEqual(item.cost)
      }
    })

    it('iron_branch is the cheapest non-consumable item', () => {
      const ironBranch = getItem('iron_branch')!
      for (const item of Object.values(ITEMS)) {
        if (!item.consumable && item.id !== 'iron_branch') {
          expect(ironBranch.cost).toBeLessThanOrEqual(item.cost)
        }
      }
    })
  })

  describe('ItemDef type conformance', () => {
    it('all items conform to ItemDef interface', () => {
      for (const item of Object.values(ITEMS)) {
        const def: ItemDef = item
        expect(def.id).toBeDefined()
        expect(def.name).toBeDefined()
        expect(typeof def.cost).toBe('number')
        expect(typeof def.consumable).toBe('boolean')
        expect(def.stats).toBeDefined()
      }
    })
  })
})
