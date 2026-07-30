// ── Tick & Timing ────────────────────────────────────────────────

import type { WaveUnitState, CacheState } from '../types/game'

export const TICK_DURATION_MS = 4000
export const ACTION_WINDOW_MS = 3500

// ── Gold ─────────────────────────────────────────────────────────

export const PASSIVE_GOLD_PER_TICK = 4
export const WAVE_GOLD_MIN = 30
export const WAVE_GOLD_MAX = 50
/** Fixed normal-wave last-hit gold (was random 30–50). Deterministic so farm
 * reward doesn't swing on dice; equals the old average so economy is unchanged. */
export const WAVE_GOLD = 40
export const BREACH_UNIT_GOLD = 75
export const KILL_BOUNTY_BASE = 200
export const KILL_BOUNTY_PER_STREAK = 50
export const ASSIST_GOLD = 100
export const ICE_GOLD = 500
export const TENANT_GOLD = 600
export const STARTING_GOLD = 600
/** Fraction of an item's cost refunded when sold. */
export const SELL_REFUND_RATIO = 0.5

/**
 * Comeback bounty: kill gold is multiplied by a factor based on the
 * net-worth gap between teams. The killer earns up to +50% if their
 * team is behind, and as little as -30% if their team is far ahead.
 * Net-worth gap of COMEBACK_FULL_GAP gold yields the cap multiplier.
 */
export const COMEBACK_BONUS_MAX = 0.5
export const COMEBACK_PENALTY_MAX = 0.3
export const COMEBACK_FULL_GAP = 8000

// ── XP ───────────────────────────────────────────────────────────

export const MAX_LEVEL = 25

/**
 * Player levels at which each ability slot gains a rank, ascending.
 *
 * Lives here — not in the engine — because the teaching surfaces (/learn, the
 * hero pages, the in-game ability buttons) have to state the same schedule the
 * engine enforces. They previously hardcoded prose and drifted: /learn claimed
 * "all four abilities work from level 1 — leveling up does not unlock
 * abilities", which is false for R and left players picking a hero for an
 * ultimate they could not cast until level 6.
 *
 * `getAbilityLevel` (server/game/heroes/_base.ts) derives from these, so a
 * change here moves the rule and every explanation of it together.
 */
export const BASIC_ABILITY_RANKS: readonly number[] = [1, 3, 5, 7]
export const ULTIMATE_RANKS: readonly number[] = [6, 12, 18]

/** The level at which the ultimate (R) becomes castable at all. */
export const ULTIMATE_UNLOCK_LEVEL = ULTIMATE_RANKS[0]!

/**
 * Rank of an ability at a given player level. 0 means "not learned yet" —
 * resolveAbility refuses those with "Ability not yet learned".
 *
 * Shared rather than engine-side because the CLIENT needs the same answer: the
 * ability buttons must not advertise an ultimate as READY at level 1 (they used
 * to), and the teaching pages must state the schedule the engine enforces.
 */
export function getAbilityLevel(playerLevel: number, slot: 'q' | 'w' | 'e' | 'r'): number {
  const ranks = slot === 'r' ? ULTIMATE_RANKS : BASIC_ABILITY_RANKS
  let level = 0
  for (const required of ranks) {
    if (playerLevel >= required) level++
  }
  return level
}

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

export const WAVE_XP = 40
export const HERO_KILL_XP_BASE = 100
export const HERO_KILL_XP_PER_LEVEL = 20

/**
 * Fraction of WAVE_XP paid to every living hero of the killing team standing
 * in the wave's zone, on top of the full WAVE_XP the last-hitter earns.
 *
 * XP used to come exclusively from hero last-hits, so a laner who mistimed
 * their attacks earned literally zero and sat five levels behind — and since
 * waves overwhelmingly die to other waves (WaveAI focuses enemy waves
 * first), most wave deaths paid nobody at all. Presence pays; timing still
 * pays more.
 */
export const WAVE_XP_SHARED_RATIO = 0.5
export const WAVE_XP_SHARED = Math.floor(WAVE_XP * WAVE_XP_SHARED_RATIO)

/**
 * Comeback XP: kill XP is multiplied by a factor based on the average team
 * LEVEL gap (see xpComebackMultiplier). A team behind in average level earns
 * bonus XP so a level lead can't compound without a catch-up mechanism — the
 * XP mirror of the gold comeback bounty above. An average level gap of
 * XP_COMEBACK_FULL_LEVEL_GAP yields the cap multiplier.
 */
export const XP_COMEBACK_BONUS_MAX = 0.5
export const XP_COMEBACK_PENALTY_MAX = 0.3
export const XP_COMEBACK_FULL_LEVEL_GAP = 5

/**
 * Tier-25 "double cast" exotic talent: each cast of the talented ability has
 * this chance to fire a second time (paying mana again).
 */
export const DOUBLE_CAST_CHANCE = 0.25

/**
 * Tier-25 "spell lifesteal" exotic talent: ability damage dealt to enemy heroes
 * heals the caster for this fraction of the damage dealt.
 */
export const SPELL_LIFESTEAL_PERCENT = 0.3

// ── Respawn ──────────────────────────────────────────────────────

/**
 * Respawn time in ticks = base + max(0, level - freeLevels) * perLevel
 * Level 1 death = 3 ticks (12s) — roughly a wave wave, so a gank always
 * costs something. Scales smoothly: lvl 5 ≈ 28s, lvl 10 ≈ 48s, lvl 25 ≈ 108s.
 */
export const RESPAWN_BASE_TICKS = 3
export const RESPAWN_PER_LEVEL_TICKS = 1
export const RESPAWN_FREE_LEVELS = 1

// ── Buyback ──────────────────────────────────────────────────────

export const BUYBACK_BASE_COST = 100
export const BUYBACK_COST_PER_LEVEL = 25
export const BUYBACK_COOLDOWN_TICKS = 90 // 6 minutes at 4s/tick

// ── Inventory ────────────────────────────────────────────────────

export const MAX_ITEMS = 6

// ── Wards ────────────────────────────────────────────────────────

export const CAMTAP_DURATION_TICKS = 45
export const SNIFFER_DURATION_TICKS = 30
export const WARD_LIMIT_PER_TEAM = 3
export const SNIFFER_TRUE_SIGHT_RADIUS = 1

// ── Tenant ───────────────────────────────────────────────────────

export const TENANT_RESPAWN_TICKS = 90
export const TENANT_BASE_HP = 5000
export const TENANT_HP_PER_MINUTE = 100
export const TENANT_ATTACK = 150
export const TENANT_BACKUP_TICKS = 300 // 5 minutes at 4s/tick

// ── Caches ───────────────────────────────────────────────────────────

export const CACHE_INTERVAL_TICKS = 60 // Spawn every 60 ticks (4 min)
export const CACHE_DURATION_TICKS = 30 // Caches expire after 30 ticks (2 min)

// Cache buff durations (in ticks). Typed against CacheState['type'] so adding a
// new cache type is a compile error here until the duration map is updated.
export const CACHE_BUFF_TICKS: Record<CacheState['type'], number> = {
  haste: 15, // 60 seconds
  dd: 15, // 60 seconds
  regen: 15, // 60 seconds
  arcane: 15, // 60 seconds
  invis: 15, // 60 seconds
}

// ── Surrender ────────────────────────────────────────────────────

export const SURRENDER_MIN_TICK = 225 // 15 minutes at 4s/tick
export const SURRENDER_VOTE_THRESHOLD = 0.6 // 60% majority required

// ── Wave Waves ──────────────────────────────────────────────────

export const WAVE_INTERVAL_TICKS = 8
export const LINE_UNITS_PER_WAVE = 3
export const SWEEP_UNITS_PER_WAVE = 1
export const BREACH_WAVE_INTERVAL = 5 // every 5th wave includes a breach wave

export const LINE_UNIT_HP = 400
export const SWEEP_UNIT_HP = 250
export const BREACH_UNIT_HP = 700
export const LINE_UNIT_ATTACK = 20
export const SWEEP_UNIT_ATTACK = 30
export const BREACH_UNIT_ATTACK = 50

/**
 * Wave escalation — the match-length lever.
 *
 * Ice and Ancient INTEG are fixed while wave output never scaled, so a wave
 * that could not break a T1 at minute 5 still could not break it at minute 45:
 * `bun run sim 16` measured 31–73m, median 60m. Every
 * WAVE_ESCALATION_INTERVAL_TICKS, wave INTEG and wave damage each gain one
 * WAVE_ESCALATION_STEP of their base value, so lane pressure compounds and
 * pushes eventually close the game. These values measured 14–38m (median 28m)
 * over 16 matches and 9–35m (median 24m) over 24.
 *
 * INTEG and damage scale by the SAME factor on purpose: wave-vs-wave
 * time-to-kill is then unchanged (waves still meet and trade at the old rate,
 * so the laning texture survives) and only wave-vs-structure moves — which is
 * the thing that actually ends a match. It touches neither the XP/gold economy
 * nor hero stats.
 *
 * The cap exists so a stalled game does not degenerate into waves that
 * one-shot heroes. Tuning order: shorten the interval before growing the step —
 * the step compounds against the cap, the interval front-loads the mid game.
 */
export const WAVE_ESCALATION_INTERVAL_TICKS = 50
export const WAVE_ESCALATION_STEP = 0.35
export const WAVE_ESCALATION_MAX_MULTIPLIER = 4

const WAVE_BASE_HP: Record<WaveUnitState['type'], number> = {
  line: LINE_UNIT_HP,
  sweep: SWEEP_UNIT_HP,
  breach: BREACH_UNIT_HP,
}

const WAVE_BASE_ATTACK: Record<WaveUnitState['type'], number> = {
  line: LINE_UNIT_ATTACK,
  sweep: SWEEP_UNIT_ATTACK,
  breach: BREACH_UNIT_ATTACK,
}

/** Wave stat multiplier at `tick`. 1.0 for the whole first interval. */
export function waveEscalationMultiplier(tick: number): number {
  const steps = Math.max(0, Math.floor(tick / WAVE_ESCALATION_INTERVAL_TICKS))
  return Math.min(WAVE_ESCALATION_MAX_MULTIPLIER, 1 + steps * WAVE_ESCALATION_STEP)
}

/**
 * INTEG a wave of `type` spawns with at `tick` — and therefore its max INTEG, since
 * lane waves never heal. Any surface that renders a wave INTEG bar or a
 * fraction-of-max threshold has to read this rather than LINE_UNIT_HP &co,
 * which are only the tick-0 values once escalation starts.
 */
export function waveUnitMaxHp(type: WaveUnitState['type'], tick: number): number {
  return Math.round(WAVE_BASE_HP[type] * waveEscalationMultiplier(tick))
}

/** Damage a wave of `type` deals at `tick`. */
export function waveUnitAttack(type: WaveUnitState['type'], tick: number): number {
  return Math.round(WAVE_BASE_ATTACK[type] * waveEscalationMultiplier(tick))
}

// ── Neutral Waves ─────────────────────────────────────────────────

export const SILT_DWELLER_INTERVAL_TICKS = 60 // Spawn neutrals every 60 ticks

/** Max live neutrals per jungle camp zone. Prevents unbounded accumulation
 *  if a camp is never cleared (unlike lane waves which have enforceWaveZoneCap). */
export const MAX_NEUTRALS_PER_CAMP = 4

// Neutral wave types with stats
export const SILT_DWELLERS = {
  // Small camp
  stub: { integ: 250, attack: 10, gold: 20, xp: 25 },
  // Medium camp
  watchdog: { integ: 550, attack: 25, gold: 40, xp: 50 },
  // Large camp
  warden: { integ: 900, attack: 40, gold: 60, xp: 80 },
  // Ancient
  orphan: { integ: 1500, attack: 75, gold: 150, xp: 200 },
  zombie: { integ: 2000, attack: 60, gold: 200, xp: 250 },
} as const

export type SiltDwellerType = keyof typeof SILT_DWELLERS

// ── ICE ───────────────────────────────────────────────────────

export const ICE_HP_T1 = 1500
export const ICE_HP_T2 = 2000
export const ICE_HP_T3 = 2500
export const ICE_ATTACK = 120
export const ICE_DEFENSE = 20

// ── Ancients (core structures) ───────────────────────────────────

/**
 * The Ancient ("Mainframe") — each team's win-condition structure in its
 * base zone. Invulnerable until at least one of the owning team's T3
 * ice is destroyed; the game ends when an Ancient falls.
 */
export const ANCIENT_HP = 6000

/**
 * Waves stuck in a base zone with nothing to attack (Ancient still
 * invulnerable) are despawned ("garbage collected") after this many idle
 * ticks — prevents unbounded wave pileups in base.
 */
export const WAVE_BASE_IDLE_DESPAWN_TICKS = 3

/**
 * Defensive cap on lane waves per team per zone. When exceeded the
 * oldest waves are despawned first. Guards against route bugs causing
 * unbounded stacking.
 */
export const MAX_WAVE_UNITS_PER_ZONE_PER_TEAM = 12

// ── Fountain ─────────────────────────────────────────────────────

export const FOUNTAIN_HEAL_PER_TICK_PERCENT = 15
export const FOUNTAIN_BW_PER_TICK_PERCENT = 15

export const HARDEN_DURATION_TICKS = 5
export const HARDEN_COOLDOWN_TICKS = 300

// ── BREACH (access state) ────────────────────────────────────────
// Closed by default. `breach <target>` opens a crew-wide window so code
// damage is full and hard control can land. Kinetic never needs access.
// Duration 5: room for breach + hard control + one follow-up. CD 10 / cost 50
// keep it a deliberate spend, not free every cycle.
export const BREACH_DURATION_TICKS = 5
export const BREACH_COOLDOWN_TICKS = 10
export const BREACH_BW_COST = 50

// ── Day/Night Cycle ──────────────────────────────────────────────

export const DAY_DURATION_TICKS = 300
export const NIGHT_DURATION_TICKS = 240
export const NIGHT_VISION_PENALTY = 1

// ── Burn System ──────────────────────────────────────────────────

export const BURN_HP_THRESHOLD = 0.5
export const BURN_GOLD_RATIO = 0.5
export const BURN_XP_RATIO = 0.5

// ── Assist System ────────────────────────────────────────────────

export const ASSIST_XP_RATIO = 0.5

// ── Item Passives ────────────────────────────────────────────────

export const NULL_POINTER_CRIT_CHANCE = 0.15
// 1.5x keeps the budget crit item below Crystalys (+15% expected damage at
// 1950g) — at 2.0x it matched Crystalys' expected output for 550g less.
export const NULL_POINTER_CRIT_MULTIPLIER = 1.5
export const FRACTURE_EDGE_CRIT_CHANCE = 0.2
export const FRACTURE_EDGE_CRIT_MULTIPLIER = 1.75
export const KILLSHOT_COIL_CRIT_CHANCE = 0.3
export const KILLSHOT_COIL_CRIT_MULTIPLIER = 2.4
export const BULWARK_PLATE_BLOCK_CHANCE = 0.6
export const BULWARK_PLATE_BLOCK_AMOUNT = 50
export const RUST_DRIVER_PLATE_REDUCTION = 5
// Assault Cuirass aura: enemies in the holder's zone lose this much plate,
// and allies (incl. self) gain it. Same magnitude as Desolator, distinct name.
export const SIEGE_LATTICE_AURA_PLATE = 5
export const TRUESTRIKE_RIG_BONUS_DAMAGE = 50

// ── Regeneration ─────────────────────────────────────────────────

export const CLOT_RING_REGEN_PERCENT = 0.02
export const DRIP_MASK_REGEN_PERCENT = 0.02
export const BULK_LATTICE_REGEN_PERCENT = 0.05
export const REGEN_CACHE_HEAL_PERCENT = 0.05

// ── Combat ───────────────────────────────────────────────────────

export const IN_COMBAT_BUFF_DURATION = 3
export const POWER_SPIKE_LEVELS = [6, 12, 18] as const
