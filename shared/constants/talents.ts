/**
 * Talent Tree System
 * Four binary choices per hero, one per tier — see TALENT_UNLOCK_LEVEL for the
 * hero level each tier becomes available at.
 * Each hero has unique talent options per tier
 */

import type { HeroId } from '~~/shared/constants/heroes'

/**
 * Tier identity, NOT the unlock level (those parted ways — see
 * TALENT_UNLOCK_LEVEL). These four numbers are baked into talent IDs
 * (`echo_10_left`), the `tier10`…`tier25` slots on PlayerState, the
 * `select_talent` command and the `talent <tier>` the player types, so they stay
 * as they are: renaming them would churn ~150 talent definitions and every
 * consumer for zero player-visible gain.
 */
export type TalentTier = 10 | 15 | 20 | 25

export type TalentType =
  | 'stat_bonus' // +X to a stat
  | 'ability_boost' // Enhances specific ability
  | 'cooldown_reduce' // -X cycles of cooldown on ability (1 cycle = 4 s)
  | 'bw_cost_reduce' // -X% BW cost
  | 'damage_boost' // ability removes X% more INTEG from each enemy it hits
  | 'special' // Unique hero-specific effect

/**
 * Mechanical cast effects granted by tier-25 "exotic" talents (Talent.castEffect).
 * - 'double_cast': each cast of the talent's ability has a chance to fire twice.
 * - 'spell_lifesteal': ability damage dealt to enemy heroes heals the caster.
 * - 'global_ultimate': the talented R can target a hero in any zone (no range limit).
 * - 'aoe_bonus': the talented ability also hits enemies in adjacent zones.
 */
export type CastEffect = 'double_cast' | 'spell_lifesteal' | 'global_ultimate' | 'aoe_bonus'

export interface Talent {
  id: string
  name: string
  description: string
  type: TalentType
  tier: TalentTier
  // Stat bonuses
  statBonus?: {
    stat: 'integ' | 'bw' | 'attack' | 'plate' | 'ice' | 'attackSpeed'
    value: number
  }
  // Ability modifications
  abilityId?: 'q' | 'w' | 'e' | 'r'
  cooldownReduction?: number // CYCLES (1 cycle = 4 s) off the cooldown; floor 1 — never seconds
  bwCostReduction?: number // percentage of the BW the cast spent, refunded after the cast
  damageBoost?: number // percentage: extra N% of the INTEG each enemy LOST to the cast (post-mitigation)
  // Special effects
  specialEffect?: string // Description of unique effect
  /**
   * Mechanical cast effect granted when this talent is selected (a tier-25
   * "exotic" upgrade). Unlike the numeric modifiers above, these change HOW an
   * ability behaves. See CastEffect for the available effects.
   */
  castEffect?: CastEffect
}

export interface TalentTree {
  heroId: HeroId
  tiers: {
    10: [Talent, Talent] // Left option, Right option
    15: [Talent, Talent]
    20: [Talent, Talent]
    25: [Talent, Talent]
  }
}

/**
 * Hero level at which each talent tier becomes selectable.
 *
 * Measured with `bun run sim 8 1200` after the Wave-2 pacing + shared-lane-XP
 * changes: matches now end at a median of ~20 minutes (11–26m), and across 160
 * finished hero-games the share of players who ever REACH a given level is
 *
 *   lvl 3 100% · lvl 6 94% · lvl 9 68% · lvl 12 23% · lvl 15 1% · lvl 20+ 0%
 *
 * Under the old level-equals-tier rule that meant 47% of players never made a
 * single talent choice, the ones who did made it in the closing minutes, and the
 * three upper tiers — including the four exotic cast effects — were unreachable
 * content in every simulated match. Every player of a hero developed identically
 * for the whole game.
 *
 * 3/6/9/12 reads straight off that curve: one choice for everybody around minute
 * 4, a second for nearly everybody, a third for two thirds, and the capstone as
 * a real reward for the fifth of players who get far enough ahead. The roadmap's
 * 4/8/12/16 was written against the pre-Wave-2 51-minute game; against the
 * measured one it is too LATE at the top, not too early, and would have left the
 * last tier exactly as dead as it is today.
 */
export const TALENT_UNLOCK_LEVEL: Record<TalentTier, number> = {
  10: 3,
  15: 6,
  20: 9,
  25: 12,
}

/**
 * The hero level required to choose from `tier`. Every `player.level >= tier`
 * comparison is a bug — that reads the tier's NAME as a level requirement.
 */
export function talentUnlockLevel(tier: TalentTier): number {
  return TALENT_UNLOCK_LEVEL[tier]
}

/**
 * Talent definitions for all heroes
 * Each hero gets 4 tiers × 2 choices = 8 total talents
 */
export const TALENT_TREES: Record<HeroId, TalentTree> = {
  echo: {
    heroId: 'echo',
    tiers: {
      10: [
        {
          id: 'echo_10_left',
          name: '+15 Attack Damage',
          description: 'Increases base attack damage by 15',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'attack', value: 15 },
        },
        {
          id: 'echo_10_right',
          name: '+200 INTEG',
          description: 'Increases maximum INTEG by 200',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'integ', value: 200 },
        },
      ],
      15: [
        {
          id: 'echo_15_left',
          name: '-2 Cycles Resonance CD',
          description: 'Resonance (Q) cooldown reduced by 2 cycles',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'q',
          cooldownReduction: 2,
        },
        {
          id: 'echo_15_right',
          name: '-2 Cycles Phase Shift CD',
          description: 'Phase Shift (W) cooldown reduced by 2 cycles',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'w',
          cooldownReduction: 2,
        },
      ],
      20: [
        {
          id: 'echo_20_left',
          name: '+30% Resonance INTEG Removed',
          description: 'Resonance (Q) removes 30% more INTEG from each enemy it hits',
          type: 'damage_boost',
          tier: 20,
          abilityId: 'q',
          damageBoost: 30,
        },
        {
          id: 'echo_20_right',
          name: '+15 ICE',
          description: 'Increases ICE by 15 — less code damage taken',
          type: 'stat_bonus',
          tier: 20,
          statBonus: { stat: 'ice', value: 15 },
        },
      ],
      25: [
        {
          id: 'echo_25_left',
          name: 'Double Resonance',
          description: 'Resonance (Q) has a 25% chance to cast twice',
          type: 'special',
          tier: 25,
          abilityId: 'q',
          castEffect: 'double_cast',
          specialEffect: 'Double Resonance (Q) — 25% chance to cast twice',
        },
        {
          id: 'echo_25_right',
          name: '+250 Max INTEG',
          description: 'Increases maximum INTEG by 250',
          type: 'stat_bonus',
          tier: 25,
          statBonus: { stat: 'integ', value: 250 },
        },
      ],
    },
  },

  daemon: {
    heroId: 'daemon',
    tiers: {
      10: [
        {
          // Was '+12 Attack Speed' — attackSpeed is never consumed (tick-based
          // combat), so the talent did nothing. Retargeted to +12 Attack (a
          // functional, engine-consumed stat) to keep this the offensive choice
          // opposite the +8 Iceance option.
          id: 'daemon_10_left',
          name: '+12 Attack',
          description: 'Increases attack damage by 12',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'attack', value: 12 },
        },
        {
          id: 'daemon_10_right',
          name: '+8 ICE',
          description: 'Increases ICE by 8',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'ice', value: 8 },
        },
      ],
      15: [
        {
          id: 'daemon_15_left',
          name: 'Inject Costs 35% Less BW',
          description: 'Reduces Inject BW cost by 35%',
          type: 'bw_cost_reduce',
          tier: 15,
          abilityId: 'q',
          bwCostReduction: 35,
        },
        {
          id: 'daemon_15_right',
          name: '-3 Cycles Fork Bomb CD',
          description: 'Fork Bomb cooldown reduced by 3 cycles',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'w',
          cooldownReduction: 3,
        },
      ],
      20: [
        {
          id: 'daemon_20_left',
          name: '-3 Cycles Sudo CD',
          description: 'Sudo (execute) cooldown reduced by 3 cycles',
          type: 'cooldown_reduce',
          tier: 20,
          abilityId: 'e',
          cooldownReduction: 3,
        },
        {
          id: 'daemon_20_right',
          name: '+250 INTEG',
          description: 'Increases maximum INTEG by 250',
          type: 'stat_bonus',
          tier: 20,
          statBonus: { stat: 'integ', value: 250 },
        },
      ],
      25: [
        {
          id: 'daemon_25_left',
          name: '-10 Cycles Root Access CD',
          description: 'Root Access (teleport) cooldown reduced by 10 cycles',
          type: 'cooldown_reduce',
          tier: 25,
          abilityId: 'r',
          cooldownReduction: 10,
        },
        {
          id: 'daemon_25_right',
          name: 'Soul Siphon',
          description: 'Ability damage dealt to enemy heroes heals you for 30%',
          type: 'special',
          tier: 25,
          castEffect: 'spell_lifesteal',
          specialEffect: 'Soul Siphon — ability damage heals you for 30%',
        },
      ],
    },
  },

  // Add talent trees for other heroes (abbreviated for brevity)
  kernel: {
    heroId: 'kernel',
    tiers: {
      10: [
        {
          id: 'kernel_10_left',
          name: '+200 INTEG',
          description: '+200 INTEG — more health to hold the front line',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'integ', value: 200 },
        },
        {
          id: 'kernel_10_right',
          name: '+15 Plate',
          description:
            '+15 Plate — less kinetic damage taken while Core Dump has enemies hitting you',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'plate', value: 15 },
        },
      ],
      15: [
        {
          id: 'kernel_15_left',
          name: 'Interrupt Costs 40% Less BW',
          description: 'Reduces Interrupt BW cost by 40%',
          type: 'bw_cost_reduce',
          tier: 15,
          abilityId: 'q',
          bwCostReduction: 40,
        },
        {
          id: 'kernel_15_right',
          name: '-4 Cycles Buffer CD',
          description: 'Buffer (shield) cooldown reduced by 4 cycles',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'w',
          cooldownReduction: 4,
        },
      ],
      20: [
        {
          id: 'kernel_20_left',
          name: '-3 Cycles Core Dump CD',
          description: 'Core Dump (taunt) cooldown reduced by 3 cycles',
          type: 'cooldown_reduce',
          tier: 20,
          abilityId: 'e',
          cooldownReduction: 3,
        },
        {
          id: 'kernel_20_right',
          name: '+300 INTEG',
          description: '+300 INTEG — a bigger pool for the hits Core Dump pulls onto you',
          type: 'stat_bonus',
          tier: 20,
          statBonus: { stat: 'integ', value: 300 },
        },
      ],
      25: [
        {
          id: 'kernel_25_left',
          name: '-10 Cycles Panic CD',
          description: 'Panic (fear) cooldown reduced by 10 cycles',
          type: 'cooldown_reduce',
          tier: 25,
          abilityId: 'r',
          cooldownReduction: 10,
        },
        {
          id: 'kernel_25_right',
          name: '+20 ICE',
          description: '+20 ICE — less code damage taken from enemy casters',
          type: 'stat_bonus',
          tier: 25,
          statBonus: { stat: 'ice', value: 20 },
        },
      ],
    },
  },

  regex: {
    heroId: 'regex',
    tiers: {
      10: [
        {
          id: 'regex_10_left',
          name: '+150 BW',
          description:
            '+150 BW — more bandwidth to chain Match, Capture Group and Catastrophic Backtracking',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'bw', value: 150 },
        },
        {
          id: 'regex_10_right',
          name: '+12 Attack',
          description: '+12 Attack — raises basic-attack damage between casts',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'attack', value: 12 },
        },
      ],
      15: [
        {
          id: 'regex_15_left',
          name: '+40% Match INTEG Removed',
          description: 'Match (Q) removes 40% more INTEG from each enemy it hits',
          type: 'damage_boost',
          tier: 15,
          abilityId: 'q',
          damageBoost: 40,
        },
        {
          id: 'regex_15_right',
          name: 'Match Costs 15% Less BW',
          description: 'Reduces Match BW cost by 15%',
          type: 'bw_cost_reduce',
          tier: 15,
          abilityId: 'q',
          bwCostReduction: 15,
        },
      ],
      20: [
        {
          id: 'regex_20_left',
          name: '-2 Cycles Capture Group CD',
          description: 'Capture Group (root) cooldown reduced by 2 cycles',
          type: 'cooldown_reduce',
          tier: 20,
          abilityId: 'w',
          cooldownReduction: 2,
        },
        {
          id: 'regex_20_right',
          name: '+20 ICE',
          description: '+20 ICE — less code damage taken for a low-INTEG caster',
          type: 'stat_bonus',
          tier: 20,
          statBonus: { stat: 'ice', value: 20 },
        },
      ],
      25: [
        {
          id: 'regex_25_left',
          name: '+30% Catastrophic Backtracking INTEG Removed',
          description:
            'Catastrophic Backtracking (R) removes 30% more INTEG from each enemy it hits',
          type: 'damage_boost',
          tier: 25,
          abilityId: 'r',
          damageBoost: 30,
        },
        {
          id: 'regex_25_right',
          name: 'Global Backtracking',
          description:
            'Catastrophic Backtracking (R) can target a hero in any zone — no range limit',
          type: 'special',
          tier: 25,
          abilityId: 'r',
          castEffect: 'global_ultimate',
          specialEffect: 'Global Backtracking (R) — target a hero in any zone, no range limit',
        },
      ],
    },
  },

  // Fill in remaining heroes with basic talents
  firewall: {
    heroId: 'firewall',
    tiers: {
      10: [
        {
          id: 'firewall_10_left',
          name: '+250 INTEG',
          description: '+250 INTEG — more health to hold the front line after Access Control',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'integ', value: 250 },
        },
        {
          id: 'firewall_10_right',
          name: '+20 Plate',
          description: '+20 Plate — less kinetic damage taken while the taunt holds',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'plate', value: 20 },
        },
      ],
      15: [
        {
          id: 'firewall_15_left',
          name: 'Port Block Costs 30% Less BW',
          description: 'Reduces Port Block BW cost by 30%',
          type: 'bw_cost_reduce',
          tier: 15,
          abilityId: 'q',
          bwCostReduction: 30,
        },
        {
          id: 'firewall_15_right',
          name: '-3 Cycles DMZ CD',
          description: 'DMZ (shield) cooldown reduced by 3 cycles',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'w',
          cooldownReduction: 3,
        },
      ],
      20: [
        {
          id: 'firewall_20_left',
          name: '+35% Port Block INTEG Removed',
          description: 'Port Block (Q) removes 35% more INTEG from each enemy it hits',
          type: 'damage_boost',
          tier: 20,
          abilityId: 'q',
          damageBoost: 35,
        },
        {
          id: 'firewall_20_right',
          name: '+400 INTEG',
          description: '+400 INTEG — more health to soak what Access Control pulls onto you',
          type: 'stat_bonus',
          tier: 20,
          statBonus: { stat: 'integ', value: 400 },
        },
      ],
      25: [
        {
          id: 'firewall_25_left',
          name: '-12 Cycles Deep Packet Inspection CD',
          description: 'Deep Packet Inspection (root) cooldown reduced by 12 cycles',
          type: 'cooldown_reduce',
          tier: 25,
          abilityId: 'r',
          cooldownReduction: 12,
        },
        {
          id: 'firewall_25_right',
          name: '+25 ICE',
          description: '+25 ICE — less code damage taken from enemy casters',
          type: 'stat_bonus',
          tier: 25,
          statBonus: { stat: 'ice', value: 25 },
        },
      ],
    },
  },

  proxy: {
    heroId: 'proxy',
    tiers: {
      10: [
        {
          id: 'proxy_10_left',
          name: '+100 BW',
          description: '+100 BW — more bandwidth for Cache Shield and Load Balance',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'bw', value: 100 },
        },
        {
          id: 'proxy_10_right',
          name: '+10 Attack',
          description: '+10 Attack — raises basic-attack damage between casts',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'attack', value: 10 },
        },
      ],
      15: [
        {
          id: 'proxy_15_left',
          name: '-2 Cycles Packet Redirect CD',
          description: 'Packet Redirect cooldown reduced by 2 cycles',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'q',
          cooldownReduction: 2,
        },
        {
          id: 'proxy_15_right',
          name: 'Cache Shield Costs 20% Less BW',
          description: 'Reduces Cache Shield BW cost by 20%',
          type: 'bw_cost_reduce',
          tier: 15,
          abilityId: 'w',
          bwCostReduction: 20,
        },
      ],
      20: [
        {
          id: 'proxy_20_left',
          name: '+50% Packet Redirect INTEG Removed',
          description: 'Packet Redirect (Q) removes 50% more INTEG from each enemy it hits',
          type: 'damage_boost',
          tier: 20,
          abilityId: 'q',
          damageBoost: 50,
        },
        {
          id: 'proxy_20_right',
          name: '+15 ICE',
          description: '+15 ICE — less code damage taken by the support soaking for the team',
          type: 'stat_bonus',
          tier: 20,
          statBonus: { stat: 'ice', value: 15 },
        },
      ],
      25: [
        {
          id: 'proxy_25_left',
          name: '-12 Cycles Reverse Proxy CD',
          description: 'Reverse Proxy (swap) cooldown reduced by 12 cycles',
          type: 'cooldown_reduce',
          tier: 25,
          abilityId: 'r',
          cooldownReduction: 12,
        },
        {
          id: 'proxy_25_right',
          name: '+250 Max BW',
          description: '+250 Max BW — a deeper pool for Reverse Proxy and the rest of the kit',
          type: 'stat_bonus',
          tier: 25,
          statBonus: { stat: 'bw', value: 250 },
        },
      ],
    },
  },

  // Hero-tailored trees (replacing the bland generic menu, one hero at a time).
  // Malloc — a line carry built around its Free() execute, Pointer Dereference
  // gap-close, and Stack Overflow AoE ult. (Q Allocate is a self-buff with no
  // instant damage, so it carries NO damage_boost talent — that would be a no-op.)
  malloc: {
    heroId: 'malloc',
    tiers: {
      10: [
        {
          id: 'malloc_10_left',
          name: '+15 Attack Damage',
          description: '+15 Attack — feeds the Heap Growth carry pattern',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'attack', value: 15 },
        },
        {
          id: 'malloc_10_right',
          name: '+250 INTEG',
          description: '+250 INTEG for the line dive',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'integ', value: 250 },
        },
      ],
      15: [
        {
          id: 'malloc_15_left',
          name: '+30% Free() INTEG Removed',
          description: 'Free() (W) removes 30% more INTEG from each enemy it hits',
          type: 'damage_boost',
          tier: 15,
          abilityId: 'w',
          damageBoost: 30,
        },
        {
          id: 'malloc_15_right',
          name: '-2 Cycles Pointer Dereference CD',
          description:
            'Pointer Dereference (E) cooldown reduced by 2 cycles — dash + stun more often',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'e',
          cooldownReduction: 2,
        },
      ],
      20: [
        {
          id: 'malloc_20_left',
          name: '+40% Stack Overflow INTEG Removed',
          description: 'Stack Overflow (R) removes 40% more INTEG from each enemy it hits',
          type: 'damage_boost',
          tier: 20,
          abilityId: 'r',
          damageBoost: 40,
        },
        {
          id: 'malloc_20_right',
          name: '+350 INTEG',
          description: '+350 INTEG — a bigger pool for the late line dive',
          type: 'stat_bonus',
          tier: 20,
          statBonus: { stat: 'integ', value: 350 },
        },
      ],
      25: [
        {
          id: 'malloc_25_left',
          name: '-10 Cycles Stack Overflow CD',
          description: 'Stack Overflow (R) ultimate cooldown reduced by 10 cycles',
          type: 'cooldown_reduce',
          tier: 25,
          abilityId: 'r',
          cooldownReduction: 10,
        },
        {
          id: 'malloc_25_right',
          name: '+20 ICE',
          description: '+20 ICE — survive enemy nukes',
          type: 'stat_bonus',
          tier: 25,
          statBonus: { stat: 'ice', value: 20 },
        },
      ],
    },
  },
  // Cipher — a burst assassin around XOR Strike (Q) and Brute Force (R) nukes,
  // Encrypt (W) stealth, and fragile-carry stats. damage_boost sits on Q/R only
  // (W is a self-stealth, E a silence — neither deals instant damage).
  cipher: {
    heroId: 'cipher',
    tiers: {
      10: [
        {
          id: 'cipher_10_left',
          name: '+12 Attack Damage',
          description: '+12 Attack — feeds the kinetic half of XOR Strike + right-clicks',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'attack', value: 12 },
        },
        {
          id: 'cipher_10_right',
          name: '+200 INTEG',
          description: '+200 INTEG for the fragile assassin',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'integ', value: 200 },
        },
      ],
      15: [
        {
          id: 'cipher_15_left',
          name: '+30% XOR Strike INTEG Removed',
          description: 'XOR Strike (Q) removes 30% more INTEG from each enemy it hits',
          type: 'damage_boost',
          tier: 15,
          abilityId: 'q',
          damageBoost: 30,
        },
        {
          id: 'cipher_15_right',
          name: '-2 Cycles Encrypt CD',
          description: 'Encrypt (W) stealth cooldown reduced by 2 cycles — reposition more often',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'w',
          cooldownReduction: 2,
        },
      ],
      20: [
        {
          id: 'cipher_20_left',
          name: '+40% Brute Force INTEG Removed',
          description: 'Brute Force (R) removes 40% more INTEG from each enemy it hits',
          type: 'damage_boost',
          tier: 20,
          abilityId: 'r',
          damageBoost: 40,
        },
        {
          id: 'cipher_20_right',
          name: '+250 INTEG',
          description: '+250 INTEG — more health for the fragile assassin',
          type: 'stat_bonus',
          tier: 20,
          statBonus: { stat: 'integ', value: 250 },
        },
      ],
      25: [
        {
          id: 'cipher_25_left',
          name: '-10 Cycles Brute Force CD',
          description: 'Brute Force (R) ultimate cooldown reduced by 10 cycles',
          type: 'cooldown_reduce',
          tier: 25,
          abilityId: 'r',
          cooldownReduction: 10,
        },
        {
          id: 'cipher_25_right',
          name: '+18 ICE',
          description: '+18 ICE — less code damage taken',
          type: 'stat_bonus',
          tier: 25,
          statBonus: { stat: 'ice', value: 18 },
        },
      ],
    },
  },
  // Sentry — a pure support (Mend heal, Barrier shield, Scan Pulse slow, Fortify
  // team-shield). NONE of its abilities deal instant damage, so it carries NO
  // damage_boost talents (the generic +Q-damage was 100% dead here); instead its
  // tree is cooldown/BW efficiency on the kit + tanky-support stats.
  sentry: {
    heroId: 'sentry',
    tiers: {
      10: [
        {
          id: 'sentry_10_left',
          name: '+250 INTEG',
          description: '+250 INTEG — survive while peeling for the team',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'integ', value: 250 },
        },
        {
          id: 'sentry_10_right',
          name: '+15 ICE',
          description: '+15 ICE — less code damage taken while peeling for the team',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'ice', value: 15 },
        },
      ],
      15: [
        {
          id: 'sentry_15_left',
          name: '-2 Cycles Mend Protocol CD',
          description:
            'Mend Protocol (Q) heal cooldown reduced by 2 cycles — top allies up more often',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'q',
          cooldownReduction: 2,
        },
        {
          id: 'sentry_15_right',
          name: '-35% Barrier BW',
          description: 'Refunds 35% of Barrier (W) BW — sustain more shields',
          type: 'bw_cost_reduce',
          tier: 15,
          abilityId: 'w',
          bwCostReduction: 35,
        },
      ],
      20: [
        {
          id: 'sentry_20_left',
          name: '-3 Cycles Scan Pulse CD',
          description: 'Scan Pulse (E) cooldown reduced by 3 cycles — more reveals + slows',
          type: 'cooldown_reduce',
          tier: 20,
          abilityId: 'e',
          cooldownReduction: 3,
        },
        {
          id: 'sentry_20_right',
          name: '+300 Max BW',
          description: '+300 Max BW — a deeper pool for sustained support',
          type: 'stat_bonus',
          tier: 20,
          statBonus: { stat: 'bw', value: 300 },
        },
      ],
      25: [
        {
          id: 'sentry_25_left',
          name: '-12 Cycles Fortify CD',
          description: 'Fortify (R) team-shield ultimate cooldown reduced by 12 cycles',
          type: 'cooldown_reduce',
          tier: 25,
          abilityId: 'r',
          cooldownReduction: 12,
        },
        {
          id: 'sentry_25_right',
          name: '+10 Plate',
          description: '+10 Plate — reinforces the Overwatch plate aura',
          type: 'stat_bonus',
          tier: 25,
          statBonus: { stat: 'plate', value: 10 },
        },
      ],
    },
  },
  // Socket — an offlaner disruptor: Bind (root), Listen (trap), Accept (pull),
  // Broadcast (global slow). No instant-cast damage (Listen's damage is dealt
  // LATER by the trap when triggered, not during the W cast), so NO damage_boost;
  // the tree is cooldown efficiency across its disable kit + tanky offlaner stats
  // (and +attack to feed the link-stack passive).
  socket: {
    heroId: 'socket',
    tiers: {
      10: [
        {
          id: 'socket_10_left',
          name: '+250 INTEG',
          description: '+250 INTEG for the front-line offlaner',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'integ', value: 250 },
        },
        {
          id: 'socket_10_right',
          name: '+12 Attack Damage',
          description: '+12 Attack — applies Persistent Connection link stacks faster',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'attack', value: 12 },
        },
      ],
      15: [
        {
          id: 'socket_15_left',
          name: '-3 Cycles Bind CD',
          description: 'Bind (Q) root cooldown reduced by 3 cycles — lock targets down more often',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'q',
          cooldownReduction: 3,
        },
        {
          id: 'socket_15_right',
          name: '-4 Cycles Listen CD',
          description: 'Listen (W) trap cooldown reduced by 4 cycles — keep more traps armed',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'w',
          cooldownReduction: 4,
        },
      ],
      20: [
        {
          id: 'socket_20_left',
          name: '-5 Cycles Accept CD',
          description: 'Accept (E) pull cooldown reduced by 5 cycles — drag enemies in more often',
          type: 'cooldown_reduce',
          tier: 20,
          abilityId: 'e',
          cooldownReduction: 5,
        },
        {
          id: 'socket_20_right',
          name: '+10 Plate',
          description: '+10 Plate — tankier initiator',
          type: 'stat_bonus',
          tier: 20,
          statBonus: { stat: 'plate', value: 10 },
        },
      ],
      25: [
        {
          id: 'socket_25_left',
          name: '-12 Cycles Broadcast CD',
          description: 'Broadcast (R) global-slow ultimate cooldown reduced by 12 cycles',
          type: 'cooldown_reduce',
          tier: 25,
          abilityId: 'r',
          cooldownReduction: 12,
        },
        {
          id: 'socket_25_right',
          name: '+18 ICE',
          description: '+18 ICE — less code damage taken',
          type: 'stat_bonus',
          tier: 25,
          statBonus: { stat: 'ice', value: 18 },
        },
      ],
    },
  },
  // Mutex — a tanky offlaner that snowballs by holding ground (Deadlock passive).
  // Instant-damage abilities: Lock (Q nuke+root), Spinlock (E 3-hit AoE), Priority
  // Inversion (R AoE fear). W (Critical Section) is a self-shield, no damage. Tree
  // boosts Q/R damage, speeds Spinlock + the ult, and stacks tank stats.
  mutex: {
    heroId: 'mutex',
    tiers: {
      10: [
        {
          id: 'mutex_10_left',
          name: '+300 INTEG',
          description: '+300 INTEG — hold the line longer',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'integ', value: 300 },
        },
        {
          id: 'mutex_10_right',
          name: '+12 Attack Damage',
          description: '+12 Attack — compounds with Deadlock stacks',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'attack', value: 12 },
        },
      ],
      15: [
        {
          id: 'mutex_15_left',
          name: '+30% Lock INTEG Removed',
          description: 'Lock (Q) removes 30% more INTEG from each enemy it hits',
          type: 'damage_boost',
          tier: 15,
          abilityId: 'q',
          damageBoost: 30,
        },
        {
          id: 'mutex_15_right',
          name: '-2 Cycles Spinlock CD',
          description: 'Spinlock (E) cooldown reduced by 2 cycles — more AoE strikes + slows',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'e',
          cooldownReduction: 2,
        },
      ],
      20: [
        {
          id: 'mutex_20_left',
          name: '+40% Priority Inversion INTEG Removed',
          description: 'Priority Inversion (R) removes 40% more INTEG from each enemy it hits',
          type: 'damage_boost',
          tier: 20,
          abilityId: 'r',
          damageBoost: 40,
        },
        {
          id: 'mutex_20_right',
          name: '+12 Plate',
          description: '+12 Plate — synergises with the Deadlock tank stacks',
          type: 'stat_bonus',
          tier: 20,
          statBonus: { stat: 'plate', value: 12 },
        },
      ],
      25: [
        {
          id: 'mutex_25_left',
          name: '-12 Cycles Priority Inversion CD',
          description: 'Priority Inversion (R) fear ultimate cooldown reduced by 12 cycles',
          type: 'cooldown_reduce',
          tier: 25,
          abilityId: 'r',
          cooldownReduction: 12,
        },
        {
          id: 'mutex_25_right',
          name: '+20 ICE',
          description: '+20 ICE — less code damage taken',
          type: 'stat_bonus',
          tier: 25,
          statBonus: { stat: 'ice', value: 20 },
        },
      ],
    },
  },
  // Thread — a splash right-click carry (Multithread). Its damage is mostly basic
  // attacks (+ the Thread Pool ult making them AoE), so the tree leans on +attack;
  // only Fork (Q) deals instant ability damage (W Sync Barrier + R Thread Pool are
  // self-buffs, E Yield a vuln debuff), so damage_boost sits on Q alone.
  thread: {
    heroId: 'thread',
    tiers: {
      10: [
        {
          id: 'thread_10_left',
          name: '+15 Attack Damage',
          description: '+15 Attack — more right-click + Multithread splash',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'attack', value: 15 },
        },
        {
          id: 'thread_10_right',
          name: '+200 INTEG',
          description: '+200 INTEG for the fragile carry',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'integ', value: 200 },
        },
      ],
      15: [
        {
          id: 'thread_15_left',
          name: '+30% Fork INTEG Removed',
          description: 'Fork (Q) removes 30% more INTEG from each enemy it hits',
          type: 'damage_boost',
          tier: 15,
          abilityId: 'q',
          damageBoost: 30,
        },
        {
          id: 'thread_15_right',
          name: '-2 Cycles Sync Barrier CD',
          description: 'Sync Barrier (W) shield cooldown reduced by 2 cycles',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'w',
          cooldownReduction: 2,
        },
      ],
      20: [
        {
          id: 'thread_20_left',
          name: '+20 Attack Damage',
          description: '+20 Attack — scales the splash carry into the late game',
          type: 'stat_bonus',
          tier: 20,
          statBonus: { stat: 'attack', value: 20 },
        },
        {
          id: 'thread_20_right',
          name: '-2 Cycles Yield CD',
          description: 'Yield (E) mark cooldown reduced by 2 cycles — keep targets vulnerable',
          type: 'cooldown_reduce',
          tier: 20,
          abilityId: 'e',
          cooldownReduction: 2,
        },
      ],
      25: [
        {
          id: 'thread_25_left',
          name: '-12 Cycles Thread Pool CD',
          description: 'Thread Pool (R) AoE-attack ultimate cooldown reduced by 12 cycles',
          type: 'cooldown_reduce',
          tier: 25,
          abilityId: 'r',
          cooldownReduction: 12,
        },
        {
          id: 'thread_25_right',
          name: '+18 ICE',
          description: '+18 ICE — less code damage taken',
          type: 'stat_bonus',
          tier: 25,
          statBonus: { stat: 'ice', value: 18 },
        },
      ],
    },
  },
  // Lambda — a combo-chaining code-burst mage (Closure rewards rapid casting).
  // Invoke (Q), Map (E) and Reduce (R) all deal INSTANT code damage at cast, so
  // damage_boost lives on Q/E/R. Return (W) is a delayed self-teleport (no damage) —
  // it only ever gets cooldown_reduce / bw_cost_reduce, never damage_boost.
  lambda: {
    heroId: 'lambda',
    tiers: {
      10: [
        {
          id: 'lambda_10_left',
          name: '+300 BW',
          description: '+300 BW — fuel longer Closure combo chains',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'bw', value: 300 },
        },
        {
          id: 'lambda_10_right',
          name: '+250 INTEG',
          description: '+250 INTEG for the fragile mage',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'integ', value: 250 },
        },
      ],
      15: [
        {
          id: 'lambda_15_left',
          name: '+35% Invoke INTEG Removed',
          description: 'Invoke (Q) removes 35% more INTEG from each enemy it hits',
          type: 'damage_boost',
          tier: 15,
          abilityId: 'q',
          damageBoost: 35,
        },
        {
          id: 'lambda_15_right',
          name: '-3 Cycles Map CD',
          description: 'Map (E) cooldown reduced by 3 cycles — slow + nuke the zone more often',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'e',
          cooldownReduction: 3,
        },
      ],
      20: [
        {
          id: 'lambda_20_left',
          name: '+40% Map INTEG Removed',
          description: 'Map (E) removes 40% more INTEG from each enemy it hits',
          type: 'damage_boost',
          tier: 20,
          abilityId: 'e',
          damageBoost: 40,
        },
        {
          id: 'lambda_20_right',
          name: '-4 Cycles Return CD',
          description: 'Return (W) cooldown reduced by 4 cycles — reposition and escape more often',
          type: 'cooldown_reduce',
          tier: 20,
          abilityId: 'w',
          cooldownReduction: 4,
        },
      ],
      25: [
        {
          id: 'lambda_25_left',
          name: '-12 Cycles Reduce CD',
          description:
            'Reduce (R) ultimate cooldown reduced by 12 cycles — channel the nuke more often',
          type: 'cooldown_reduce',
          tier: 25,
          abilityId: 'r',
          cooldownReduction: 12,
        },
        {
          id: 'lambda_25_right',
          name: 'Double Cast',
          description: 'Invoke (Q) has a 25% chance to cast twice',
          type: 'special',
          tier: 25,
          abilityId: 'q',
          castEffect: 'double_cast',
          specialEffect: 'Double Cast (Q) — 25% chance to cast twice',
        },
      ],
    },
  },
  // Cron — a clockwork support: Uptime (Q) ally buff, Purge (W) cleanse+shield,
  // Kill Signal (E) kinetic nuke+taunt, Crontab (R) AoE heal/BW regen. Only
  // Kill Signal (E) deals instant cast damage, so it carries the lone damage_boost;
  // the rest of the tree is cooldown/BW efficiency on the support kit + tanky stats.
  cron: {
    heroId: 'cron',
    tiers: {
      10: [
        {
          id: 'cron_10_left',
          name: '+300 BW',
          description: '+300 BW — sustain the Crontab + Purge BW drain',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'bw', value: 300 },
        },
        {
          id: 'cron_10_right',
          name: '+250 INTEG',
          description: '+250 INTEG for the front-line line support',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'integ', value: 250 },
        },
      ],
      15: [
        {
          id: 'cron_15_left',
          name: '+35% Kill Signal INTEG Removed',
          description: 'Kill Signal (E) removes 35% more INTEG from each enemy it hits',
          type: 'damage_boost',
          tier: 15,
          abilityId: 'e',
          damageBoost: 35,
        },
        {
          id: 'cron_15_right',
          name: '-3 Cycles Uptime CD',
          description: 'Uptime (Q) cooldown reduced by 3 cycles — keep an ally buffed more often',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'q',
          cooldownReduction: 3,
        },
      ],
      20: [
        {
          id: 'cron_20_left',
          name: '-4 Cycles Purge CD',
          description:
            'Purge (W) cooldown reduced by 4 cycles — cleanse + shield allies more often',
          type: 'cooldown_reduce',
          tier: 20,
          abilityId: 'w',
          cooldownReduction: 4,
        },
        {
          id: 'cron_20_right',
          name: '-40% Kill Signal BW',
          description: 'Kill Signal (E) refunds 40% of its BW — spam the taunt cheaply',
          type: 'bw_cost_reduce',
          tier: 20,
          abilityId: 'e',
          bwCostReduction: 40,
        },
      ],
      25: [
        {
          id: 'cron_25_left',
          name: '-12 Cycles Crontab CD',
          description:
            'Crontab (R) ultimate cooldown reduced by 12 cycles — heal the team more often',
          type: 'cooldown_reduce',
          tier: 25,
          abilityId: 'r',
          cooldownReduction: 12,
        },
        {
          id: 'cron_25_right',
          name: '+18 ICE',
          description: '+18 ICE — survive enemy nukes while channeling support',
          type: 'stat_bonus',
          tier: 25,
          statBonus: { stat: 'ice', value: 18 },
        },
      ],
    },
  },
  // Traceroute — a roaming pick-off assassin built on Probe (Q) burst, a TTL (W)
  // delayed-root trap, a Next Hop (E) reposition, and Full Trace (R) reveal +
  // self damage-amp. Only Probe (Q) deals instant damage at cast, so damage_boost
  // sits on Q ALONE; W is a delayed-root trap, E a self-hop buff, R a reveal +
  // self-buff (no instant damage) — those tiers use CD/BW/stat instead.
  traceroute: {
    heroId: 'traceroute',
    tiers: {
      10: [
        {
          id: 'traceroute_10_left',
          name: '+15 Attack Damage',
          description: '+15 Attack — sharpens Probe hits and Hop Count right-clicks',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'attack', value: 15 },
        },
        {
          id: 'traceroute_10_right',
          name: '+200 INTEG',
          description: '+200 INTEG to survive the dive between hops',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'integ', value: 200 },
        },
      ],
      15: [
        {
          id: 'traceroute_15_left',
          name: '+35% Probe INTEG Removed',
          description: 'Probe (Q) removes 35% more INTEG from each enemy it hits',
          type: 'damage_boost',
          tier: 15,
          abilityId: 'q',
          damageBoost: 35,
        },
        {
          id: 'traceroute_15_right',
          name: '-3 Cycles TTL CD',
          description: 'TTL (W) trap cooldown reduced by 3 cycles — lock down targets more often',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'w',
          cooldownReduction: 3,
        },
      ],
      20: [
        {
          id: 'traceroute_20_left',
          name: '-3 Cycles Next Hop CD',
          description:
            'Next Hop (E) cooldown reduced by 3 cycles — reposition and chase more often',
          type: 'cooldown_reduce',
          tier: 20,
          abilityId: 'e',
          cooldownReduction: 3,
        },
        {
          id: 'traceroute_20_right',
          name: '-40% Probe BW Cost',
          description: 'Probe (Q) refunds 40% BW — spam the trace without running dry',
          type: 'bw_cost_reduce',
          tier: 20,
          abilityId: 'q',
          bwCostReduction: 40,
        },
      ],
      25: [
        {
          id: 'traceroute_25_left',
          name: '-12 Cycles Full Trace CD',
          description:
            'Full Trace (R) ultimate cooldown reduced by 12 cycles — reveal + amp more often',
          type: 'cooldown_reduce',
          tier: 25,
          abilityId: 'r',
          cooldownReduction: 12,
        },
        {
          id: 'traceroute_25_right',
          name: '+18 ICE',
          description: '+18 ICE — survive enemy nukes on the dive',
          type: 'stat_bonus',
          tier: 25,
          statBonus: { stat: 'ice', value: 18 },
        },
      ],
    },
  },
  // null_ref — a void-drain burst mage built around Void Bolt (Q) and the Dereference (R)
  // execute nuke. damage_boost sits on Q/R only (both deal instant damage at cast); W is a
  // pure silence and E is a damage-over-time Void Zone — neither deals instant cast damage.
  null_ref: {
    heroId: 'null_ref',
    tiers: {
      10: [
        {
          id: 'null_ref_10_left',
          name: '+30% Void Bolt INTEG Removed',
          description: 'Void Bolt (Q) removes 30% more INTEG from each enemy it hits',
          type: 'damage_boost',
          tier: 10,
          abilityId: 'q',
          damageBoost: 30,
        },
        {
          id: 'null_ref_10_right',
          name: '+300 BW',
          description: '+300 BW — fuels the void-drain caster through fights',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'bw', value: 300 },
        },
      ],
      15: [
        {
          id: 'null_ref_15_left',
          name: '-2 Cycles Void Bolt CD',
          description: 'Void Bolt (Q) cooldown reduced by 2 cycles — chain the magic-resist shred',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'q',
          cooldownReduction: 2,
        },
        {
          id: 'null_ref_15_right',
          name: '-3 Cycles Null Pointer CD',
          description:
            'Null Pointer (W) silence cooldown reduced by 3 cycles — lock a caster more often',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'w',
          cooldownReduction: 3,
        },
      ],
      20: [
        {
          id: 'null_ref_20_left',
          name: '+40% Dereference INTEG Removed',
          description: 'Dereference (R) removes 40% more INTEG from each enemy it hits',
          type: 'damage_boost',
          tier: 20,
          abilityId: 'r',
          damageBoost: 40,
        },
        {
          id: 'null_ref_20_right',
          name: '-3 Cycles Void Zone CD',
          description: 'Void Zone (E) cooldown reduced by 3 cycles — keep the DoT + reveal up',
          type: 'cooldown_reduce',
          tier: 20,
          abilityId: 'e',
          cooldownReduction: 3,
        },
      ],
      25: [
        {
          id: 'null_ref_25_left',
          name: '-12 Cycles Dereference CD',
          description:
            'Dereference (R) ultimate cooldown reduced by 12 cycles — execute teamfights faster',
          type: 'cooldown_reduce',
          tier: 25,
          abilityId: 'r',
          cooldownReduction: 12,
        },
        {
          id: 'null_ref_25_right',
          name: 'Cascading Dereference',
          description: 'Dereference (R) also hits enemies in adjacent zones — wider AoE',
          type: 'special',
          tier: 25,
          abilityId: 'r',
          castEffect: 'aoe_bonus',
          specialEffect: 'Cascading Dereference (R) — AoE reaches adjacent zones',
        },
      ],
    },
  },
  // ping — a sweep disruptor offlaner built around ICMP Echo (Q) poke, Timeout (W) silence,
  // Tracepath (E) vision/speed, and the Flood (R) AoE DoT ult. Q is the ONLY instant-damage
  // ability, so damage_boost sits on Q alone; W is a silence, E a self-buff, and R a DoT —
  // none deal instant cast damage, so they're rewarded via cooldown_reduce / BW / stats.
  ping: {
    heroId: 'ping',
    tiers: {
      10: [
        {
          id: 'ping_10_left',
          name: '+30% ICMP Echo INTEG Removed',
          description: 'ICMP Echo (Q) removes 30% more INTEG from each enemy it hits',
          type: 'damage_boost',
          tier: 10,
          abilityId: 'q',
          damageBoost: 30,
        },
        {
          id: 'ping_10_right',
          name: '+200 INTEG',
          description: '+200 INTEG to survive the offlane harass',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'integ', value: 200 },
        },
      ],
      15: [
        {
          id: 'ping_15_left',
          name: '-3 Cycles ICMP Echo CD',
          description: 'ICMP Echo (Q) cooldown reduced by 3 cycles — relentless cross-zone poke',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'q',
          cooldownReduction: 3,
        },
        {
          id: 'ping_15_right',
          name: '-3 Cycles Timeout CD',
          description: 'Timeout (W) silence cooldown reduced by 3 cycles — lock down casters',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'w',
          cooldownReduction: 3,
        },
      ],
      20: [
        {
          id: 'ping_20_left',
          name: '+40% ICMP Echo INTEG Removed',
          description: 'ICMP Echo (Q) removes 40% more INTEG from each enemy it hits',
          type: 'damage_boost',
          tier: 20,
          abilityId: 'q',
          damageBoost: 40,
        },
        {
          id: 'ping_20_right',
          name: '+300 BW',
          description: '+300 BW to sustain endless probing and Flood',
          type: 'stat_bonus',
          tier: 20,
          statBonus: { stat: 'bw', value: 300 },
        },
      ],
      25: [
        {
          id: 'ping_25_left',
          name: '-12 Cycles Flood CD',
          description: 'Flood (R) ultimate cooldown reduced by 12 cycles — zone control more often',
          type: 'cooldown_reduce',
          tier: 25,
          abilityId: 'r',
          cooldownReduction: 12,
        },
        {
          id: 'ping_25_right',
          name: '+18 ICE',
          description: '+18 ICE — outlast enemy nukes',
          type: 'stat_bonus',
          tier: 25,
          statBonus: { stat: 'ice', value: 18 },
        },
      ],
    },
  },

  // cache — a tank that converts damage taken into cached energy for burst
  // abilities. Q Cache Hit (physical + cached energy) and R Eviction (black AoE)
  // both deal instant damage, so they carry damage_boost; W Flush (shield from
  // cached energy) and E Invalidate (magical + anti-heal) get cooldown/BW
  // efficiency. The stat tiers lean into tankiness (HP/plate/MR) to sustain the
  // damage-absorption playstyle.
  cache: {
    heroId: 'cache',
    tiers: {
      10: [
        {
          id: 'cache_10_left',
          name: '+300 INTEG',
          description: '+300 INTEG — absorb more punishment to store as cached energy',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'integ', value: 300 },
        },
        {
          id: 'cache_10_right',
          name: '+15 Plate',
          description: '+15 Plate — tank through enemy focus fire',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'plate', value: 15 },
        },
      ],
      15: [
        {
          id: 'cache_15_left',
          name: '+30% Cache Hit INTEG Removed',
          description: 'Cache Hit (Q) removes 30% more INTEG from each enemy it hits',
          type: 'damage_boost',
          tier: 15,
          abilityId: 'q',
          damageBoost: 30,
        },
        {
          id: 'cache_15_right',
          name: '-3 Cycles Flush CD',
          description:
            'Flush (W) shield cooldown reduced by 3 cycles — convert energy to plate more often',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'w',
          cooldownReduction: 3,
        },
      ],
      20: [
        {
          id: 'cache_20_left',
          name: '+40% Eviction INTEG Removed',
          description: 'Eviction (R) removes 40% more INTEG from each enemy it hits',
          type: 'damage_boost',
          tier: 20,
          abilityId: 'r',
          damageBoost: 40,
        },
        {
          id: 'cache_20_right',
          name: '-3 Cycles Invalidate CD',
          description: 'Invalidate (E) cooldown reduced by 3 cycles — more anti-heal + code burst',
          type: 'cooldown_reduce',
          tier: 20,
          abilityId: 'e',
          cooldownReduction: 3,
        },
      ],
      25: [
        {
          id: 'cache_25_left',
          name: '-12 Cycles Eviction CD',
          description:
            'Eviction (R) ultimate cooldown reduced by 12 cycles — unleash the cache more often',
          type: 'cooldown_reduce',
          tier: 25,
          abilityId: 'r',
          cooldownReduction: 12,
        },
        {
          id: 'cache_25_right',
          name: '+22 ICE',
          description: '+22 ICE — shrug off code nukes',
          type: 'stat_bonus',
          tier: 25,
          statBonus: { stat: 'ice', value: 22 },
        },
      ],
    },
  },
}

import { isHeroId } from '~~/shared/constants/heroes'

/**
 * Safe runtime lookup of a hero's talent tree by string ID.
 *
 * `TALENT_TREES` is typed `Record<HeroId, TalentTree>` for compile-time
 * exhaustiveness (adding a hero to the registry without a tree is a type
 * error). Player state and command parsing carry `heroId: string`, so this
 * helper provides the runtime narrowing needed at consumer sites.
 */
export function getTalentTree(heroId: string): TalentTree | undefined {
  return isHeroId(heroId) ? TALENT_TREES[heroId] : undefined
}
