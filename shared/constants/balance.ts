// ── Tick & Timing ────────────────────────────────────────────────

export const TICK_DURATION_MS = 4000
export const ACTION_WINDOW_MS = 3500

// ── Gold ─────────────────────────────────────────────────────────

export const PASSIVE_GOLD_PER_TICK = 2
export const CREEP_GOLD_MIN = 30
export const CREEP_GOLD_MAX = 50
export const SIEGE_CREEP_GOLD = 75
export const KILL_BOUNTY_BASE = 200
export const KILL_BOUNTY_PER_STREAK = 50
export const ASSIST_GOLD = 100
export const TOWER_GOLD = 500
export const ROSHAN_GOLD = 600
export const STARTING_GOLD = 600

// ── XP ───────────────────────────────────────────────────────────

export const MAX_LEVEL = 25

/** XP required to reach each level (index = level, index 0 unused). */
export const XP_PER_LEVEL: readonly number[] = [
  0, // 0 (unused)
  0, // 1 (start)
  100, // 2
  200, // 3
  350, // 4
  500, // 5
  700, // 6
  900, // 7
  1150, // 8
  1400, // 9
  1700, // 10
  2000, // 11
  2350, // 12
  2700, // 13
  3100, // 14
  3500, // 15
  3950, // 16
  4400, // 17
  4900, // 18
  5400, // 19
  5950, // 20
  6500, // 21
  7100, // 22
  7700, // 23
  8350, // 24
  9000, // 25
] as const

export const CREEP_XP = 40
export const HERO_KILL_XP_BASE = 100
export const HERO_KILL_XP_PER_LEVEL = 20

// ── Respawn ──────────────────────────────────────────────────────

/** Respawn time in ticks = base + level * perLevel */
export const RESPAWN_BASE_TICKS = 3
export const RESPAWN_PER_LEVEL_TICKS = 1

// ── Buyback ──────────────────────────────────────────────────────

export const BUYBACK_BASE_COST = 100
export const BUYBACK_COST_PER_LEVEL = 25
export const BUYBACK_COOLDOWN_TICKS = 90 // 6 minutes at 4s/tick

// ── Inventory ────────────────────────────────────────────────────

export const MAX_ITEMS = 6

// ── Wards ────────────────────────────────────────────────────────

export const WARD_DURATION_TICKS = 45
export const WARD_LIMIT_PER_TEAM = 3

// ── Roshan ───────────────────────────────────────────────────────

export const ROSHAN_RESPAWN_TICKS = 90
export const ROSHAN_BASE_HP = 5000
export const ROSHAN_HP_PER_MINUTE = 100
export const ROSHAN_ATTACK = 150
export const ROSHAN_ATTACK_RANGE = 1 // adjacent zones
export const ROSHAN_AEGIS_TICKS = 300 // 5 minutes at 4s/tick

// ── Runes ───────────────────────────────────────────────────────────

export const RUNE_INTERVAL_TICKS = 60 // Spawn every 60 ticks (4 min)
export const RUNE_DURATION_TICKS = 30 // Runes expire after 30 ticks (2 min)

// Rune buff durations (in ticks)
export const RUNE_BUFF_TICKS = {
  haste: 15,    // 60 seconds
  dd: 15,       // 60 seconds  
  regen: 15,    // 60 seconds
  arcane: 15,   // 60 seconds
  invis: 15,    // 60 seconds
} as const

// ── Surrender ────────────────────────────────────────────────────

export const SURRENDER_MIN_TICK = 225 // 15 minutes at 4s/tick
export const SURRENDER_VOTE_THRESHOLD = 0.6 // 60% majority required

// ── Creep Waves ──────────────────────────────────────────────────

export const CREEP_WAVE_INTERVAL_TICKS = 8
export const MELEE_CREEPS_PER_WAVE = 3
export const RANGED_CREEPS_PER_WAVE = 1
export const SIEGE_CREEP_WAVE_INTERVAL = 5 // every 5th wave includes a siege creep

export const MELEE_CREEP_HP = 400
export const RANGED_CREEP_HP = 250
export const SIEGE_CREEP_HP = 700
export const MELEE_CREEP_ATTACK = 20
export const RANGED_CREEP_ATTACK = 30
export const SIEGE_CREEP_ATTACK = 50

// ── Neutral Creeps ─────────────────────────────────────────────────

export const NEUTRAL_CREEPS_INTERVAL_TICKS = 60 // Spawn neutrals every 60 ticks

// Neutral creep types with stats
export const NEUTRAL_CREEPS = {
  // Small camp
  kobold: { hp: 250, attack: 10, gold: 20, xp: 25 },
  // Medium camp  
  ogre_mage: { hp: 550, attack: 25, gold: 40, xp: 50 },
  // Large camp
  centaur: { hp: 900, attack: 40, gold: 60, xp: 80 },
  // Ancient
  ancient_dragon: { hp: 1500, attack: 75, gold: 150, xp: 200 },
  ancient_rock_golem: { hp: 2000, attack: 60, gold: 200, xp: 250 },
} as const

export type NeutralCreepType = keyof typeof NEUTRAL_CREEPS

// ── Towers ───────────────────────────────────────────────────────

export const TOWER_HP_T1 = 1500
export const TOWER_HP_T2 = 2000
export const TOWER_HP_T3 = 2500
export const TOWER_ATTACK = 120
export const TOWER_DEFENSE = 20

// ── Fountain ─────────────────────────────────────────────────────

export const FOUNTAIN_HEAL_PER_TICK_PERCENT = 15
export const FOUNTAIN_MANA_PER_TICK_PERCENT = 15
