import { describe, it, expect } from 'vitest'
import { ITEMS, ITEM_IDS, getItem } from '../../../server/game/items/registry'
import type { ItemDef } from '../../../shared/types/items'

// ── Tests ──────────────────────────────────────────────────────────

describe('Item Registry', () => {
  describe('ITEMS', () => {
    it('contains starter items', () => {
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
      for (const id of starterIds) {
        expect(ITEMS[id]).toBeDefined()
      }
    })

    it('contains attack items', () => {
      const attackIds = [
        'desolator',
        'crystalys',
        'daedalus',
        'maelstrom',
        'monkey_king_bar',
        'divine_rapier',
        'silver_edge',
        'skull_basher',
        'null_pointer',
        'segfault_blade',
      ]
      for (const id of attackIds) {
        expect(ITEMS[id]).toBeDefined()
      }
    })

    it('contains magic items', () => {
      const magicIds = [
        'mystical_staff',
        'veil_of_discord',
        'shivas_guard',
        'aether_lens',
        'dagon',
        'ethereal_blade',
        'stack_overflow',
      ]
      for (const id of magicIds) {
        expect(ITEMS[id]).toBeDefined()
      }
    })

    it('contains defensive items', () => {
      const defensiveIds = [
        'vanguard',
        'linkens_sphere',
        'black_king_bar',
        'heart_of_tarrasque',
        'assault_cuirass',
        'lotus_orb',
        'blade_mail',
        'garbage_collector',
        'firewall_item',
      ]
      for (const id of defensiveIds) {
        expect(ITEMS[id]).toBeDefined()
      }
    })

    it('contains utility items', () => {
      const utilityIds = [
        'blink_module',
        'force_staff',
        'hurricane_pike',
        'scythe_of_vyse',
        'euls_scepter',
        'refresher_orb',
        'ghost_scepter',
      ]
      for (const id of utilityIds) {
        expect(ITEMS[id]).toBeDefined()
      }
    })

    it('contains consumable items', () => {
      const consumableIds = [
        'observer_ward',
        'smoke_of_deceit',
        'dust_of_appearance',
        'town_portal_scroll',
      ]
      for (const id of consumableIds) {
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

    it('contains at least 40 items', () => {
      expect(ITEM_IDS.length).toBeGreaterThanOrEqual(40)
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

    it('dust_of_appearance is consumable', () => {
      const item = getItem('dust_of_appearance')!
      expect(item.consumable).toBe(true)
      expect(item.maxStacks).toBe(2)
    })

    it('town_portal_scroll is consumable', () => {
      const item = getItem('town_portal_scroll')!
      expect(item.consumable).toBe(true)
      expect(item.maxStacks).toBe(3)
    })

    it('non-consumable items do not have maxStacks', () => {
      const nonConsumable = ['boots_of_speed', 'null_pointer', 'daedalus', 'heart_of_tarrasque']
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

    it('null_pointer has a passive ability (crit)', () => {
      const item = getItem('null_pointer')!
      expect(item.passive).toBeDefined()
      expect(item.passive!.id).toBe('null_pointer_passive')
    })

    it('crystalys has a passive crit ability', () => {
      const item = getItem('crystalys')!
      expect(item.passive).toBeDefined()
      expect(item.passive!.name).toBe('Critical Strike')
    })

    it('daedalus has a stronger passive crit', () => {
      const item = getItem('daedalus')!
      expect(item.passive).toBeDefined()
      expect(item.passive!.id).toBe('daedalus_passive')
    })

    it('desolator has armor reduction passive', () => {
      const item = getItem('desolator')!
      expect(item.passive).toBeDefined()
      expect(item.passive!.name).toBe('Corruption')
    })

    it('vanguard has damage block passive', () => {
      const item = getItem('vanguard')!
      expect(item.passive).toBeDefined()
      expect(item.passive!.name).toBe('Damage Block')
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

    it('dagon has an active damage ability', () => {
      const item = getItem('dagon')!
      expect(item.active).toBeDefined()
      expect(item.active!.name).toBe('Energy Burst')
    })

    it('black_king_bar has magic immunity active', () => {
      const item = getItem('black_king_bar')!
      expect(item.active).toBeDefined()
      expect(item.active!.name).toBe('Avatar')
    })

    it('scythe_of_vyse has hex active', () => {
      const item = getItem('scythe_of_vyse')!
      expect(item.active).toBeDefined()
      expect(item.active!.name).toBe('Hex')
    })

    it('refresher_orb resets cooldowns', () => {
      const item = getItem('refresher_orb')!
      expect(item.active).toBeDefined()
      expect(item.active!.name).toBe('Reset Cooldowns')
      expect(item.active!.cooldownTicks).toBe(40)
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

    it('divine_rapier provides massive attack', () => {
      const item = getItem('divine_rapier')!
      expect(item.stats.attack).toBe(100)
    })

    it('segfault_blade provides high attack', () => {
      const item = getItem('segfault_blade')!
      expect(item.stats.attack).toBe(60)
    })

    it('daedalus provides very high attack', () => {
      const item = getItem('daedalus')!
      expect(item.stats.attack).toBe(65)
    })

    it('heart_of_tarrasque provides massive HP', () => {
      const item = getItem('heart_of_tarrasque')!
      expect(item.stats.hp).toBe(500)
    })

    it('assault_cuirass provides armor and HP', () => {
      const item = getItem('assault_cuirass')!
      expect(item.stats.defense).toBe(15)
      expect(item.stats.hp).toBe(200)
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

    it('ring_of_health provides HP', () => {
      const item = getItem('ring_of_health')!
      expect(item.stats.hp).toBe(100)
    })

    it('mystical_staff provides MP and magic resist', () => {
      const item = getItem('mystical_staff')!
      expect(item.stats.mp).toBe(200)
      expect(item.stats.magicResist).toBe(10)
    })
  })

  describe('item cost ordering', () => {
    it('starter items cost less than core items', () => {
      const starterCosts = ['healing_salve', 'mana_vial', 'iron_branch'].map(
        (id) => getItem(id)!.cost,
      )
      const coreCosts = ['blink_module', 'daedalus', 'heart_of_tarrasque'].map(
        (id) => getItem(id)!.cost,
      )

      const maxStarter = Math.max(...starterCosts)
      const minCore = Math.min(...coreCosts)

      expect(maxStarter).toBeLessThan(minCore)
    })

    it('divine_rapier is the most expensive item', () => {
      const rapier = getItem('divine_rapier')!
      for (const item of Object.values(ITEMS)) {
        expect(rapier.cost).toBeGreaterThanOrEqual(item.cost)
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

    it('legendary items cost over 4500 gold', () => {
      const legendaryItems = ['divine_rapier', 'daedalus', 'scythe_of_vyse', 'heart_of_tarrasque', 'assault_cuirass', 'shivas_guard', 'silver_edge', 'segfault_blade']
      for (const id of legendaryItems) {
        const item = getItem(id)!
        expect(item.cost).toBeGreaterThanOrEqual(4500)
      }
    })
  })

  describe('ItemDef type conformance', () => {
    it('all items conform to ItemDef interface', () => {
      for (const item of Object.values(ITEMS)) {
        const def: ItemDef = item
        expect(def.id).toBeDefined()
        expect(def.name).toBeDefined()
        expect(def.cost).toBeDefined()
        expect(def.stats).toBeDefined()
        expect(typeof def.consumable).toBe('boolean')
      }
    })
  })
})