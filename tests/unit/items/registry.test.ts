import { describe, it, expect } from 'vitest'
import { ITEMS, ITEM_IDS, getItem, DEFAULT_QUICKBUY_ITEMS } from '~~/shared/constants/items'
import type { ItemDef } from '~~/shared/types/items'

// ── Tests ──────────────────────────────────────────────────────────

describe('Item Registry', () => {
  describe('ITEMS', () => {
    it('contains starter items', () => {
      const starterIds = [
        'trauma_patch',
        'charge_tab',
        'scrap_lot',
        'gait_rig',
        'clot_ring',
        'drip_mask',
        'edge_kit',
        'plate_weave',
        'field_damper',
      ]
      for (const id of starterIds) {
        expect(ITEMS[id]).toBeDefined()
      }
    })

    it('contains attack items', () => {
      const attackIds = [
        'rust_driver',
        'fracture_edge',
        'killshot_coil',
        'arc_coil',
        'truestrike_rig',
        'last_word',
        'ghostwire_edge',
        'concussion_hammer',
        'null_pointer',
        'segfault_blade',
      ]
      for (const id of attackIds) {
        expect(ITEMS[id]).toBeDefined()
      }
    })

    it('contains magic items', () => {
      const magicIds = [
        'amp_stack',
        'discord_routine',
        'cryo_routine',
        'clock_lens',
        'burnout',
        'phase_shim',
        'stack_overflow',
      ]
      for (const id of magicIds) {
        expect(ITEMS[id]).toBeDefined()
      }
    })

    it('contains defensive items', () => {
      const defensiveIds = [
        'bulwark_plate',
        'intercept_shell',
        'hardshell',
        'bulk_lattice',
        'siege_lattice',
        'mirror_shell',
        'spite_plate',
        'garbage_collector',
        'ablative_shell',
      ]
      for (const id of defensiveIds) {
        expect(ITEMS[id]).toBeDefined()
      }
    })

    it('contains utility items', () => {
      const utilityIds = [
        'jump_shunt',
        'shove_splice',
        'kickback_splice',
        'lockout_shunt',
        'stasis_shunt',
        'redline_splice',
        'phase_shunt',
      ]
      for (const id of utilityIds) {
        expect(ITEMS[id]).toBeDefined()
      }
    })

    it('contains consumable items', () => {
      const consumableIds = ['camtap', 'blackout_can', 'tracer_dust', 'recall_token']
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
      const item = getItem('trauma_patch')
      expect(item).toBeDefined()
      expect(item!.id).toBe('trauma_patch')
      expect(item!.name).toBe('Trauma Patch')
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

  describe('DEFAULT_QUICKBUY_ITEMS (new-player starter pins)', () => {
    it('every default pin is a real, affordable early item', () => {
      expect(DEFAULT_QUICKBUY_ITEMS.length).toBeGreaterThan(0)
      for (const id of DEFAULT_QUICKBUY_ITEMS) {
        const item = getItem(id)
        expect(item, `default quick-buy "${id}" must be a real item`).toBeDefined()
        // Starters should be cheap so a new player can actually afford them early.
        expect(item!.cost, `${id} is too expensive for a starter pin`).toBeLessThanOrEqual(500)
      }
    })

    it('has no duplicates', () => {
      expect(new Set(DEFAULT_QUICKBUY_ITEMS).size).toBe(DEFAULT_QUICKBUY_ITEMS.length)
    })
  })

  describe('consumable items', () => {
    it('trauma_patch is consumable with max stacks', () => {
      const item = getItem('trauma_patch')!
      expect(item.consumable).toBe(true)
      expect(item.maxStacks).toBe(3)
    })

    it('charge_tab is consumable with max stacks', () => {
      const item = getItem('charge_tab')!
      expect(item.consumable).toBe(true)
      expect(item.maxStacks).toBe(3)
    })

    it('camtap is consumable with max stacks', () => {
      const item = getItem('camtap')!
      expect(item.consumable).toBe(true)
      expect(item.maxStacks).toBe(4)
    })

    it('blackout_can is consumable', () => {
      const item = getItem('blackout_can')!
      expect(item.consumable).toBe(true)
      expect(item.maxStacks).toBe(3)
    })

    it('tracer_dust is consumable', () => {
      const item = getItem('tracer_dust')!
      expect(item.consumable).toBe(true)
      expect(item.maxStacks).toBe(2)
    })

    it('recall_token is consumable', () => {
      const item = getItem('recall_token')!
      expect(item.consumable).toBe(true)
      expect(item.maxStacks).toBe(3)
    })

    it('non-consumable items do not have maxStacks', () => {
      const nonConsumable = ['null_pointer', 'killshot_coil', 'bulk_lattice']
      for (const id of nonConsumable) {
        const item = getItem(id)!
        expect(item.consumable).toBe(false)
        expect(item.maxStacks).toBeUndefined()
      }
    })
  })

  describe('item abilities', () => {
    it('jump_shunt has an active ability with cooldown', () => {
      const item = getItem('jump_shunt')!
      expect(item.active).toBeDefined()
      expect(item.active!.id).toBe('jump_shunt_active')
      expect(item.active!.cooldownTicks).toBe(12)
    })

    it('null_pointer has a passive ability (crit)', () => {
      const item = getItem('null_pointer')!
      expect(item.passive).toBeDefined()
      expect(item.passive!.id).toBe('null_pointer_passive')
    })

    it('fracture_edge has a passive crit ability', () => {
      const item = getItem('fracture_edge')!
      expect(item.passive).toBeDefined()
      expect(item.passive!.name).toBe('Critical Strike')
    })

    it('killshot_coil has a stronger passive crit', () => {
      const item = getItem('killshot_coil')!
      expect(item.passive).toBeDefined()
      expect(item.passive!.id).toBe('killshot_coil_passive')
    })

    it('rust_driver has armor reduction passive', () => {
      const item = getItem('rust_driver')!
      expect(item.passive).toBeDefined()
      expect(item.passive!.name).toBe('Corruption')
    })

    it('bulwark_plate has damage block passive', () => {
      const item = getItem('bulwark_plate')!
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

    it('ablative_shell has an active ability', () => {
      const item = getItem('ablative_shell')!
      expect(item.active).toBeDefined()
      expect(item.active!.id).toBe('ablative_shell_active')
      expect(item.active!.cooldownTicks).toBe(30)
    })

    it('burnout has an active damage ability', () => {
      const item = getItem('burnout')!
      expect(item.active).toBeDefined()
      expect(item.active!.name).toBe('Energy Burst')
    })

    it('hardshell has magic immunity active', () => {
      const item = getItem('hardshell')!
      expect(item.active).toBeDefined()
      expect(item.active!.name).toBe('Avatar')
    })

    it('lockout_shunt has hex active', () => {
      const item = getItem('lockout_shunt')!
      expect(item.active).toBeDefined()
      expect(item.active!.name).toBe('Hex')
    })

    it('redline_splice resets cooldowns', () => {
      const item = getItem('redline_splice')!
      expect(item.active).toBeDefined()
      expect(item.active!.name).toBe('Reset Cooldowns')
      expect(item.active!.cooldownTicks).toBe(40)
    })

    it('scrap_lot has no active or passive', () => {
      const item = getItem('scrap_lot')!
      expect(item.active).toBeUndefined()
      expect(item.passive).toBeUndefined()
    })
  })

  describe('item stats', () => {
    it('scrap_lot provides all basic stats', () => {
      const item = getItem('scrap_lot')!
      expect(item.stats.integ).toBe(30)
      expect(item.stats.bw).toBe(30)
      expect(item.stats.attack).toBe(3)
      expect(item.stats.plate).toBe(3)
      expect(item.stats.ice).toBe(3)
    })

    it('last_word provides massive attack', () => {
      const item = getItem('last_word')!
      expect(item.stats.attack).toBe(100)
    })

    it('segfault_blade provides high attack', () => {
      const item = getItem('segfault_blade')!
      expect(item.stats.attack).toBe(60)
    })

    it('killshot_coil provides very high attack', () => {
      const item = getItem('killshot_coil')!
      expect(item.stats.attack).toBe(65)
    })

    it('bulk_lattice provides massive INTEG', () => {
      const item = getItem('bulk_lattice')!
      expect(item.stats.integ).toBe(500)
    })

    it('siege_lattice provides armor and INTEG', () => {
      const item = getItem('siege_lattice')!
      expect(item.stats.plate).toBe(15)
      expect(item.stats.integ).toBe(200)
    })

    it('ablative_shell provides hp and plate', () => {
      const item = getItem('ablative_shell')!
      expect(item.stats.integ).toBe(300)
      expect(item.stats.plate).toBe(10)
    })

    it('garbage_collector provides hp', () => {
      const item = getItem('garbage_collector')!
      expect(item.stats.integ).toBe(200)
    })

    it('clot_ring provides INTEG', () => {
      const item = getItem('clot_ring')!
      expect(item.stats.integ).toBe(100)
    })

    it('amp_stack provides BW and ice', () => {
      const item = getItem('amp_stack')!
      expect(item.stats.bw).toBe(200)
      expect(item.stats.ice).toBe(10)
    })
  })

  describe('item cost ordering', () => {
    it('starter items cost less than core items', () => {
      const starterCosts = ['trauma_patch', 'charge_tab', 'scrap_lot'].map(
        (id) => getItem(id)!.cost,
      )
      const coreCosts = ['jump_shunt', 'killshot_coil', 'bulk_lattice'].map(
        (id) => getItem(id)!.cost,
      )

      const maxStarter = Math.max(...starterCosts)
      const minCore = Math.min(...coreCosts)

      expect(maxStarter).toBeLessThan(minCore)
    })

    it('last_word is the most expensive item', () => {
      const rapier = getItem('last_word')!
      for (const item of Object.values(ITEMS)) {
        expect(rapier.cost).toBeGreaterThanOrEqual(item.cost)
      }
    })

    it('scrap_lot is the cheapest non-consumable item', () => {
      const ironBranch = getItem('scrap_lot')!
      for (const item of Object.values(ITEMS)) {
        if (!item.consumable && item.id !== 'scrap_lot') {
          expect(ironBranch.cost).toBeLessThanOrEqual(item.cost)
        }
      }
    })

    it('legendary items cost over 4500 gold', () => {
      const legendaryItems = [
        'last_word',
        'killshot_coil',
        'lockout_shunt',
        'bulk_lattice',
        'siege_lattice',
        'cryo_routine',
        'ghostwire_edge',
        'segfault_blade',
      ]
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

  describe('no dead items', () => {
    it('every non-consumable item grants a functional benefit', () => {
      // A non-consumable item must grant a real stat, an active, or a passive —
      // otherwise it's a gold sink that does nothing. This guard keeps a dead
      // item from slipping into the shop.
      for (const def of Object.values(ITEMS)) {
        if (def.consumable) continue
        const functionalStats = Object.keys(def.stats)
        const functional = functionalStats.length > 0 || !!def.active || !!def.passive
        expect(functional, `${def.id} grants nothing the engine consumes`).toBe(true)
      }
    })
  })

  describe('the naming rule (R1 — the firewall_item law)', () => {
    it('no item name carries an apostrophe, a possessive, or three+ tokens', () => {
      for (const def of Object.values(ITEMS)) {
        expect(def.name, `${def.id} name "${def.name}" has an apostrophe`).not.toMatch(/['’]/)
        const tokens = def.name.split(/\s+/)
        expect(
          tokens.length,
          `${def.id} name "${def.name}" exceeds <QUALIFIER> <NOUN>`,
        ).toBeLessThanOrEqual(2)
      }
    })

    it('every item id is the snake_case of its display name', () => {
      for (const def of Object.values(ITEMS)) {
        const expected = def.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '')
        expect(def.id, `${def.id} is not the snake_case of "${def.name}"`).toBe(expected)
      }
    })
  })
})
