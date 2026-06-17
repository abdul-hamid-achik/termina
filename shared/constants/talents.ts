/**
 * Talent Tree System
 * Binary choices at levels 10, 15, 20, 25
 * Each hero has unique talent options per tier
 */

import type { HeroId } from '~~/shared/types/hero'

export type TalentTier = 10 | 15 | 20 | 25

export type TalentType =
  | 'stat_bonus' // +X to a stat
  | 'ability_boost' // Enhances specific ability
  | 'cooldown_reduce' // -Xs cooldown on ability
  | 'mana_cost_reduce' // -X% mana cost
  | 'damage_boost' // +X% damage
  | 'special' // Unique hero-specific effect

export interface Talent {
  id: string
  name: string
  description: string
  type: TalentType
  tier: TalentTier
  // Stat bonuses
  statBonus?: {
    stat: 'hp' | 'mp' | 'attack' | 'defense' | 'magicResist' | 'moveSpeed' | 'attackSpeed'
    value: number
  }
  // Ability modifications
  abilityId?: 'q' | 'w' | 'e' | 'r'
  cooldownReduction?: number // ticks
  manaCostReduction?: number // percentage
  damageBoost?: number // percentage
  // Special effects
  specialEffect?: string // Description of unique effect
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
          name: '+200 HP',
          description: 'Increases maximum HP by 200',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'hp', value: 200 },
        },
      ],
      15: [
        {
          id: 'echo_15_left',
          name: '-2s Echo Stun CD',
          description: 'Echo Stun cooldown reduced by 2 seconds',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'q',
          cooldownReduction: 2,
        },
        {
          id: 'echo_15_right',
          name: '-2s Echo Location CD',
          description: 'Echo Location cooldown reduced by 2 seconds',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'w',
          cooldownReduction: 2,
        },
      ],
      20: [
        {
          id: 'echo_20_left',
          name: '+30% Echo Damage',
          description: 'Echo abilities deal 30% more damage',
          type: 'damage_boost',
          tier: 20,
          abilityId: 'q',
          damageBoost: 30,
        },
        {
          id: 'echo_20_right',
          name: '+15% Magic Resistance',
          description: 'Increases magic resistance by 15%',
          type: 'stat_bonus',
          tier: 20,
          statBonus: { stat: 'magicResist', value: 15 },
        },
      ],
      25: [
        {
          id: 'echo_25_left',
          name: '+40% Echo Ultimate Damage',
          description: 'Echo Ultimate deals 40% more damage',
          type: 'damage_boost',
          tier: 25,
          abilityId: 'r',
          damageBoost: 40,
        },
        {
          id: 'echo_25_right',
          name: '+250 Max HP',
          description: 'Increases maximum HP by 250',
          type: 'stat_bonus',
          tier: 25,
          statBonus: { stat: 'hp', value: 250 },
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
          // combat, like moveSpeed), so the talent did nothing. Retargeted to
          // +12 Attack (a functional, engine-consumed stat) to keep this the
          // offensive choice opposite the +8 Magic Resistance option.
          id: 'daemon_10_left',
          name: '+12 Attack',
          description: 'Increases attack damage by 12',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'attack', value: 12 },
        },
        {
          id: 'daemon_10_right',
          name: '+8 Magic Resistance',
          description: 'Increases magic resistance by 8',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'magicResist', value: 8 },
        },
      ],
      15: [
        {
          id: 'daemon_15_left',
          name: 'Inject Costs 35% Less Mana',
          description: 'Reduces Inject mana cost by 35%',
          type: 'mana_cost_reduce',
          tier: 15,
          abilityId: 'q',
          manaCostReduction: 35,
        },
        {
          id: 'daemon_15_right',
          name: '-3s Fork Bomb CD',
          description: 'Fork Bomb cooldown reduced by 3 seconds',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'w',
          cooldownReduction: 3,
        },
      ],
      20: [
        {
          id: 'daemon_20_left',
          name: '-3s Sudo Cooldown',
          description: 'Sudo (execute) cooldown reduced by 3 seconds',
          type: 'cooldown_reduce',
          tier: 20,
          abilityId: 'e',
          cooldownReduction: 3,
        },
        {
          id: 'daemon_20_right',
          name: '+250 HP',
          description: 'Increases maximum HP by 250',
          type: 'stat_bonus',
          tier: 20,
          statBonus: { stat: 'hp', value: 250 },
        },
      ],
      25: [
        {
          id: 'daemon_25_left',
          name: '-10s Root Access CD',
          description: 'Root Access (teleport) cooldown reduced by 10 seconds',
          type: 'cooldown_reduce',
          tier: 25,
          abilityId: 'r',
          cooldownReduction: 10,
        },
        {
          id: 'daemon_25_right',
          name: '+50 Attack Damage',
          description: 'Increases attack damage by 50',
          type: 'stat_bonus',
          tier: 25,
          statBonus: { stat: 'attack', value: 50 },
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
          name: '+200 HP',
          description: '+200 HP',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'hp', value: 200 },
        },
        {
          id: 'kernel_10_right',
          name: '+15 Defense',
          description: '+15 Defense',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'defense', value: 15 },
        },
      ],
      15: [
        {
          id: 'kernel_15_left',
          name: 'Interrupt Costs 40% Less Mana',
          description: 'Reduces Interrupt mana cost by 40%',
          type: 'mana_cost_reduce',
          tier: 15,
          abilityId: 'q',
          manaCostReduction: 40,
        },
        {
          id: 'kernel_15_right',
          name: '-4s Buffer CD',
          description: 'Buffer (shield) cooldown reduced by 4 seconds',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'w',
          cooldownReduction: 4,
        },
      ],
      20: [
        {
          id: 'kernel_20_left',
          name: '-3s Core Dump CD',
          description: 'Core Dump (taunt) cooldown reduced by 3 seconds',
          type: 'cooldown_reduce',
          tier: 20,
          abilityId: 'e',
          cooldownReduction: 3,
        },
        {
          id: 'kernel_20_right',
          name: '+300 HP',
          description: '+300 HP',
          type: 'stat_bonus',
          tier: 20,
          statBonus: { stat: 'hp', value: 300 },
        },
      ],
      25: [
        {
          id: 'kernel_25_left',
          name: '-10s Panic CD',
          description: 'Panic (fear) cooldown reduced by 10 seconds',
          type: 'cooldown_reduce',
          tier: 25,
          abilityId: 'r',
          cooldownReduction: 10,
        },
        {
          id: 'kernel_25_right',
          name: '+20 Magic Resistance',
          description: 'Increases magic resistance by 20',
          type: 'stat_bonus',
          tier: 25,
          statBonus: { stat: 'magicResist', value: 20 },
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
          name: '+150 MP',
          description: '+150 MP',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'mp', value: 150 },
        },
        {
          id: 'regex_10_right',
          name: '+12 Attack',
          description: '+12 Attack',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'attack', value: 12 },
        },
      ],
      15: [
        {
          id: 'regex_15_left',
          name: '+40% Match Damage',
          description: 'Match deals 40% more damage',
          type: 'damage_boost',
          tier: 15,
          abilityId: 'q',
          damageBoost: 40,
        },
        {
          id: 'regex_15_right',
          name: 'Match Costs 15% Less Mana',
          description: 'Reduces Match mana cost by 15%',
          type: 'mana_cost_reduce',
          tier: 15,
          abilityId: 'q',
          manaCostReduction: 15,
        },
      ],
      20: [
        {
          id: 'regex_20_left',
          name: '-2s Capture Group CD',
          description: 'Capture Group (root) cooldown reduced by 2 seconds',
          type: 'cooldown_reduce',
          tier: 20,
          abilityId: 'w',
          cooldownReduction: 2,
        },
        {
          id: 'regex_20_right',
          name: '+20% Magic Resist',
          description: '+20% Magic Resist',
          type: 'stat_bonus',
          tier: 20,
          statBonus: { stat: 'magicResist', value: 20 },
        },
      ],
      25: [
        {
          id: 'regex_25_left',
          name: '+30% Backtracking Damage',
          description: 'Catastrophic Backtracking deals 30% more damage',
          type: 'damage_boost',
          tier: 25,
          abilityId: 'r',
          damageBoost: 30,
        },
        {
          id: 'regex_25_right',
          name: '-12s Backtracking CD',
          description: 'Catastrophic Backtracking cooldown reduced by 12 seconds',
          type: 'cooldown_reduce',
          tier: 25,
          abilityId: 'r',
          cooldownReduction: 12,
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
          name: '+250 HP',
          description: '+250 HP',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'hp', value: 250 },
        },
        {
          id: 'firewall_10_right',
          name: '+20 Defense',
          description: '+20 Defense',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'defense', value: 20 },
        },
      ],
      15: [
        {
          id: 'firewall_15_left',
          name: 'Port Block Costs 30% Less Mana',
          description: 'Reduces Port Block mana cost by 30%',
          type: 'mana_cost_reduce',
          tier: 15,
          abilityId: 'q',
          manaCostReduction: 30,
        },
        {
          id: 'firewall_15_right',
          name: '-3s DMZ CD',
          description: 'DMZ (shield) cooldown reduced by 3 seconds',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'w',
          cooldownReduction: 3,
        },
      ],
      20: [
        {
          id: 'firewall_20_left',
          name: '+35% Port Block Damage',
          description: 'Port Block deals 35% more damage',
          type: 'damage_boost',
          tier: 20,
          abilityId: 'q',
          damageBoost: 35,
        },
        {
          id: 'firewall_20_right',
          name: '+400 HP',
          description: '+400 HP',
          type: 'stat_bonus',
          tier: 20,
          statBonus: { stat: 'hp', value: 400 },
        },
      ],
      25: [
        {
          id: 'firewall_25_left',
          name: '-12s Deep Packet CD',
          description: 'Deep Packet Inspection (root) cooldown reduced by 12 seconds',
          type: 'cooldown_reduce',
          tier: 25,
          abilityId: 'r',
          cooldownReduction: 12,
        },
        {
          id: 'firewall_25_right',
          name: '+25 Magic Resistance',
          description: 'Increases magic resistance by 25',
          type: 'stat_bonus',
          tier: 25,
          statBonus: { stat: 'magicResist', value: 25 },
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
          name: '+100 MP',
          description: '+100 MP',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'mp', value: 100 },
        },
        {
          id: 'proxy_10_right',
          name: '+10 Attack',
          description: '+10 Attack',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'attack', value: 10 },
        },
      ],
      15: [
        {
          id: 'proxy_15_left',
          name: '-2s Packet Redirect CD',
          description: 'Packet Redirect cooldown reduced by 2 seconds',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'q',
          cooldownReduction: 2,
        },
        {
          id: 'proxy_15_right',
          name: 'Cache Shield Costs 20% Less Mana',
          description: 'Reduces Cache Shield mana cost by 20%',
          type: 'mana_cost_reduce',
          tier: 15,
          abilityId: 'w',
          manaCostReduction: 20,
        },
      ],
      20: [
        {
          id: 'proxy_20_left',
          name: '+50% Packet Redirect Damage',
          description: 'Packet Redirect deals 50% more damage',
          type: 'damage_boost',
          tier: 20,
          abilityId: 'q',
          damageBoost: 50,
        },
        {
          id: 'proxy_20_right',
          name: '+15% Magic Resist',
          description: '+15% Magic Resist',
          type: 'stat_bonus',
          tier: 20,
          statBonus: { stat: 'magicResist', value: 15 },
        },
      ],
      25: [
        {
          id: 'proxy_25_left',
          name: '-12s Reverse Proxy CD',
          description: 'Reverse Proxy (swap) cooldown reduced by 12 seconds',
          type: 'cooldown_reduce',
          tier: 25,
          abilityId: 'r',
          cooldownReduction: 12,
        },
        {
          id: 'proxy_25_right',
          name: '+250 Max MP',
          description: 'Increases maximum MP by 250',
          type: 'stat_bonus',
          tier: 25,
          statBonus: { stat: 'mp', value: 250 },
        },
      ],
    },
  },

  // Hero-tailored trees (replacing the bland generic menu, one hero at a time).
  // Malloc — a melee carry built around its Free() execute, Pointer Dereference
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
          name: '+250 HP',
          description: '+250 HP for the melee dive',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'hp', value: 250 },
        },
      ],
      15: [
        {
          id: 'malloc_15_left',
          name: '+30% Free() Damage',
          description: 'Free() (W) deals 30% more — a bigger execute',
          type: 'damage_boost',
          tier: 15,
          abilityId: 'w',
          damageBoost: 30,
        },
        {
          id: 'malloc_15_right',
          name: '-2s Pointer Dereference CD',
          description: 'Pointer Dereference (E) cooldown reduced — dash + stun more often',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'e',
          cooldownReduction: 2,
        },
      ],
      20: [
        {
          id: 'malloc_20_left',
          name: '+40% Stack Overflow Damage',
          description: 'Stack Overflow (R) AoE deals 40% more',
          type: 'damage_boost',
          tier: 20,
          abilityId: 'r',
          damageBoost: 40,
        },
        {
          id: 'malloc_20_right',
          name: '+350 HP',
          description: '+350 HP',
          type: 'stat_bonus',
          tier: 20,
          statBonus: { stat: 'hp', value: 350 },
        },
      ],
      25: [
        {
          id: 'malloc_25_left',
          name: '-10s Stack Overflow CD',
          description: 'Stack Overflow (R) ultimate cooldown reduced',
          type: 'cooldown_reduce',
          tier: 25,
          abilityId: 'r',
          cooldownReduction: 10,
        },
        {
          id: 'malloc_25_right',
          name: '+20 Magic Resistance',
          description: '+20 Magic Resistance — survive enemy nukes',
          type: 'stat_bonus',
          tier: 25,
          statBonus: { stat: 'magicResist', value: 20 },
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
          description: '+12 Attack — feeds the physical half of XOR Strike + right-clicks',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'attack', value: 12 },
        },
        {
          id: 'cipher_10_right',
          name: '+200 HP',
          description: '+200 HP for the fragile assassin',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'hp', value: 200 },
        },
      ],
      15: [
        {
          id: 'cipher_15_left',
          name: '+30% XOR Strike Damage',
          description: 'XOR Strike (Q) deals 30% more burst',
          type: 'damage_boost',
          tier: 15,
          abilityId: 'q',
          damageBoost: 30,
        },
        {
          id: 'cipher_15_right',
          name: '-2s Encrypt CD',
          description: 'Encrypt (W) stealth cooldown reduced — reposition more often',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'w',
          cooldownReduction: 2,
        },
      ],
      20: [
        {
          id: 'cipher_20_left',
          name: '+40% Brute Force Damage',
          description: 'Brute Force (R) deals 40% more across its 6 strikes',
          type: 'damage_boost',
          tier: 20,
          abilityId: 'r',
          damageBoost: 40,
        },
        {
          id: 'cipher_20_right',
          name: '+250 HP',
          description: '+250 HP',
          type: 'stat_bonus',
          tier: 20,
          statBonus: { stat: 'hp', value: 250 },
        },
      ],
      25: [
        {
          id: 'cipher_25_left',
          name: '-10s Brute Force CD',
          description: 'Brute Force (R) ultimate cooldown reduced',
          type: 'cooldown_reduce',
          tier: 25,
          abilityId: 'r',
          cooldownReduction: 10,
        },
        {
          id: 'cipher_25_right',
          name: '+18 Magic Resistance',
          description: '+18 Magic Resistance',
          type: 'stat_bonus',
          tier: 25,
          statBonus: { stat: 'magicResist', value: 18 },
        },
      ],
    },
  },
  // Sentry — a pure support (Mend heal, Barrier shield, Scan Pulse slow, Fortify
  // team-shield). NONE of its abilities deal instant damage, so it carries NO
  // damage_boost talents (the generic +Q-damage was 100% dead here); instead its
  // tree is cooldown/mana efficiency on the kit + tanky-support stats.
  sentry: {
    heroId: 'sentry',
    tiers: {
      10: [
        {
          id: 'sentry_10_left',
          name: '+250 HP',
          description: '+250 HP — survive while peeling for the team',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'hp', value: 250 },
        },
        {
          id: 'sentry_10_right',
          name: '+15 Magic Resistance',
          description: '+15 Magic Resistance',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'magicResist', value: 15 },
        },
      ],
      15: [
        {
          id: 'sentry_15_left',
          name: '-2s Mend Protocol CD',
          description: 'Mend Protocol (Q) heal cooldown reduced — top allies up more often',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'q',
          cooldownReduction: 2,
        },
        {
          id: 'sentry_15_right',
          name: '-35% Barrier Mana',
          description: 'Refunds 35% of Barrier (W) mana — sustain more shields',
          type: 'mana_cost_reduce',
          tier: 15,
          abilityId: 'w',
          manaCostReduction: 35,
        },
      ],
      20: [
        {
          id: 'sentry_20_left',
          name: '-3s Scan Pulse CD',
          description: 'Scan Pulse (E) cooldown reduced — more reveals + slows',
          type: 'cooldown_reduce',
          tier: 20,
          abilityId: 'e',
          cooldownReduction: 3,
        },
        {
          id: 'sentry_20_right',
          name: '+300 Max Mana',
          description: '+300 Max Mana — a deeper pool for sustained support',
          type: 'stat_bonus',
          tier: 20,
          statBonus: { stat: 'mp', value: 300 },
        },
      ],
      25: [
        {
          id: 'sentry_25_left',
          name: '-12s Fortify CD',
          description: 'Fortify (R) team-shield ultimate cooldown reduced',
          type: 'cooldown_reduce',
          tier: 25,
          abilityId: 'r',
          cooldownReduction: 12,
        },
        {
          id: 'sentry_25_right',
          name: '+10 Defense',
          description: '+10 Defense — reinforces the Overwatch defense aura',
          type: 'stat_bonus',
          tier: 25,
          statBonus: { stat: 'defense', value: 10 },
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
          name: '+250 HP',
          description: '+250 HP for the front-line offlaner',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'hp', value: 250 },
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
          name: '-3s Bind CD',
          description: 'Bind (Q) root cooldown reduced — lock targets down more often',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'q',
          cooldownReduction: 3,
        },
        {
          id: 'socket_15_right',
          name: '-4s Listen CD',
          description: 'Listen (W) trap cooldown reduced — keep more traps armed',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'w',
          cooldownReduction: 4,
        },
      ],
      20: [
        {
          id: 'socket_20_left',
          name: '-5s Accept CD',
          description: 'Accept (E) pull cooldown reduced — drag enemies in more often',
          type: 'cooldown_reduce',
          tier: 20,
          abilityId: 'e',
          cooldownReduction: 5,
        },
        {
          id: 'socket_20_right',
          name: '+10 Defense',
          description: '+10 Defense — tankier initiator',
          type: 'stat_bonus',
          tier: 20,
          statBonus: { stat: 'defense', value: 10 },
        },
      ],
      25: [
        {
          id: 'socket_25_left',
          name: '-12s Broadcast CD',
          description: 'Broadcast (R) global-slow ultimate cooldown reduced',
          type: 'cooldown_reduce',
          tier: 25,
          abilityId: 'r',
          cooldownReduction: 12,
        },
        {
          id: 'socket_25_right',
          name: '+18 Magic Resistance',
          description: '+18 Magic Resistance',
          type: 'stat_bonus',
          tier: 25,
          statBonus: { stat: 'magicResist', value: 18 },
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
          name: '+300 HP',
          description: '+300 HP — hold the line longer',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'hp', value: 300 },
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
          name: '+30% Lock Damage',
          description: 'Lock (Q) deals 30% more on the nuke+root',
          type: 'damage_boost',
          tier: 15,
          abilityId: 'q',
          damageBoost: 30,
        },
        {
          id: 'mutex_15_right',
          name: '-2s Spinlock CD',
          description: 'Spinlock (E) cooldown reduced — more AoE strikes + slows',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'e',
          cooldownReduction: 2,
        },
      ],
      20: [
        {
          id: 'mutex_20_left',
          name: '+40% Priority Inversion Damage',
          description: 'Priority Inversion (R) AoE deals 40% more',
          type: 'damage_boost',
          tier: 20,
          abilityId: 'r',
          damageBoost: 40,
        },
        {
          id: 'mutex_20_right',
          name: '+12 Defense',
          description: '+12 Defense — synergises with the Deadlock tank stacks',
          type: 'stat_bonus',
          tier: 20,
          statBonus: { stat: 'defense', value: 12 },
        },
      ],
      25: [
        {
          id: 'mutex_25_left',
          name: '-12s Priority Inversion CD',
          description: 'Priority Inversion (R) fear ultimate cooldown reduced',
          type: 'cooldown_reduce',
          tier: 25,
          abilityId: 'r',
          cooldownReduction: 12,
        },
        {
          id: 'mutex_25_right',
          name: '+20 Magic Resistance',
          description: '+20 Magic Resistance',
          type: 'stat_bonus',
          tier: 25,
          statBonus: { stat: 'magicResist', value: 20 },
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
          name: '+200 HP',
          description: '+200 HP for the fragile carry',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'hp', value: 200 },
        },
      ],
      15: [
        {
          id: 'thread_15_left',
          name: '+30% Fork Damage',
          description: 'Fork (Q) deals 30% more burst',
          type: 'damage_boost',
          tier: 15,
          abilityId: 'q',
          damageBoost: 30,
        },
        {
          id: 'thread_15_right',
          name: '-2s Sync Barrier CD',
          description: 'Sync Barrier (W) shield cooldown reduced',
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
          name: '-2s Yield CD',
          description: 'Yield (E) mark cooldown reduced — keep targets vulnerable',
          type: 'cooldown_reduce',
          tier: 20,
          abilityId: 'e',
          cooldownReduction: 2,
        },
      ],
      25: [
        {
          id: 'thread_25_left',
          name: '-12s Thread Pool CD',
          description: 'Thread Pool (R) AoE-attack ultimate cooldown reduced',
          type: 'cooldown_reduce',
          tier: 25,
          abilityId: 'r',
          cooldownReduction: 12,
        },
        {
          id: 'thread_25_right',
          name: '+18 Magic Resistance',
          description: '+18 Magic Resistance',
          type: 'stat_bonus',
          tier: 25,
          statBonus: { stat: 'magicResist', value: 18 },
        },
      ],
    },
  },
  // Lambda — a combo-chaining magical-burst mage (Closure rewards rapid casting).
  // Invoke (Q), Map (E) and Reduce (R) all deal INSTANT magical damage at cast, so
  // damage_boost lives on Q/E/R. Return (W) is a delayed self-teleport (no damage) —
  // it only ever gets cooldown_reduce / mana_cost_reduce, never damage_boost.
  lambda: {
    heroId: 'lambda',
    tiers: {
      10: [
        {
          id: 'lambda_10_left',
          name: '+300 Mana',
          description: '+300 Mana — fuel longer Closure combo chains',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'mp', value: 300 },
        },
        {
          id: 'lambda_10_right',
          name: '+250 HP',
          description: '+250 HP for the fragile mage',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'hp', value: 250 },
        },
      ],
      15: [
        {
          id: 'lambda_15_left',
          name: '+35% Invoke Damage',
          description: 'Invoke (Q) deals 35% more — a harder-hitting combo opener',
          type: 'damage_boost',
          tier: 15,
          abilityId: 'q',
          damageBoost: 35,
        },
        {
          id: 'lambda_15_right',
          name: '-3s Map CD',
          description: 'Map (E) cooldown reduced — slow + nuke the zone more often',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'e',
          cooldownReduction: 3,
        },
      ],
      20: [
        {
          id: 'lambda_20_left',
          name: '+40% Map Damage',
          description: 'Map (E) AoE deals 40% more across the slowed zone',
          type: 'damage_boost',
          tier: 20,
          abilityId: 'e',
          damageBoost: 40,
        },
        {
          id: 'lambda_20_right',
          name: '-4s Return CD',
          description: 'Return (W) cooldown reduced — reposition and escape more often',
          type: 'cooldown_reduce',
          tier: 20,
          abilityId: 'w',
          cooldownReduction: 4,
        },
      ],
      25: [
        {
          id: 'lambda_25_left',
          name: '-12s Reduce CD',
          description: 'Reduce (R) ultimate cooldown reduced — channel the nuke more often',
          type: 'cooldown_reduce',
          tier: 25,
          abilityId: 'r',
          cooldownReduction: 12,
        },
        {
          id: 'lambda_25_right',
          name: '+40% Reduce Damage',
          description: 'Reduce (R) channels 40% more magical damage into the target',
          type: 'damage_boost',
          tier: 25,
          abilityId: 'r',
          damageBoost: 40,
        },
      ],
    },
  },
  // Cron — a clockwork support: Uptime (Q) ally buff, Purge (W) cleanse+shield,
  // Kill Signal (E) physical nuke+taunt, Crontab (R) AoE heal/mana regen. Only
  // Kill Signal (E) deals instant cast damage, so it carries the lone damage_boost;
  // the rest of the tree is cooldown/mana efficiency on the support kit + tanky stats.
  cron: {
    heroId: 'cron',
    tiers: {
      10: [
        {
          id: 'cron_10_left',
          name: '+300 Mana',
          description: '+300 Mana — sustain the Crontab + Purge mana drain',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'mp', value: 300 },
        },
        {
          id: 'cron_10_right',
          name: '+250 HP',
          description: '+250 HP for the front-line melee support',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'hp', value: 250 },
        },
      ],
      15: [
        {
          id: 'cron_15_left',
          name: '+35% Kill Signal Damage',
          description: 'Kill Signal (E) deals 35% more physical burst',
          type: 'damage_boost',
          tier: 15,
          abilityId: 'e',
          damageBoost: 35,
        },
        {
          id: 'cron_15_right',
          name: '-3s Uptime CD',
          description: 'Uptime (Q) cooldown reduced — keep an ally buffed more often',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'q',
          cooldownReduction: 3,
        },
      ],
      20: [
        {
          id: 'cron_20_left',
          name: '-4s Purge CD',
          description: 'Purge (W) cooldown reduced — cleanse + shield allies more often',
          type: 'cooldown_reduce',
          tier: 20,
          abilityId: 'w',
          cooldownReduction: 4,
        },
        {
          id: 'cron_20_right',
          name: '-40% Kill Signal Mana',
          description: 'Kill Signal (E) refunds 40% of its mana — spam the taunt cheaply',
          type: 'mana_cost_reduce',
          tier: 20,
          abilityId: 'e',
          manaCostReduction: 40,
        },
      ],
      25: [
        {
          id: 'cron_25_left',
          name: '-12s Crontab CD',
          description: 'Crontab (R) ultimate cooldown reduced — heal the team more often',
          type: 'cooldown_reduce',
          tier: 25,
          abilityId: 'r',
          cooldownReduction: 12,
        },
        {
          id: 'cron_25_right',
          name: '+18 Magic Resistance',
          description: '+18 Magic Resistance — survive enemy nukes while channeling support',
          type: 'stat_bonus',
          tier: 25,
          statBonus: { stat: 'magicResist', value: 18 },
        },
      ],
    },
  },
  // Traceroute — a roaming pick-off assassin built on Probe (Q) burst, a TTL (W)
  // delayed-root trap, a Next Hop (E) reposition, and Full Trace (R) reveal +
  // self damage-amp. Only Probe (Q) deals instant damage at cast, so damage_boost
  // sits on Q ALONE; W is a delayed-root trap, E a self-hop buff, R a reveal +
  // self-buff (no instant damage) — those tiers use CD/mana/stat instead.
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
          name: '+200 HP',
          description: '+200 HP to survive the dive between hops',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'hp', value: 200 },
        },
      ],
      15: [
        {
          id: 'traceroute_15_left',
          name: '+35% Probe Damage',
          description: 'Probe (Q) deals 35% more — bigger pick-off on isolated targets',
          type: 'damage_boost',
          tier: 15,
          abilityId: 'q',
          damageBoost: 35,
        },
        {
          id: 'traceroute_15_right',
          name: '-3s TTL CD',
          description: 'TTL (W) trap cooldown reduced — lock down targets more often',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'w',
          cooldownReduction: 3,
        },
      ],
      20: [
        {
          id: 'traceroute_20_left',
          name: '-3s Next Hop CD',
          description: 'Next Hop (E) cooldown reduced — reposition and chase more often',
          type: 'cooldown_reduce',
          tier: 20,
          abilityId: 'e',
          cooldownReduction: 3,
        },
        {
          id: 'traceroute_20_right',
          name: '-40% Probe Mana Cost',
          description: 'Probe (Q) refunds 40% mana — spam the trace without running dry',
          type: 'mana_cost_reduce',
          tier: 20,
          abilityId: 'q',
          manaCostReduction: 40,
        },
      ],
      25: [
        {
          id: 'traceroute_25_left',
          name: '-12s Full Trace CD',
          description: 'Full Trace (R) ultimate cooldown reduced — reveal + amp more often',
          type: 'cooldown_reduce',
          tier: 25,
          abilityId: 'r',
          cooldownReduction: 12,
        },
        {
          id: 'traceroute_25_right',
          name: '+18 Magic Resistance',
          description: '+18 Magic Resistance — survive enemy nukes on the dive',
          type: 'stat_bonus',
          tier: 25,
          statBonus: { stat: 'magicResist', value: 18 },
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
          name: '+30% Void Bolt Damage',
          description: 'Void Bolt (Q) deals 30% more — harder poke into the resist shred',
          type: 'damage_boost',
          tier: 10,
          abilityId: 'q',
          damageBoost: 30,
        },
        {
          id: 'null_ref_10_right',
          name: '+300 Mana',
          description: '+300 MP — fuels the void-drain caster through fights',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'mp', value: 300 },
        },
      ],
      15: [
        {
          id: 'null_ref_15_left',
          name: '-2s Void Bolt CD',
          description: 'Void Bolt (Q) cooldown reduced — chain the magic-resist shred',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'q',
          cooldownReduction: 2,
        },
        {
          id: 'null_ref_15_right',
          name: '-3s Null Pointer CD',
          description: 'Null Pointer (W) silence cooldown reduced — lock a caster more often',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'w',
          cooldownReduction: 3,
        },
      ],
      20: [
        {
          id: 'null_ref_20_left',
          name: '+40% Dereference Damage',
          description: 'Dereference (R) AoE nuke deals 40% more before the execute bonus',
          type: 'damage_boost',
          tier: 20,
          abilityId: 'r',
          damageBoost: 40,
        },
        {
          id: 'null_ref_20_right',
          name: '-3s Void Zone CD',
          description: 'Void Zone (E) cooldown reduced — keep the DoT + reveal up',
          type: 'cooldown_reduce',
          tier: 20,
          abilityId: 'e',
          cooldownReduction: 3,
        },
      ],
      25: [
        {
          id: 'null_ref_25_left',
          name: '-12s Dereference CD',
          description: 'Dereference (R) ultimate cooldown reduced — execute teamfights faster',
          type: 'cooldown_reduce',
          tier: 25,
          abilityId: 'r',
          cooldownReduction: 12,
        },
        {
          id: 'null_ref_25_right',
          name: '+20 Magic Resistance',
          description: '+20 Magic Resistance — survive enemy nukes on the fragile mage',
          type: 'stat_bonus',
          tier: 25,
          statBonus: { stat: 'magicResist', value: 20 },
        },
      ],
    },
  },
  // ping — a ranged disruptor offlaner built around ICMP Echo (Q) poke, Timeout (W) silence,
  // Tracepath (E) vision/speed, and the Flood (R) AoE DoT ult. Q is the ONLY instant-damage
  // ability, so damage_boost sits on Q alone; W is a silence, E a self-buff, and R a DoT —
  // none deal instant cast damage, so they're rewarded via cooldown_reduce / mana / stats.
  ping: {
    heroId: 'ping',
    tiers: {
      10: [
        {
          id: 'ping_10_left',
          name: '+30% ICMP Echo Damage',
          description: 'ICMP Echo (Q) probes for 30% more magical damage',
          type: 'damage_boost',
          tier: 10,
          abilityId: 'q',
          damageBoost: 30,
        },
        {
          id: 'ping_10_right',
          name: '+200 HP',
          description: '+200 HP to survive the offlane harass',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'hp', value: 200 },
        },
      ],
      15: [
        {
          id: 'ping_15_left',
          name: '-3s ICMP Echo CD',
          description: 'ICMP Echo (Q) cooldown reduced — relentless cross-zone poke',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'q',
          cooldownReduction: 3,
        },
        {
          id: 'ping_15_right',
          name: '-3s Timeout CD',
          description: 'Timeout (W) silence comes back sooner — lock down casters',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'w',
          cooldownReduction: 3,
        },
      ],
      20: [
        {
          id: 'ping_20_left',
          name: '+40% ICMP Echo Damage',
          description: 'ICMP Echo (Q) deals 40% more — the poke becomes a nuke',
          type: 'damage_boost',
          tier: 20,
          abilityId: 'q',
          damageBoost: 40,
        },
        {
          id: 'ping_20_right',
          name: '+300 MP',
          description: '+300 MP to sustain endless probing and Flood',
          type: 'stat_bonus',
          tier: 20,
          statBonus: { stat: 'mp', value: 300 },
        },
      ],
      25: [
        {
          id: 'ping_25_left',
          name: '-12s Flood CD',
          description: 'Flood (R) ultimate cooldown reduced — zone control more often',
          type: 'cooldown_reduce',
          tier: 25,
          abilityId: 'r',
          cooldownReduction: 12,
        },
        {
          id: 'ping_25_right',
          name: '+18 Magic Resistance',
          description: '+18 Magic Resistance — outlast enemy nukes',
          type: 'stat_bonus',
          tier: 25,
          statBonus: { stat: 'magicResist', value: 18 },
        },
      ],
    },
  },
}
