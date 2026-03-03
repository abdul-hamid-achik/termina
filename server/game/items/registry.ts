import type { ItemDef } from '~~/shared/types/items'

// ── Starter Items (cost <= 500) ─────────────────────────────────────

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

const powerTreads: ItemDef = {
  id: 'power_treads',
  name: 'Power Treads',
  cost: 500,
  stats: { attack: 10, moveSpeed: 1 },
  consumable: false,
  active: {
    id: 'power_treads_active',
    name: 'Toggle',
    description: 'Switch between +15 attack, +150 HP, or +100 MP.',
    cooldownTicks: 0,
  },
}

const ringOfHealth: ItemDef = {
  id: 'ring_of_health',
  name: 'Ring of Health',
  cost: 450,
  stats: { hp: 100 },
  consumable: false,
  passive: {
    id: 'ring_of_health_passive',
    name: 'Regeneration',
    description: 'Restore 2% max HP per tick.',
  },
}

const sobiMask: ItemDef = {
  id: 'sobi_mask',
  name: "Sobi's Mask",
  cost: 325,
  stats: { mp: 75 },
  consumable: false,
  passive: {
    id: 'sobi_mask_passive',
    name: 'Mana Regen',
    description: 'Restore 2% max MP per tick.',
  },
}

const bladesOfAttack: ItemDef = {
  id: 'blades_of_attack',
  name: 'Blades of Attack',
  cost: 430,
  stats: { attack: 12 },
  consumable: false,
}

const chainmail: ItemDef = {
  id: 'chainmail',
  name: 'Chainmail',
  cost: 550,
  stats: { defense: 5 },
  consumable: false,
}

const cloak: ItemDef = {
  id: 'cloak',
  name: 'Cloak',
  cost: 550,
  stats: { magicResist: 15 },
  consumable: false,
}

// ── Attack Items ────────────────────────────────────────────────────

const desolator: ItemDef = {
  id: 'desolator',
  name: 'Desolator',
  cost: 3500,
  stats: { attack: 50 },
  consumable: false,
  passive: {
    id: 'desolator_passive',
    name: 'Corruption',
    description: 'Attacks reduce target defense by 5 for 3 ticks.',
  },
}

const crystalys: ItemDef = {
  id: 'crystalys',
  name: 'Crystalys',
  cost: 1950,
  stats: { attack: 30 },
  consumable: false,
  passive: {
    id: 'crystalys_passive',
    name: 'Critical Strike',
    description: '20% chance to deal 1.75x damage on attack.',
  },
}

const daedalus: ItemDef = {
  id: 'daedalus',
  name: 'Daedalus',
  cost: 5300,
  stats: { attack: 65 },
  consumable: false,
  passive: {
    id: 'daedalus_passive',
    name: 'Critical Strike',
    description: '30% chance to deal 2.4x damage on attack.',
  },
}

const maelstrom: ItemDef = {
  id: 'maelstrom',
  name: 'Maelstrom',
  cost: 2700,
  stats: { attack: 30, mp: 50 },
  consumable: false,
  passive: {
    id: 'maelstrom_passive',
    name: 'Chain Lightning',
    description: '25% chance on attack to deal 60 magical damage to target and 1 nearby enemy.',
  },
}

const monkeyKingBar: ItemDef = {
  id: 'monkey_king_bar',
  name: 'Monkey King Bar',
  cost: 4000,
  stats: { attack: 45 },
  consumable: false,
  passive: {
    id: 'monkey_king_bar_passive',
    name: 'True Strike',
    description: 'Attacks cannot miss and deal bonus 50 magical damage.',
  },
}

const divineRapier: ItemDef = {
  id: 'divine_rapier',
  name: 'Divine Rapier',
  cost: 6000,
  stats: { attack: 100 },
  consumable: false,
  passive: {
    id: 'divine_rapier_passive',
    name: 'Divine Damage',
    description: 'Drops on death. Cannot be sold.',
  },
}

const silverEdge: ItemDef = {
  id: 'silver_edge',
  name: 'Silver Edge',
  cost: 4700,
  stats: { attack: 40, moveSpeed: 1 },
  consumable: false,
  active: {
    id: 'silver_edge_active',
    name: 'Shadow Walk',
    description: 'Become invisible for 3 ticks. Next attack from invis deals 150 bonus damage.',
    cooldownTicks: 18,
  },
}

const skullBasher: ItemDef = {
  id: 'skull_basher',
  name: 'Skull Basher',
  cost: 2950,
  stats: { attack: 30, hp: 100 },
  consumable: false,
  passive: {
    id: 'skull_basher_passive',
    name: 'Bash',
    description: '25% chance on attack to stun target for 1 tick.',
  },
}

// ── Magic Items ─────────────────────────────────────────────────────

const mysticalStaff: ItemDef = {
  id: 'mystical_staff',
  name: 'Mystical Staff',
  cost: 2700,
  stats: { mp: 200, magicResist: 10 },
  consumable: false,
  passive: {
    id: 'mystical_staff_passive',
    name: 'Arcane Power',
    description: 'Increase all magical damage dealt by 15%.',
  },
}

const veilOfDiscord: ItemDef = {
  id: 'veil_of_discord',
  name: 'Veil of Discord',
  cost: 2500,
  stats: { mp: 150, magicResist: 10 },
  consumable: false,
  active: {
    id: 'veil_of_discord_active',
    name: 'Discord',
    description: 'Enemies in zone take 25% more magical damage for 4 ticks.',
    cooldownTicks: 15,
  },
}

const shivasGuard: ItemDef = {
  id: 'shivas_guard',
  name: "Shiva's Guard",
  cost: 4700,
  stats: { defense: 15, mp: 150 },
  consumable: false,
  active: {
    id: 'shivas_guard_active',
    name: 'Arctic Blast',
    description: 'Deal 100 magical damage to enemies in zone and slow them for 2 ticks.',
    cooldownTicks: 20,
  },
}

const aetherLens: ItemDef = {
  id: 'aether_lens',
  name: 'Aether Lens',
  cost: 2300,
  stats: { mp: 200, hp: 100 },
  consumable: false,
  passive: {
    id: 'aether_lens_passive',
    name: 'Ethereal',
    description: 'Reduce all ability cooldowns by 1 tick.',
  },
}

const dagon: ItemDef = {
  id: 'dagon',
  name: 'Dagon',
  cost: 2750,
  stats: { mp: 150, attack: 15 },
  consumable: false,
  active: {
    id: 'dagon_active',
    name: 'Energy Burst',
    description: 'Deal 300 magical damage to target hero in same or adjacent zone.',
    cooldownTicks: 18,
  },
}

const etherealBlade: ItemDef = {
  id: 'ethereal_blade',
  name: 'Ethereal Blade',
  cost: 4300,
  stats: { attack: 30, mp: 150 },
  consumable: false,
  active: {
    id: 'ethereal_blade_active',
    name: 'Ether Blast',
    description: 'Target becomes ethereal for 2 ticks (immune to physical, vulnerable to magical +40%).',
    cooldownTicks: 15,
  },
}

// ── Defensive Items ─────────────────────────────────────────────────

const vanguard: ItemDef = {
  id: 'vanguard',
  name: 'Vanguard',
  cost: 2500,
  stats: { hp: 250, defense: 5 },
  consumable: false,
  passive: {
    id: 'vanguard_passive',
    name: 'Damage Block',
    description: 'Block 50 damage from each attack (60% chance).',
  },
}

const linkensSphere: ItemDef = {
  id: 'linkens_sphere',
  name: "Linken's Sphere",
  cost: 4600,
  stats: { hp: 150, mp: 150, defense: 5, magicResist: 10 },
  consumable: false,
  passive: {
    id: 'linkens_sphere_passive',
    name: 'Spellblock',
    description: 'Block one targeted ability every 12 ticks.',
  },
}

const blackKingBar: ItemDef = {
  id: 'black_king_bar',
  name: 'Black King Bar',
  cost: 4050,
  stats: { hp: 200, attack: 15 },
  consumable: false,
  active: {
    id: 'black_king_bar_active',
    name: 'Avatar',
    description: 'Become immune to magical damage and debuffs for 4 ticks.',
    cooldownTicks: 25,
  },
}

const heartOfTarrasque: ItemDef = {
  id: 'heart_of_tarrasque',
  name: 'Heart of Tarrasque',
  cost: 4800,
  stats: { hp: 500 },
  consumable: false,
  passive: {
    id: 'heart_of_tarrasque_passive',
    name: 'Regeneration',
    description: 'Restore 5% max HP per tick when out of combat for 3 ticks.',
  },
}

const assaultCuirass: ItemDef = {
  id: 'assault_cuirass',
  name: 'Assault Cuirass',
  cost: 4700,
  stats: { defense: 15, hp: 200 },
  consumable: false,
  passive: {
    id: 'assault_cuirass_passive',
    name: 'Assault Aura',
    description: 'Allies in zone gain +5 defense. Enemies in zone have -5 defense.',
  },
}

const lotusOrb: ItemDef = {
  id: 'lotus_orb',
  name: 'Lotus Orb',
  cost: 4000,
  stats: { hp: 200, mp: 100, defense: 10 },
  consumable: false,
  active: {
    id: 'lotus_orb_active',
    name: 'Echo Shell',
    description: 'Target reflects the next ability cast on them back to the caster.',
    cooldownTicks: 15,
  },
}

const bladeMail: ItemDef = {
  id: 'blade_mail',
  name: 'Blade Mail',
  cost: 2200,
  stats: { attack: 15, defense: 5, hp: 100 },
  consumable: false,
  active: {
    id: 'blade_mail_active',
    name: 'Blade Mail',
    description: 'Return 100% of damage taken to attackers for 3 ticks.',
    cooldownTicks: 18,
  },
}

// ── Utility Items ───────────────────────────────────────────────────

const forceStaff: ItemDef = {
  id: 'force_staff',
  name: 'Force Staff',
  cost: 2250,
  stats: { mp: 100, hp: 100 },
  consumable: false,
  active: {
    id: 'force_staff_active',
    name: 'Force',
    description: 'Push target hero to an adjacent zone of their current direction.',
    cooldownTicks: 12,
  },
}

const hurricanePike: ItemDef = {
  id: 'hurricane_pike',
  name: 'Hurricane Pike',
  cost: 4500,
  stats: { attack: 20, mp: 150, hp: 150 },
  consumable: false,
  active: {
    id: 'hurricane_pike_active',
    name: 'Hurricane Thrust',
    description: 'Push self 2 zones away from target enemy. Can attack during push.',
    cooldownTicks: 14,
  },
}

const scytheOfVyse: ItemDef = {
  id: 'scythe_of_vyse',
  name: 'Scythe of Vyse',
  cost: 5675,
  stats: { mp: 250, hp: 150, magicResist: 10 },
  consumable: false,
  active: {
    id: 'scythe_of_vyse_active',
    name: 'Hex',
    description: 'Transform target hero into a critter for 2 ticks (cannot attack or cast).',
    cooldownTicks: 20,
  },
}

const eulsScepter: ItemDef = {
  id: 'euls_scepter',
  name: "Eul's Scepter",
  cost: 2750,
  stats: { mp: 150, moveSpeed: 1 },
  consumable: false,
  active: {
    id: 'euls_scepter_active',
    name: 'Cyclone',
    description: 'Target is invulnerable and disabled for 2 ticks.',
    cooldownTicks: 15,
  },
}

const refresherOrb: ItemDef = {
  id: 'refresher_orb',
  name: 'Refresher Orb',
  cost: 5000,
  stats: { hp: 150, mp: 200 },
  consumable: false,
  active: {
    id: 'refresher_orb_active',
    name: 'Reset Cooldowns',
    description: 'Reset all ability cooldowns.',
    cooldownTicks: 40,
  },
}

const ghostScepter: ItemDef = {
  id: 'ghost_scepter',
  name: 'Ghost Scepter',
  cost: 1500,
  stats: { mp: 100 },
  consumable: false,
  active: {
    id: 'ghost_scepter_active',
    name: 'Ghost Form',
    description: 'Become immune to physical damage for 2 ticks. Cannot attack.',
    cooldownTicks: 20,
  },
}

// ── Existing Core Items ─────────────────────────────────────────────

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

// ── Consumables ─────────────────────────────────────────────────────

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

const dustOfAppearance: ItemDef = {
  id: 'dust_of_appearance',
  name: 'Dust of Appearance',
  cost: 80,
  stats: {},
  consumable: true,
  maxStacks: 2,
  active: {
    id: 'dust_of_appearance_active',
    name: 'Reveal',
    description: 'Reveal all invisible enemies in current and adjacent zones for 2 ticks.',
    cooldownTicks: 0,
  },
}

const townPortalScroll: ItemDef = {
  id: 'town_portal_scroll',
  name: 'Town Portal Scroll',
  cost: 50,
  stats: {},
  consumable: true,
  maxStacks: 3,
  active: {
    id: 'town_portal_scroll_active',
    name: 'Teleport',
    description: 'Teleport to friendly fountain after 2 tick channel.',
    cooldownTicks: 0,
  },
}

// ── Registry ────────────────────────────────────────────────────────

export const ITEMS: Record<string, ItemDef> = {
  // Starter
  healing_salve: healingSalve,
  mana_vial: manaVial,
  iron_branch: ironBranch,
  power_treads: powerTreads,
  ring_of_health: ringOfHealth,
  sobi_mask: sobiMask,
  blades_of_attack: bladesOfAttack,
  chainmail: chainmail,
  cloak: cloak,
  boots_of_speed: bootsOfSpeed,

  // Attack
  desolator: desolator,
  crystalys: crystalys,
  daedalus: daedalus,
  maelstrom: maelstrom,
  monkey_king_bar: monkeyKingBar,
  divine_rapier: divineRapier,
  silver_edge: silverEdge,
  skull_basher: skullBasher,
  null_pointer: nullPointer,
  segfault_blade: segfaultBlade,

  // Magic
  mystical_staff: mysticalStaff,
  veil_of_discord: veilOfDiscord,
  shivas_guard: shivasGuard,
  aether_lens: aetherLens,
  dagon: dagon,
  ethereal_blade: etherealBlade,
  stack_overflow: stackOverflow,

  // Defensive
  vanguard: vanguard,
  linkens_sphere: linkensSphere,
  black_king_bar: blackKingBar,
  heart_of_tarrasque: heartOfTarrasque,
  assault_cuirass: assaultCuirass,
  lotus_orb: lotusOrb,
  blade_mail: bladeMail,
  garbage_collector: garbageCollector,
  firewall_item: firewallItem,

  // Utility
  blink_module: blinkModule,
  force_staff: forceStaff,
  hurricane_pike: hurricanePike,
  scythe_of_vyse: scytheOfVyse,
  euls_scepter: eulsScepter,
  refresher_orb: refresherOrb,
  ghost_scepter: ghostScepter,

  // Consumables
  observer_ward: observerWard,
  smoke_of_deceit: smokeOfDeceit,
  dust_of_appearance: dustOfAppearance,
  town_portal_scroll: townPortalScroll,
}

export const ITEM_IDS = Object.keys(ITEMS)

export function getItem(id: string): ItemDef | undefined {
  return ITEMS[id]
}