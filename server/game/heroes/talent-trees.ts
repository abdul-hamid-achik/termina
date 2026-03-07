/**
 * Talent Tree System
 * Binary choices at levels 10, 15, 20, 25
 * Each hero has unique talent options per tier
 */

import type { HeroId } from '~~/shared/types/hero'

export type TalentTier = 10 | 15 | 20 | 25

export type TalentType =
  | 'stat_bonus'      // +X to a stat
  | 'ability_boost'   // Enhances specific ability
  | 'cooldown_reduce' // -Xs cooldown on ability
  | 'mana_cost_reduce'// -X% mana cost
  | 'damage_boost'    // +X% damage
  | 'special'         // Unique hero-specific effect

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
          name: 'Echo Stun +0.5s',
          description: 'Echo Stun duration increased by 0.5 seconds',
          type: 'ability_boost',
          tier: 15,
          abilityId: 'q',
          specialEffect: 'stun_duration_plus_0_5',
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
          name: 'Echo Ultimate AOE +50%',
          description: 'Echo Ultimate affects 50% larger area',
          type: 'special',
          tier: 25,
          abilityId: 'r',
          specialEffect: 'ultimate_aoe_plus_50',
        },
        {
          id: 'echo_25_right',
          name: 'Double Echo',
          description: 'Echo abilities can trigger twice',
          type: 'special',
          tier: 25,
          specialEffect: 'double_cast_chance_25',
        },
      ],
    },
  },
  
  daemon: {
    heroId: 'daemon',
    tiers: {
      10: [
        {
          id: 'daemon_10_left',
          name: '+12 Attack Speed',
          description: 'Increases attack speed by 12',
          type: 'stat_bonus',
          tier: 10,
          statBonus: { stat: 'attackSpeed', value: 12 },
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
          name: 'Shadow Strike +30 Damage',
          description: 'Shadow Strike deals 30 additional damage',
          type: 'damage_boost',
          tier: 15,
          abilityId: 'q',
          damageBoost: 30,
        },
        {
          id: 'daemon_15_right',
          name: '-3s Shadow Walk CD',
          description: 'Shadow Walk cooldown reduced by 3 seconds',
          type: 'cooldown_reduce',
          tier: 15,
          abilityId: 'w',
          cooldownReduction: 3,
        },
      ],
      20: [
        {
          id: 'daemon_20_left',
          name: '+40% Shadow Strike Slow',
          description: 'Shadow Strike slow effect increased to 40%',
          type: 'ability_boost',
          tier: 20,
          abilityId: 'q',
          specialEffect: 'slow_plus_40',
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
          name: 'Shadow Walk Duration +3s',
          description: 'Shadow Walk invisibility lasts 3 seconds longer',
          type: 'special',
          tier: 25,
          abilityId: 'w',
          specialEffect: 'invis_duration_plus_3',
        },
        {
          id: 'daemon_25_right',
          name: 'Assassinate Execute',
          description: 'Ultimate instantly kills targets below 15% HP',
          type: 'special',
          tier: 25,
          abilityId: 'r',
          specialEffect: 'execute_below_15',
        },
      ],
    },
  },
  
  // Add talent trees for other heroes (abbreviated for brevity)
  kernel: {
    heroId: 'kernel',
    tiers: {
      10: [
        { id: 'kernel_10_left', name: '+200 HP', description: '+200 HP', type: 'stat_bonus', tier: 10, statBonus: { stat: 'hp', value: 200 } },
        { id: 'kernel_10_right', name: '+15 Defense', description: '+15 Defense', type: 'stat_bonus', tier: 10, statBonus: { stat: 'defense', value: 15 } },
      ],
      15: [
        { id: 'kernel_15_left', name: '+1s Root Duration', description: 'Root duration +1s', type: 'ability_boost', tier: 15, abilityId: 'q', specialEffect: 'root_duration_plus_1' },
        { id: 'kernel_15_right', name: '-4s System Call CD', description: 'System Call CD -4s', type: 'cooldown_reduce', tier: 15, abilityId: 'w', cooldownReduction: 4 },
      ],
      20: [
        { id: 'kernel_20_left', name: '+30% Damage', description: '+30% ability damage', type: 'damage_boost', tier: 20, abilityId: 'q', damageBoost: 30 },
        { id: 'kernel_20_right', name: '+300 HP', description: '+300 HP', type: 'stat_bonus', tier: 20, statBonus: { stat: 'hp', value: 300 } },
      ],
      25: [
        { id: 'kernel_25_left', name: 'Immunity Duration +2s', description: 'Ultimate immunity +2s', type: 'special', tier: 25, abilityId: 'r', specialEffect: 'immunity_plus_2' },
        { id: 'kernel_25_right', name: 'Double Root', description: '25% chance to root twice', type: 'special', tier: 25, abilityId: 'q', specialEffect: 'double_root_chance_25' },
      ],
    },
  },
  
  regex: {
    heroId: 'regex',
    tiers: {
      10: [
        { id: 'regex_10_left', name: '+150 MP', description: '+150 MP', type: 'stat_bonus', tier: 10, statBonus: { stat: 'mp', value: 150 } },
        { id: 'regex_10_right', name: '+12 Attack', description: '+12 Attack', type: 'stat_bonus', tier: 10, statBonus: { stat: 'attack', value: 12 } },
      ],
      15: [
        { id: 'regex_15_left', name: '+40 Pattern Damage', description: 'Pattern +40 damage', type: 'damage_boost', tier: 15, abilityId: 'q', damageBoost: 40 },
        { id: 'regex_15_right', name: '-15% Mana Cost', description: '-15% ability mana', type: 'mana_cost_reduce', tier: 15, abilityId: 'q', manaCostReduction: 15 },
      ],
      20: [
        { id: 'regex_20_left', name: '+50% Match Slow', description: 'Match slow +50%', type: 'ability_boost', tier: 20, abilityId: 'w', specialEffect: 'slow_plus_50' },
        { id: 'regex_20_right', name: '+20% Magic Resist', description: '+20% Magic Resist', type: 'stat_bonus', tier: 20, statBonus: { stat: 'magicResist', value: 20 } },
      ],
      25: [
        { id: 'regex_25_left', name: 'Global Match', description: 'Ultimate affects all enemies', type: 'special', tier: 25, abilityId: 'r', specialEffect: 'global_ultimate' },
        { id: 'regex_25_right', name: 'Triple Cast', description: '20% chance to cast 3x', type: 'special', tier: 25, abilityId: 'r', specialEffect: 'triple_cast_chance_20' },
      ],
    },
  },
  
  // Fill in remaining heroes with basic talents
  firewall: {
    heroId: 'firewall',
    tiers: {
      10: [
        { id: 'firewall_10_left', name: '+250 HP', description: '+250 HP', type: 'stat_bonus', tier: 10, statBonus: { stat: 'hp', value: 250 } },
        { id: 'firewall_10_right', name: '+20 Defense', description: '+20 Defense', type: 'stat_bonus', tier: 10, statBonus: { stat: 'defense', value: 20 } },
      ],
      15: [
        { id: 'firewall_15_left', name: '+1s Burn Duration', description: 'Burn +1s', type: 'ability_boost', tier: 15, abilityId: 'q', specialEffect: 'burn_plus_1' },
        { id: 'firewall_15_right', name: '-3s Firewall CD', description: 'Firewall CD -3s', type: 'cooldown_reduce', tier: 15, abilityId: 'w', cooldownReduction: 3 },
      ],
      20: [
        { id: 'firewall_20_left', name: '+35% Damage', description: '+35% ability damage', type: 'damage_boost', tier: 20, abilityId: 'q', damageBoost: 35 },
        { id: 'firewall_20_right', name: '+400 HP', description: '+400 HP', type: 'stat_bonus', tier: 20, statBonus: { stat: 'hp', value: 400 } },
      ],
      25: [
        { id: 'firewall_25_left', name: 'Wall Width +50%', description: 'Wall width +50%', type: 'special', tier: 25, abilityId: 'w', specialEffect: 'wall_width_plus_50' },
        { id: 'firewall_25_right', name: 'True Damage Burn', description: 'Burn deals true damage', type: 'special', tier: 25, abilityId: 'q', specialEffect: 'true_damage_burn' },
      ],
    },
  },
  
  proxy: {
    heroId: 'proxy',
    tiers: {
      10: [
        { id: 'proxy_10_left', name: '+100 MP', description: '+100 MP', type: 'stat_bonus', tier: 10, statBonus: { stat: 'mp', value: 100 } },
        { id: 'proxy_10_right', name: '+10 Attack', description: '+10 Attack', type: 'stat_bonus', tier: 10, statBonus: { stat: 'attack', value: 10 } },
      ],
      15: [
        { id: 'proxy_15_left', name: '+2s Illusion Duration', description: 'Illusion +2s', type: 'ability_boost', tier: 15, abilityId: 'q', specialEffect: 'illusion_plus_2' },
        { id: 'proxy_15_right', name: '-20% Mana Cost', description: '-20% mana', type: 'mana_cost_reduce', tier: 15, abilityId: 'w', manaCostReduction: 20 },
      ],
      20: [
        { id: 'proxy_20_left', name: '+50% Illusion Damage', description: 'Illusions deal +50%', type: 'damage_boost', tier: 20, abilityId: 'q', damageBoost: 50 },
        { id: 'proxy_20_right', name: '+15% Magic Resist', description: '+15% Magic Resist', type: 'stat_bonus', tier: 20, statBonus: { stat: 'magicResist', value: 15 } },
      ],
      25: [
        { id: 'proxy_25_left', name: 'Triple Illusion', description: 'Create 3 illusions', type: 'special', tier: 25, abilityId: 'q', specialEffect: 'triple_illusion' },
        { id: 'proxy_25_right', name: 'Invisible Illusions', description: 'Illusions are invisible', type: 'special', tier: 25, abilityId: 'q', specialEffect: 'invisible_illusions' },
      ],
    },
  },
  
  // Add placeholder talents for remaining heroes
  malloc: { heroId: 'malloc', tiers: createGenericTalents('malloc') },
  cipher: { heroId: 'cipher', tiers: createGenericTalents('cipher') },
  sentry: { heroId: 'sentry', tiers: createGenericTalents('sentry') },
  socket: { heroId: 'socket', tiers: createGenericTalents('socket') },
  mutex: { heroId: 'mutex', tiers: createGenericTalents('mutex') },
  thread: { heroId: 'thread', tiers: createGenericTalents('thread') },
  lambda: { heroId: 'lambda', tiers: createGenericTalents('lambda') },
  cron: { heroId: 'cron', tiers: createGenericTalents('cron') },
  traceroute: { heroId: 'traceroute', tiers: createGenericTalents('traceroute') },
  null_ref: { heroId: 'null_ref', tiers: createGenericTalents('null_ref') },
  ping: { heroId: 'ping', tiers: createGenericTalents('ping') },
}

/** Helper to create generic talents for heroes without unique trees */
function createGenericTalents(heroId: HeroId): TalentTree['tiers'] {
  return {
    10: [
      { id: `${heroId}_10_left`, name: '+15 Attack', description: '+15 Attack', type: 'stat_bonus', tier: 10, statBonus: { stat: 'attack', value: 15 } },
      { id: `${heroId}_10_right`, name: '+200 HP', description: '+200 HP', type: 'stat_bonus', tier: 10, statBonus: { stat: 'hp', value: 200 } },
    ],
    15: [
      { id: `${heroId}_15_left`, name: '+25 Damage', description: '+25 ability damage', type: 'damage_boost', tier: 15, abilityId: 'q', damageBoost: 25 },
      { id: `${heroId}_15_right`, name: '-2s Cooldown', description: '-2s ability CD', type: 'cooldown_reduce', tier: 15, abilityId: 'w', cooldownReduction: 2 },
    ],
    20: [
      { id: `${heroId}_20_left`, name: '+30% Damage', description: '+30% ability damage', type: 'damage_boost', tier: 20, abilityId: 'q', damageBoost: 30 },
      { id: `${heroId}_20_right`, name: '+300 HP', description: '+300 HP', type: 'stat_bonus', tier: 20, statBonus: { stat: 'hp', value: 300 } },
    ],
    25: [
      { id: `${heroId}_25_left`, name: 'Ultimate Boost', description: 'Ultimate +50% effect', type: 'special', tier: 25, abilityId: 'r', specialEffect: 'ultimate_plus_50' },
      { id: `${heroId}_25_right`, name: 'Double Cast', description: '20% double cast chance', type: 'special', tier: 25, abilityId: 'q', specialEffect: 'double_cast_20' },
    ],
  }
}
