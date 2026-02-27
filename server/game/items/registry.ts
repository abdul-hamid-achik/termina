import type { ItemDef } from '~~/shared/types/items'

// ── Starter Items ─────────────────────────────────────────────────

const healingSalve: ItemDef = {
  id: 'healing_salve',
  name: 'Healing Salve',
  cost: 150,
  stats: {},
  consumable: true,
  maxStacks: 3,
  active: {
    id: 'healing_salve_active',
    name: 'Heal',
    description: 'Restore 200 HP over 4 ticks.',
    cooldownTicks: 0,
  },
}

const manaVial: ItemDef = {
  id: 'mana_vial',
  name: 'Mana Vial',
  cost: 100,
  stats: {},
  consumable: true,
  maxStacks: 3,
  active: {
    id: 'mana_vial_active',
    name: 'Restore Mana',
    description: 'Instantly restore 150 MP.',
    cooldownTicks: 0,
  },
}

const ironBranch: ItemDef = {
  id: 'iron_branch',
  name: 'Iron Branch',
  cost: 50,
  stats: {
    hp: 30,
    mp: 30,
    attack: 3,
    defense: 3,
    magicResist: 3,
  },
  consumable: false,
}

// ── Core Items ────────────────────────────────────────────────────

const bootsOfSpeed: ItemDef = {
  id: 'boots_of_speed',
  name: 'Boots of Speed',
  cost: 500,
  stats: { moveSpeed: 1 },
  consumable: false,
}

const blinkModule: ItemDef = {
  id: 'blink_module',
  name: 'Blink Module',
  cost: 2150,
  stats: { attack: 10 },
  consumable: false,
  active: {
    id: 'blink_module_active',
    name: 'Blink',
    description: 'Teleport to an adjacent zone instantly.',
    cooldownTicks: 12,
  },
}

const nullPointer: ItemDef = {
  id: 'null_pointer',
  name: 'Null Pointer',
  cost: 1400,
  stats: { attack: 25 },
  consumable: false,
  passive: {
    id: 'null_pointer_passive',
    name: 'Critical Strike',
    description: '15% chance to deal double damage on attack.',
  },
}

const garbageCollector: ItemDef = {
  id: 'garbage_collector',
  name: 'Garbage Collector',
  cost: 1800,
  stats: { hp: 200 },
  consumable: false,
  passive: {
    id: 'garbage_collector_passive',
    name: 'Recovery',
    description: 'Regenerate 5% max HP per tick when out of combat (no damage for 3 ticks).',
  },
}

const stackOverflow: ItemDef = {
  id: 'stack_overflow',
  name: 'Stack Overflow',
  cost: 3200,
  stats: { attack: 40, mp: 150 },
  consumable: false,
  active: {
    id: 'stack_overflow_active',
    name: 'Overclock',
    description: 'Next ability deals 2x damage.',
    cooldownTicks: 20,
  },
}

const segfaultBlade: ItemDef = {
  id: 'segfault_blade',
  name: 'Segfault Blade',
  cost: 5500,
  stats: { attack: 60 },
  consumable: false,
  passive: {
    id: 'segfault_blade_passive',
    name: 'Segmentation Fault',
    description: 'Hero kills reset all ability cooldowns.',
  },
}

const firewallItem: ItemDef = {
  id: 'firewall_item',
  name: 'Firewall',
  cost: 2800,
  stats: { hp: 300, defense: 10 },
  consumable: false,
  active: {
    id: 'firewall_item_active',
    name: 'Block',
    description: 'Block the next incoming ability.',
    cooldownTicks: 30,
  },
}

// ── Consumables ───────────────────────────────────────────────────

const observerWard: ItemDef = {
  id: 'observer_ward',
  name: 'Observer Ward',
  cost: 75,
  stats: {},
  consumable: true,
  maxStacks: 4,
  active: {
    id: 'observer_ward_active',
    name: 'Place Ward',
    description: 'Place in a zone for vision lasting 45 ticks. Max 3 active per team.',
    cooldownTicks: 0,
  },
}

const smokeOfDeceit: ItemDef = {
  id: 'smoke_of_deceit',
  name: 'Smoke of Deceit',
  cost: 50,
  stats: {},
  consumable: true,
  maxStacks: 3,
  active: {
    id: 'smoke_of_deceit_active',
    name: 'Smoke',
    description:
      'Team becomes invisible to enemy wards for 3 ticks. Breaks on entering enemy zone with heroes.',
    cooldownTicks: 0,
  },
}

// ── Registry ──────────────────────────────────────────────────────

export const ITEMS: Record<string, ItemDef> = {
  healing_salve: healingSalve,
  mana_vial: manaVial,
  iron_branch: ironBranch,
  boots_of_speed: bootsOfSpeed,
  blink_module: blinkModule,
  null_pointer: nullPointer,
  garbage_collector: garbageCollector,
  stack_overflow: stackOverflow,
  segfault_blade: segfaultBlade,
  firewall_item: firewallItem,
  observer_ward: observerWard,
  smoke_of_deceit: smokeOfDeceit,
}

export const ITEM_IDS = Object.keys(ITEMS)

export function getItem(id: string): ItemDef | undefined {
  return ITEMS[id]
}
