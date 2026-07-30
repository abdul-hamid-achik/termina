import type { ItemDef, ItemCategory } from '~~/shared/types/items'

// ── THE NAMING RULE (every item id/name obeys it) ───────────────────
// 1. Vocabulary comes from computing, telecoms or street cargo — the
//    register already set by null_pointer / stack_overflow / segfault_blade /
//    garbage_collector. No fantasy bestiary, no Dota names.
// 2. Two tokens maximum: <QUALIFIER> <NOUN>. The id is the snake_case of the
//    display name. No possessives, no apostrophes, no proper nouns.
// 3. The NOUN comes from the category's object set:
//      chrome:   plate / weave / lattice / shell / mesh
//      hardware: edge / driver / hammer / coil / rig
//      deck:     routine / program / lens / stack / shim
//      wetware:  shunt / splice / reflex / patch
//      street:   patch / tab / can / token / kit
// 4. The QUALIFIER names the effect in fiction.
// 5. HARD CONSTRAINT — no item id may contain any of the 18 hero ids as a
//    whole token (this is why `firewall_item` existed; R1-20 deletes it).
// 6. null_pointer, stack_overflow, segfault_blade and garbage_collector keep
//    their ids — they were already on-register before the rule existed.
//
// The five classes:
//   STREET   = consumables and cheap fence goods (opening buys, wards, cans)
//   CHROME   = implanted survivability — HP/defense/resist, mitigation
//   HARDWARE = carried weapons and attachments — attack-stat, on-attack procs
//   DECK     = software — magical damage, spell amp, cooldown manipulation
//   WETWARE  = neural and reflex — mobility, control, disables, tempo

// ── Street (cost <= 500 + consumables) ──────────────────────────────

const healingSalve: ItemDef = {
  id: 'trauma_patch',
  name: 'Trauma Patch',
  cost: 150,
  stats: {},
  consumable: true,
  maxStacks: 3,
  active: {
    id: 'trauma_patch_active',
    name: 'Heal',
    description: 'Restore 200 HP over 4 cycles.',
    cooldownTicks: 0,
  },
}

const manaVial: ItemDef = {
  id: 'charge_tab',
  name: 'Charge Tab',
  cost: 100,
  stats: {},
  consumable: true,
  maxStacks: 3,
  active: {
    id: 'charge_tab_active',
    name: 'Restore Mana',
    description: 'Instantly restore 150 MP.',
    cooldownTicks: 0,
  },
}

const ironBranch: ItemDef = {
  id: 'scrap_lot',
  name: 'Scrap Lot',
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
  id: 'gait_rig',
  name: 'Gait Rig',
  cost: 500,
  stats: { attack: 10, moveSpeed: 1 },
  consumable: false,
  active: {
    id: 'gait_rig_active',
    name: 'Toggle',
    description: 'Switch between +15 attack, +150 HP, or +100 MP.',
    cooldownTicks: 0,
  },
}

const ringOfHealth: ItemDef = {
  id: 'clot_ring',
  name: 'Clot Ring',
  cost: 450,
  stats: { hp: 100 },
  consumable: false,
  passive: {
    id: 'clot_ring_passive',
    name: 'Regeneration',
    description: 'Restore 2% max HP per cycle.',
  },
}

const sobiMask: ItemDef = {
  id: 'drip_mask',
  name: 'Drip Mask',
  cost: 325,
  stats: { mp: 75 },
  consumable: false,
  passive: {
    id: 'drip_mask_passive',
    name: 'Mana Regen',
    description: 'Restore 2% max MP per cycle.',
  },
}

const bladesOfAttack: ItemDef = {
  id: 'edge_kit',
  name: 'Edge Kit',
  cost: 430,
  stats: { attack: 12 },
  consumable: false,
}

const plate_weave: ItemDef = {
  id: 'plate_weave',
  name: 'Plate Weave',
  cost: 550,
  stats: { defense: 5 },
  consumable: false,
}

const field_damper: ItemDef = {
  id: 'field_damper',
  name: 'Field Damper',
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
    description: "Your attacks ignore 5 of the target's defense.",
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
    description: '25% chance on attack to deal 60 magical damage to a nearby enemy.',
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
    description: 'Become invisible for 3 cycles. Next attack from invis deals 150 bonus damage.',
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
    description: '25% chance on attack to stun target for 1 cycle.',
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
    description: 'Enemies in zone take 25% more magical damage for 4 cycles.',
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
    description: 'Deal 100 magical damage to enemies in zone and slow them for 2 cycles.',
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
    description: 'Reduce all ability cooldowns by 1 cycle.',
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
    targetType: 'enemy',
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
    description:
      'Target becomes ethereal for 2 cycles (immune to physical, vulnerable to magical +40%).',
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
    description: 'Block one targeted ability every 12 cycles.',
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
    description: 'Become immune to magical damage and debuffs for 4 cycles.',
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
    description: 'Restore 5% max HP per cycle when out of combat for 3 cycles.',
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
    description: 'Return 100% of damage taken to attackers for 3 cycles.',
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
    description: 'Push yourself or an ally one zone toward your fountain — a quick disengage.',
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
    description:
      'Push self to an adjacent zone away from a target enemy, gaining +30 attack for 2 cycles.',
    cooldownTicks: 14,
    targetType: 'enemy',
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
    description: 'Transform target hero into a critter for 2 cycles (cannot attack or cast).',
    cooldownTicks: 20,
    targetType: 'enemy',
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
    description: 'Target is invulnerable and disabled for 2 cycles.',
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
    description: 'Become immune to physical damage for 2 cycles. Cannot attack.',
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
    description: '15% chance to deal 1.5x damage on attack.',
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
    description: 'Regenerate 5% max HP per cycle when out of combat (no damage for 3 cycles).',
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

const camtapWard: ItemDef = {
  id: 'camtap',
  name: 'CAMTAP',
  cost: 75,
  stats: {},
  consumable: true,
  maxStacks: 4,
  active: {
    id: 'camtap_active',
    name: 'Place Ward',
    description:
      'Place in a zone for vision lasting 45 cycles. Max 3 wards per team (shared with sentries).',
    cooldownTicks: 0,
    targetType: 'zone',
  },
}

const snifferWard: ItemDef = {
  id: 'sniffer',
  name: 'SNIFFER',
  cost: 75,
  stats: {},
  consumable: true,
  maxStacks: 4,
  active: {
    id: 'sniffer_active',
    name: 'Place SNIFFER',
    description:
      'Reveals invisible units in the area. Lasts 30 cycles. Max 3 wards per team (shared with observers).',
    cooldownTicks: 0,
    targetType: 'zone',
  },
}

const smokeOfDeceit: ItemDef = {
  id: 'blackout_can',
  name: 'Blackout Can',
  cost: 50,
  stats: {},
  consumable: true,
  maxStacks: 3,
  active: {
    id: 'blackout_can_active',
    name: 'Smoke',
    description:
      'Team becomes invisible to enemy wards for 3 cycles. Breaks on entering enemy zone with heroes.',
    cooldownTicks: 0,
  },
}

const dustOfAppearance: ItemDef = {
  id: 'tracer_dust',
  name: 'Tracer Dust',
  cost: 80,
  stats: {},
  consumable: true,
  maxStacks: 2,
  active: {
    id: 'tracer_dust_active',
    name: 'Reveal',
    description: 'Reveal all invisible enemies in current and adjacent zones for 2 cycles.',
    cooldownTicks: 0,
  },
}

const townPortalScroll: ItemDef = {
  id: 'recall_token',
  name: 'Recall Token',
  cost: 50,
  stats: {},
  consumable: true,
  maxStacks: 3,
  active: {
    id: 'recall_token_active',
    name: 'Teleport',
    description: 'Teleport to friendly fountain after 2 cycle channel.',
    cooldownTicks: 0,
  },
}

// ── Registry ────────────────────────────────────────────────────────

export const ITEMS: Record<string, ItemDef> = {
  // Starter
  trauma_patch: healingSalve,
  charge_tab: manaVial,
  scrap_lot: ironBranch,
  gait_rig: powerTreads,
  clot_ring: ringOfHealth,
  drip_mask: sobiMask,
  edge_kit: bladesOfAttack,
  plate_weave: plate_weave,
  field_damper: field_damper,
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
  camtap: camtapWard,
  sniffer: snifferWard,
  blackout_can: smokeOfDeceit,
  tracer_dust: dustOfAppearance,
  recall_token: townPortalScroll,
}

export const ITEM_IDS = Object.keys(ITEMS)

export function getItem(id: string): ItemDef | undefined {
  return ITEMS[id]
}

/**
 * Thematic shop sections for the items reference page (/items), mirroring the
 * curated grouping in the ITEMS registry above. Order is the browse order;
 * ids within a section keep registry order (the page sorts by cost). The set of
 * ids across all categories must exactly equal Object.keys(ITEMS) — enforced by
 * a structural test so adding an item without categorizing it fails the build.
 */
export const ITEM_CATEGORIES: ItemCategory[] = [
  {
    id: 'street',
    label: 'Street',
    blurb:
      'Consumables and cheap fence goods — opening buys, wards, cans and tokens. Restock often.',
    ids: [
      'trauma_patch',
      'charge_tab',
      'scrap_lot',
      'gait_rig',
      'clot_ring',
      'drip_mask',
      'edge_kit',
      'plate_weave',
      'field_damper',
      'boots_of_speed',
      'camtap',
      'sniffer',
      'blackout_can',
      'tracer_dust',
      'recall_token',
    ],
  },
  {
    id: 'hardware',
    label: 'Hardware',
    blurb:
      'Carried weapons and attachments — attack damage, crits and armor shred for right-clickers.',
    ids: [
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
    ],
  },
  {
    id: 'deck',
    label: 'Deck',
    blurb: 'Software — amplify magical damage, manipulate cooldowns, or nuke a target outright.',
    ids: [
      'mystical_staff',
      'veil_of_discord',
      'shivas_guard',
      'aether_lens',
      'dagon',
      'ethereal_blade',
      'stack_overflow',
    ],
  },
  {
    id: 'chrome',
    label: 'Chrome',
    blurb: 'Implanted survivability — health, armor, resist and panic-button mitigation.',
    ids: [
      'vanguard',
      'linkens_sphere',
      'black_king_bar',
      'heart_of_tarrasque',
      'assault_cuirass',
      'lotus_orb',
      'blade_mail',
      'garbage_collector',
      'firewall_item',
    ],
  },
  {
    id: 'wetware',
    label: 'Wetware',
    blurb: 'Neural and reflex — mobility, control, disables and tempo that swing fights.',
    ids: [
      'blink_module',
      'force_staff',
      'hurricane_pike',
      'scythe_of_vyse',
      'euls_scepter',
      'refresher_orb',
      'ghost_scepter',
    ],
  },
]

/**
 * Default Quick-Buy pins for a player who has never customized them — cheap,
 * universally useful early buys so a new player's Quick-Buy bar isn't empty.
 * A recall token (mobility/safety), a salve (lane sustain), an Scrap Lot (cheap
 * all-stats), and Edge Kit (early damage — the tutorial's buy hint).
 */
export const DEFAULT_QUICKBUY_ITEMS: readonly string[] = [
  'recall_token',
  'trauma_patch',
  'scrap_lot',
  'edge_kit',
]
