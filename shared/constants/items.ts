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
//    whole token (this is why `ablative_shell` existed; R1-20 deletes it).
// 6. null_pointer, stack_overflow, segfault_blade and garbage_collector keep
//    their ids — they were already on-register before the rule existed.
//
// The five classes:
//   STREET   = consumables and cheap fence goods (opening buys, camtaps, cans)
//   CHROME   = implanted survivability — HP/plate/resist, mitigation
//   HARDWARE = carried weapons and attachments — attack-stat, on-attack procs
//   DECK     = software — code damage, spell amp, cooldown manipulation
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
    plate: 3,
    ice: 3,
  },
  consumable: false,
}

const powerTreads: ItemDef = {
  id: 'gait_rig',
  name: 'Gait Rig',
  cost: 500,
  stats: { attack: 10 },
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
  stats: { plate: 5 },
  consumable: false,
}

const field_damper: ItemDef = {
  id: 'field_damper',
  name: 'Field Damper',
  cost: 550,
  stats: { ice: 15 },
  consumable: false,
}

// ── Attack Items ────────────────────────────────────────────────────

const rust_driver: ItemDef = {
  id: 'rust_driver',
  name: 'Rust Driver',
  cost: 3500,
  stats: { attack: 50 },
  consumable: false,
  passive: {
    id: 'rust_driver_passive',
    name: 'Corruption',
    description: "Your attacks ignore 5 of the target's plate.",
  },
}

const fracture_edge: ItemDef = {
  id: 'fracture_edge',
  name: 'Fracture Edge',
  cost: 1950,
  stats: { attack: 30 },
  consumable: false,
  passive: {
    id: 'fracture_edge_passive',
    name: 'Critical Strike',
    description: '20% chance to deal 1.75x damage on attack.',
  },
}

const killshot_coil: ItemDef = {
  id: 'killshot_coil',
  name: 'Killshot Coil',
  cost: 5300,
  stats: { attack: 65 },
  consumable: false,
  passive: {
    id: 'killshot_coil_passive',
    name: 'Critical Strike',
    description: '30% chance to deal 2.4x damage on attack.',
  },
}

const arc_coil: ItemDef = {
  id: 'arc_coil',
  name: 'Arc Coil',
  cost: 2700,
  stats: { attack: 30, mp: 50 },
  consumable: false,
  passive: {
    id: 'arc_coil_passive',
    name: 'Chain Lightning',
    description: '25% chance on attack to deal 60 code damage to a nearby enemy.',
  },
}

const monkeyKingBar: ItemDef = {
  id: 'truestrike_rig',
  name: 'Truestrike Rig',
  cost: 4000,
  stats: { attack: 45 },
  consumable: false,
  passive: {
    id: 'truestrike_rig_passive',
    name: 'True Strike',
    description: 'Attacks cannot miss and deal bonus 50 code damage.',
  },
}

const divineRapier: ItemDef = {
  id: 'last_word',
  name: 'Last Word',
  cost: 6000,
  stats: { attack: 100 },
  consumable: false,
  passive: {
    id: 'last_word_passive',
    name: 'Divine Damage',
    description: 'Drops on death. Cannot be sold.',
  },
}

const silverEdge: ItemDef = {
  id: 'ghostwire_edge',
  name: 'Ghostwire Edge',
  cost: 4700,
  stats: { attack: 40 },
  consumable: false,
  active: {
    id: 'ghostwire_edge_active',
    name: 'Shadow Walk',
    description: 'Become invisible for 3 cycles. Next attack from invis deals 150 bonus damage.',
    cooldownTicks: 18,
  },
}

const skullBasher: ItemDef = {
  id: 'concussion_hammer',
  name: 'Concussion Hammer',
  cost: 2950,
  stats: { attack: 30, hp: 100 },
  consumable: false,
  passive: {
    id: 'concussion_hammer_passive',
    name: 'Bash',
    description: '25% chance on attack to stun target for 1 cycle.',
  },
}

// ── Magic Items ─────────────────────────────────────────────────────

const mysticalStaff: ItemDef = {
  id: 'amp_stack',
  name: 'Amp Stack',
  cost: 2700,
  stats: { mp: 200, ice: 10 },
  consumable: false,
  passive: {
    id: 'amp_stack_passive',
    name: 'Arcane Power',
    description: 'Increase all code damage dealt by 15%.',
  },
}

const veilOfDiscord: ItemDef = {
  id: 'discord_routine',
  name: 'Discord Routine',
  cost: 2500,
  stats: { mp: 150, ice: 10 },
  consumable: false,
  active: {
    id: 'discord_routine_active',
    name: 'Discord',
    description: 'Enemies in zone take 25% more code damage for 4 cycles.',
    cooldownTicks: 15,
  },
}

const shivasGuard: ItemDef = {
  id: 'cryo_routine',
  name: 'Cryo Routine',
  cost: 4700,
  stats: { plate: 15, mp: 150 },
  consumable: false,
  active: {
    id: 'cryo_routine_active',
    name: 'Arctic Blast',
    description: 'Deal 100 code damage to enemies in zone and slow them for 2 cycles.',
    cooldownTicks: 20,
  },
}

const aetherLens: ItemDef = {
  id: 'clock_lens',
  name: 'Clock Lens',
  cost: 2300,
  stats: { mp: 200, hp: 100 },
  consumable: false,
  passive: {
    id: 'clock_lens_passive',
    name: 'Ethereal',
    description: 'Reduce all ability cooldowns by 1 cycle.',
  },
}

const burnout: ItemDef = {
  id: 'burnout',
  name: 'Burnout',
  cost: 2750,
  stats: { mp: 150, attack: 15 },
  consumable: false,
  active: {
    id: 'dagon_active',
    name: 'Energy Burst',
    description: 'Deal 300 code damage to target hero in same or adjacent zone.',
    cooldownTicks: 18,
    targetType: 'enemy',
  },
}

const etherealBlade: ItemDef = {
  id: 'phase_shim',
  name: 'Phase Shim',
  cost: 4300,
  stats: { attack: 30, mp: 150 },
  consumable: false,
  active: {
    id: 'phase_shim_active',
    name: 'Ether Blast',
    description:
      'Target becomes ethereal for 2 cycles (immune to kinetic, vulnerable to code +40%).',
    cooldownTicks: 15,
  },
}

// ── Defensive Items ─────────────────────────────────────────────────

const bulwark_plate: ItemDef = {
  id: 'bulwark_plate',
  name: 'Bulwark Plate',
  cost: 2500,
  stats: { hp: 250, plate: 5 },
  consumable: false,
  passive: {
    id: 'bulwark_plate_passive',
    name: 'Damage Block',
    description: 'Block 50 damage from each attack (60% chance).',
  },
}

const linkensSphere: ItemDef = {
  id: 'intercept_shell',
  name: 'Intercept Shell',
  cost: 4600,
  stats: { hp: 150, mp: 150, plate: 5, ice: 10 },
  consumable: false,
  passive: {
    id: 'intercept_shell_passive',
    name: 'Spellblock',
    description: 'Block one targeted ability every 12 cycles.',
  },
}

const blackKingBar: ItemDef = {
  id: 'hardshell',
  name: 'Hardshell',
  cost: 4050,
  stats: { hp: 200, attack: 15 },
  consumable: false,
  active: {
    id: 'hardshell_active',
    name: 'Avatar',
    description: 'Gain AIRGAP for 4 cycles — immune to code damage and debuffs.',
    cooldownTicks: 25,
  },
}

const heartOfTarrasque: ItemDef = {
  id: 'bulk_lattice',
  name: 'Bulk Lattice',
  cost: 4800,
  stats: { hp: 500 },
  consumable: false,
  passive: {
    id: 'bulk_lattice_passive',
    name: 'Regeneration',
    description: 'Restore 5% max HP per cycle when out of combat for 3 cycles.',
  },
}

const assaultCuirass: ItemDef = {
  id: 'siege_lattice',
  name: 'Siege Lattice',
  cost: 4700,
  stats: { plate: 15, hp: 200 },
  consumable: false,
  passive: {
    id: 'siege_lattice_passive',
    name: 'Assault Aura',
    description: 'Allies in zone gain +5 plate. Enemies in zone have -5 plate.',
  },
}

const lotusOrb: ItemDef = {
  id: 'mirror_shell',
  name: 'Mirror Shell',
  cost: 4000,
  stats: { hp: 200, mp: 100, plate: 10 },
  consumable: false,
  active: {
    id: 'mirror_shell_active',
    name: 'Echo Shell',
    description: 'Target reflects the next ability cast on them back to the caster.',
    cooldownTicks: 15,
  },
}

const bladeMail: ItemDef = {
  id: 'spite_plate',
  name: 'Spite Plate',
  cost: 2200,
  stats: { attack: 15, plate: 5, hp: 100 },
  consumable: false,
  active: {
    id: 'spite_plate_active',
    name: 'Spite Plate',
    description: 'Return 100% of damage taken to attackers for 3 cycles.',
    cooldownTicks: 18,
  },
}

// ── Utility Items ───────────────────────────────────────────────────

const forceStaff: ItemDef = {
  id: 'shove_splice',
  name: 'Shove Splice',
  cost: 2250,
  stats: { mp: 100, hp: 100 },
  consumable: false,
  active: {
    id: 'shove_splice_active',
    name: 'Force',
    description: 'Push yourself or an ally one zone toward your fountain — a quick disengage.',
    cooldownTicks: 12,
  },
}

const hurricanePike: ItemDef = {
  id: 'kickback_splice',
  name: 'Kickback Splice',
  cost: 4500,
  stats: { attack: 20, mp: 150, hp: 150 },
  consumable: false,
  active: {
    id: 'kickback_splice_active',
    name: 'Hurricane Thrust',
    description:
      'Push self to an adjacent zone away from a target enemy, gaining +30 attack for 2 cycles.',
    cooldownTicks: 14,
    targetType: 'enemy',
  },
}

const scytheOfVyse: ItemDef = {
  id: 'lockout_shunt',
  name: 'Lockout Shunt',
  cost: 5675,
  stats: { mp: 250, hp: 150, ice: 10 },
  consumable: false,
  active: {
    id: 'lockout_shunt_active',
    name: 'Hex',
    description: 'Transform target hero into a critter for 2 cycles (cannot attack or cast).',
    cooldownTicks: 20,
    targetType: 'enemy',
  },
}

const eulsScepter: ItemDef = {
  id: 'stasis_shunt',
  name: 'Stasis Shunt',
  cost: 2750,
  stats: { mp: 150 },
  consumable: false,
  active: {
    id: 'stasis_shunt_active',
    name: 'Cyclone',
    description: 'Target is invulnerable and disabled for 2 cycles.',
    cooldownTicks: 15,
  },
}

const refresherOrb: ItemDef = {
  id: 'redline_splice',
  name: 'Redline Splice',
  cost: 5000,
  stats: { hp: 150, mp: 200 },
  consumable: false,
  active: {
    id: 'redline_splice_active',
    name: 'Reset Cooldowns',
    description: 'Reset all ability cooldowns.',
    cooldownTicks: 40,
  },
}

const ghostScepter: ItemDef = {
  id: 'phase_shunt',
  name: 'Phase Shunt',
  cost: 1500,
  stats: { mp: 100 },
  consumable: false,
  active: {
    id: 'phase_shunt_active',
    name: 'Ghost Form',
    description: 'Become immune to kinetic damage for 2 cycles. Cannot attack.',
    cooldownTicks: 20,
  },
}

// ── Existing Core Items ─────────────────────────────────────────────

const blinkModule: ItemDef = {
  id: 'jump_shunt',
  name: 'Jump Shunt',
  cost: 2150,
  stats: { attack: 10 },
  consumable: false,
  active: {
    id: 'jump_shunt_active',
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
  id: 'ablative_shell',
  name: 'Ablative Shell',
  cost: 2800,
  stats: { hp: 300, plate: 10 },
  consumable: false,
  active: {
    id: 'ablative_shell_active',
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
      'Place in a zone for vision lasting 45 cycles. Max 3 active per team (shared with sniffers).',
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
      'Reveals invisible units in the area. Lasts 30 cycles. Max 3 active per team (shared with camtaps).',
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
      'Team becomes invisible to enemy vision for 3 cycles. Breaks on entering enemy zone with heroes.',
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

  // Attack
  rust_driver: rust_driver,
  fracture_edge: fracture_edge,
  killshot_coil: killshot_coil,
  arc_coil: arc_coil,
  truestrike_rig: monkeyKingBar,
  last_word: divineRapier,
  ghostwire_edge: silverEdge,
  concussion_hammer: skullBasher,
  null_pointer: nullPointer,
  segfault_blade: segfaultBlade,

  // Magic
  amp_stack: mysticalStaff,
  discord_routine: veilOfDiscord,
  cryo_routine: shivasGuard,
  clock_lens: aetherLens,
  burnout: burnout,
  phase_shim: etherealBlade,
  stack_overflow: stackOverflow,

  // Defensive
  bulwark_plate: bulwark_plate,
  intercept_shell: linkensSphere,
  hardshell: blackKingBar,
  bulk_lattice: heartOfTarrasque,
  siege_lattice: assaultCuirass,
  mirror_shell: lotusOrb,
  spite_plate: bladeMail,
  garbage_collector: garbageCollector,
  ablative_shell: firewallItem,

  // Utility
  jump_shunt: blinkModule,
  shove_splice: forceStaff,
  kickback_splice: hurricanePike,
  lockout_shunt: scytheOfVyse,
  stasis_shunt: eulsScepter,
  redline_splice: refresherOrb,
  phase_shunt: ghostScepter,

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
      'Consumables and cheap fence goods — opening buys, camtaps, cans and tokens. Restock often.',
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
      'Carried weapons and attachments — attack damage, crits and plate shred for right-clickers.',
    ids: [
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
    ],
  },
  {
    id: 'deck',
    label: 'Deck',
    blurb: 'Software — amplify code damage, manipulate cooldowns, or nuke a target outright.',
    ids: [
      'amp_stack',
      'discord_routine',
      'cryo_routine',
      'clock_lens',
      'burnout',
      'phase_shim',
      'stack_overflow',
    ],
  },
  {
    id: 'chrome',
    label: 'Chrome',
    blurb: 'Implanted survivability — health, armor, resist and panic-button mitigation.',
    ids: [
      'bulwark_plate',
      'intercept_shell',
      'hardshell',
      'bulk_lattice',
      'siege_lattice',
      'mirror_shell',
      'spite_plate',
      'garbage_collector',
      'ablative_shell',
    ],
  },
  {
    id: 'wetware',
    label: 'Wetware',
    blurb: 'Neural and reflex — mobility, control, disables and tempo that swing fights.',
    ids: [
      'jump_shunt',
      'shove_splice',
      'kickback_splice',
      'lockout_shunt',
      'stasis_shunt',
      'redline_splice',
      'phase_shunt',
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
