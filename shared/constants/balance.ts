// ── Tick & Timing ────────────────────────────────────────────────

import type { WaveUnitState, CacheState } from '../types/game'

export const CYCLE_DURATION_MS = 4000
export const ACTION_WINDOW_MS = 3500

/**
 * Global spectator broadcast delay (ms). The live spectator stream is fogless
 * (see VisionCalculator.filterStateForSpectator) — an account watching a game
 * it isn't playing in sees the FULL map in real time, which is a maphack if
 * that account (or anyone it talks to) has any channel back to a player in
 * the match. Delaying every watcher's feed by this much closes that channel:
 * nothing a spectator sees can reach a live player before the play itself
 * would have. NOT player-tunable — one global constant, no per-viewer knob.
 *
 * Currently unused: the live spectate page + its delay buffer (Spectator
 * DelayBuffer.ts) were deleted with the DO-era WS game server in the
 * all-Vercel cutover — no Ably-backed replacement exists yet. Kept as the
 * governing constant for whatever replaces it.
 */
export const SPECTATOR_BROADCAST_DELAY_MS = 150_000 // 2.5 minutes

/**
 * Hard cap on buffered (not-yet-mature) spectator frames per watched game — a
 * safety valve against unbounded growth if a game's delivery timer ever stalls
 * (it shouldn't in normal operation: frames drain every flush tick as soon as
 * they age past SPECTATOR_BROADCAST_DELAY_MS). At the nominal 4s cycle, at
 * most `ceil(150_000 / 4_000) = 38` frames are ever in flight; this adds
 * headroom for jitter/backlog before the valve kicks in and the oldest frames
 * get dropped (with a warning log) instead of growing forever.
 */
export const SPECTATOR_BUFFER_MAX_FRAMES =
  Math.ceil(SPECTATOR_BROADCAST_DELAY_MS / CYCLE_DURATION_MS) + 16

// ── Gold ─────────────────────────────────────────────────────────

export const PASSIVE_SCRIP_PER_CYCLE = 4
export const WAVE_SCRIP_MIN = 30
export const WAVE_SCRIP_MAX = 50
/** Fixed normal-wave last-hit scrip (was random 30–50). Deterministic so farm
 * reward doesn't swing on dice; equals the old average so economy is unchanged. */
export const WAVE_SCRIP = 40
export const BREACH_UNIT_SCRIP = 75
export const KILL_BOUNTY_BASE = 200
export const KILL_BOUNTY_PER_STREAK = 50
export const ASSIST_SCRIP = 100
export const ICE_SCRIP = 500
export const TENANT_SCRIP = 600
export const STARTING_SCRIP = 600
/** Fraction of an item's cost refunded when sold. */
export const SELL_REFUND_RATIO = 0.5

/**
 * Comeback bounty: kill scrip is multiplied by a factor based on the
 * net-worth gap between teams. The killer earns up to +50% if their
 * team is behind, and as little as -30% if their team is far ahead.
 * Net-worth gap of COMEBACK_FULL_GAP scrip yields the cap multiplier.
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
 * XP mirror of the scrip comeback bounty above. An average level gap of
 * XP_COMEBACK_FULL_LEVEL_GAP yields the cap multiplier.
 */
export const XP_COMEBACK_BONUS_MAX = 0.5
export const XP_COMEBACK_PENALTY_MAX = 0.3
export const XP_COMEBACK_FULL_LEVEL_GAP = 5

/**
 * Tier-25 "double cast" exotic talent: each cast of the talented ability has
 * this chance to fire a second time (paying BW again).
 */
export const DOUBLE_CAST_CHANCE = 0.25

/**
 * Tier-25 "spell lifesteal" exotic talent: ability damage dealt to enemy heroes
 * heals the caster for this fraction of the damage dealt.
 */
export const SPELL_LIFESTEAL_PERCENT = 0.3

// ── Respawn ──────────────────────────────────────────────────────

/**
 * Respawn time in cycles = base + max(0, level - freeLevels) * perLevel
 * Level 1 death = 3 ticks (12s) — roughly a wave, so a gank always
 * costs something. Scales smoothly: lvl 5 ≈ 28s, lvl 10 ≈ 48s, lvl 25 ≈ 108s.
 */
export const RESPAWN_BASE_CYCLES = 3
export const RESPAWN_PER_LEVEL_CYCLES = 1
export const RESPAWN_FREE_LEVELS = 1

// ── Buyback ──────────────────────────────────────────────────────

export const BUYBACK_BASE_COST = 100
export const BUYBACK_COST_PER_LEVEL = 25
export const BUYBACK_COOLDOWN_CYCLES = 90 // 6 minutes at 4s/cycle

// ── Inventory ────────────────────────────────────────────────────

export const MAX_ITEMS = 6

// ── Wards ────────────────────────────────────────────────────────

export const CAMTAP_DURATION_CYCLES = 45
export const SNIFFER_DURATION_CYCLES = 30
export const WARD_LIMIT_PER_TEAM = 3
export const SNIFFER_TRUE_SIGHT_RADIUS = 1

// ── Tenant ───────────────────────────────────────────────────────

export const TENANT_RESPAWN_CYCLES = 90
export const TENANT_BASE_HP = 5000
export const TENANT_HP_PER_MINUTE = 100
export const TENANT_ATTACK = 150
export const TENANT_BACKUP_CYCLES = 300 // 5 minutes at 4s/cycle

// ── Caches ───────────────────────────────────────────────────────────

export const CACHE_INTERVAL_CYCLES = 60 // Spawn every 60 ticks (4 min)
export const CACHE_DURATION_CYCLES = 30 // Caches expire after 30 ticks (2 min)

// Cache buff durations (in cycles). Typed against CacheState['type'] so adding a
// new cache type is a compile error here until the duration map is updated.
export const CACHE_BUFF_TICKS: Record<CacheState['type'], number> = {
  haste: 15, // 60 seconds
  dd: 15, // 60 seconds
  regen: 15, // 60 seconds
  arcane: 15, // 60 seconds
  invis: 15, // 60 seconds
}

// ── Surrender ────────────────────────────────────────────────────

export const SURRENDER_MIN_CYCLE = 225 // 15 minutes at 4s/cycle
export const SURRENDER_VOTE_THRESHOLD = 0.6 // 60% majority required

// ── Wave Waves ──────────────────────────────────────────────────

export const WAVE_INTERVAL_CYCLES = 8
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
 * Ice and Terminal INTEG are fixed while wave output never scaled, so a wave
 * that could not break a T1 at minute 5 still could not break it at minute 45:
 * `bun run sim 16` measured 31–73m, median 60m. Every
 * WAVE_ESCALATION_INTERVAL_CYCLES, wave INTEG and wave damage each gain one
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
export const WAVE_ESCALATION_INTERVAL_CYCLES = 50
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

/** Wave stat multiplier at `cycle`. 1.0 for the whole first interval. */
export function waveEscalationMultiplier(cycle: number): number {
  const steps = Math.max(0, Math.floor(cycle / WAVE_ESCALATION_INTERVAL_CYCLES))
  return Math.min(WAVE_ESCALATION_MAX_MULTIPLIER, 1 + steps * WAVE_ESCALATION_STEP)
}

/**
 * INTEG a wave of `type` spawns with at `cycle` — and therefore its max INTEG, since
 * lane waves never heal. Any surface that renders a wave INTEG bar or a
 * fraction-of-max threshold has to read this rather than LINE_UNIT_HP &co,
 * which are only the cycle-0 values once escalation starts.
 */
export function waveUnitMaxHp(type: WaveUnitState['type'], cycle: number): number {
  return Math.round(WAVE_BASE_HP[type] * waveEscalationMultiplier(cycle))
}

/** Damage a wave of `type` deals at `cycle`. */
export function waveUnitAttack(type: WaveUnitState['type'], cycle: number): number {
  return Math.round(WAVE_BASE_ATTACK[type] * waveEscalationMultiplier(cycle))
}

// ── Neutral Waves ─────────────────────────────────────────────────

export const SILT_DWELLER_INTERVAL_CYCLES = 60 // Spawn neutrals every 60 ticks

/** Max live neutrals per silt camp zone. Prevents unbounded accumulation
 *  if a camp is never cleared (unlike lane waves which have enforceWaveZoneCap). */
export const MAX_NEUTRALS_PER_CAMP = 4

// Neutral wave types with stats
export const SILT_DWELLERS = {
  // Small camp
  stub: { integ: 250, attack: 10, scrip: 20, xp: 25 },
  // Medium camp
  watchdog: { integ: 550, attack: 25, scrip: 40, xp: 50 },
  // Large camp
  warden: { integ: 900, attack: 40, scrip: 60, xp: 80 },
  // Terminal
  orphan: { integ: 1500, attack: 75, scrip: 150, xp: 200 },
  zombie: { integ: 2000, attack: 60, scrip: 200, xp: 250 },
} as const

export type SiltDwellerType = keyof typeof SILT_DWELLERS

// ── ICE ───────────────────────────────────────────────────────

export const ICE_HP_T1 = 1500
export const ICE_HP_T2 = 2000
export const ICE_HP_T3 = 2500
export const ICE_ATTACK = 120
export const ICE_DEFENSE = 20

// ── Terminals (core structures) ───────────────────────────────────

/**
 * The Terminal ("Terminal") — each team's win-condition structure in its
 * base zone. Invulnerable until at least one of the owning team's T3
 * ice is destroyed; the game ends when a Terminal falls.
 */
export const TERMINAL_HP = 6000

/**
 * Waves stuck in a base zone with nothing to attack (Terminal still
 * invulnerable) are despawned ("garbage collected") after this many idle
 * ticks — prevents unbounded wave pileups in base.
 */
export const WAVE_BASE_IDLE_DESPAWN_CYCLES = 3

/**
 * Defensive cap on lane waves per team per zone. When exceeded the
 * oldest waves are despawned first. Guards against route bugs causing
 * unbounded stacking.
 */
export const MAX_WAVE_UNITS_PER_ZONE_PER_TEAM = 12

// ── Fountain ─────────────────────────────────────────────────────

export const FOUNTAIN_HEAL_PER_CYCLE_PERCENT = 15
export const FOUNTAIN_BW_PER_CYCLE_PERCENT = 15

export const HARDEN_DURATION_CYCLES = 5
export const HARDEN_COOLDOWN_CYCLES = 300

// ── BREACH (access state) ────────────────────────────────────────
// Closed by default. `breach <target>` opens a crew-wide window so code
// damage is full and hard control can land. Kinetic never needs access.
// Duration 5: room for breach + hard control + one follow-up. CD 10 / cost 50
// keep it a deliberate spend, not free every cycle.
export const BREACH_DURATION_CYCLES = 5
export const BREACH_COOLDOWN_CYCLES = 10
export const BREACH_BW_COST = 50

// ── Day/Night Cycle ──────────────────────────────────────────────

export const DAY_DURATION_CYCLES = 300
export const NIGHT_DURATION_CYCLES = 240
export const NIGHT_VISION_PENALTY = 1

// ── Burn System ──────────────────────────────────────────────────

export const BURN_HP_THRESHOLD = 0.5
export const BURN_SCRIP_RATIO = 0.5
export const BURN_XP_RATIO = 0.5

// ── Strip System ─────────────────────────────────────────────────

/**
 * A wave unit at or below this fraction of the INTEG it SPAWNED with is
 * carrying more than it can defend: attack it and you take the payload
 * outright, whatever your attack stat says.
 *
 * This exists because raw damage could not reach it. A line unit spawns with
 * 400 INTEG and escalates to 1240 by minute 20, while a hero's basic attack
 * averages 51 — so at one action per four-second cycle a single unit cost
 * eight swings early and twenty-four late. Measured over full matches, heroes
 * were finishing 6% of the units that went down; the rest died wave-on-wave.
 * Farming paid ~200sc a match against ~1200 from the passive drip, which made
 * the shop unreachable and the game's central verb worth almost nothing.
 *
 * A threshold rather than more damage, because it makes the strip a question
 * of TIMING — read which unit will be low when the cycle commits — which is
 * the batch clock's whole premise, and because it leaves wave-on-wave combat
 * (and therefore lane equilibrium and push timing) completely untouched.
 *
 * It mirrors BURN_HP_THRESHOLD, which has always worked exactly this way for
 * denying your own units. Strip is the tighter window of the two: taking an
 * enemy's payload should ask more of you than torching your own.
 */
export const STRIP_HP_THRESHOLD = 0.35

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
