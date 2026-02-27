import type { HeroDef } from '../types/hero'

export const HEROES: Record<string, HeroDef> = {
  echo: {
    id: 'echo',
    name: 'Echo',
    role: 'carry',
    lore: 'A recursive signal that grows stronger with each reflection. Echo feeds on combat, amplifying damage the longer a fight persists.',
    baseStats: {
      hp: 550,
      mp: 280,
      attack: 58,
      defense: 3,
      magicResist: 15,
      moveSpeed: 1,
      attackRange: 'ranged',
    },
    growthPerLevel: {
      hp: 55,
      mp: 25,
      attack: 7,
      defense: 1,
    },
    passive: {
      id: 'echo-passive',
      name: 'Resonance',
      description:
        'Each consecutive attack on the same target deals 8% more damage, stacking up to 5 times.',
      manaCost: 0,
      cooldownTicks: 0,
      targetType: 'none',
      effects: [{ type: 'buff', value: 8, description: 'Damage amplification per stack' }],
    },
    abilities: {
      q: {
        id: 'echo-q',
        name: 'Pulse Shot',
        description:
          'Fire a pulse of energy that damages the target and bounces to one nearby enemy for 50% damage.',
        manaCost: 60,
        cooldownTicks: 2,
        targetType: 'unit',
        damageType: 'physical',
        effects: [
          { type: 'damage', value: 80, damageType: 'physical' },
          { type: 'damage', value: 40, damageType: 'physical', description: 'Bounce damage' },
        ],
      },
      w: {
        id: 'echo-w',
        name: 'Phase Shift',
        description:
          'Briefly shift out of phase, dodging all attacks for 1 tick and gaining bonus move speed.',
        manaCost: 80,
        cooldownTicks: 5,
        targetType: 'self',
        effects: [
          { type: 'buff', value: 1, duration: 1, description: 'Evasion' },
          { type: 'buff', value: 1, duration: 2, description: 'Move speed bonus' },
        ],
      },
      e: {
        id: 'echo-e',
        name: 'Feedback Loop',
        description:
          'Passively steals 5 attack damage from each hero hit, lasting 3 ticks. Active: consume all stacks for a burst of damage.',
        manaCost: 50,
        cooldownTicks: 4,
        targetType: 'hero',
        damageType: 'physical',
        effects: [
          { type: 'debuff', value: 5, duration: 3, description: 'Attack steal per stack' },
          { type: 'damage', value: 30, damageType: 'physical', description: 'Per stack consumed' },
        ],
      },
      r: {
        id: 'echo-r',
        name: 'Infinite Recursion',
        description:
          'Unleash a cascade of echoing strikes on a target, hitting 6 times over 2 ticks. Each hit applies Resonance stacks.',
        manaCost: 200,
        cooldownTicks: 20,
        targetType: 'hero',
        damageType: 'physical',
        effects: [
          { type: 'damage', value: 60, damageType: 'physical', description: 'Per hit (x6)' },
          { type: 'buff', value: 6, description: 'Resonance stacks applied' },
        ],
      },
    },
  },

  sentry: {
    id: 'sentry',
    name: 'Sentry',
    role: 'support',
    lore: 'An autonomous watchpoint that protects allies through surveillance and force fields. Sentry sees all and shields the worthy.',
    baseStats: {
      hp: 600,
      mp: 350,
      attack: 40,
      defense: 4,
      magicResist: 20,
      moveSpeed: 1,
      attackRange: 'ranged',
    },
    growthPerLevel: {
      hp: 60,
      mp: 35,
      attack: 3,
      defense: 1,
    },
    passive: {
      id: 'sentry-passive',
      name: 'Overwatch',
      description:
        'Grants vision of adjacent zones. Allied heroes in the same zone gain 5 bonus defense.',
      manaCost: 0,
      cooldownTicks: 0,
      targetType: 'none',
      effects: [
        { type: 'reveal', value: 1, description: 'Adjacent zone vision' },
        { type: 'buff', value: 5, description: 'Defense aura' },
      ],
    },
    abilities: {
      q: {
        id: 'sentry-q',
        name: 'Mend Protocol',
        description:
          'Heal an allied hero for a moderate amount. If the target is below 30% HP, heal for double.',
        manaCost: 80,
        cooldownTicks: 3,
        targetType: 'hero',
        effects: [{ type: 'heal', value: 120 }],
      },
      w: {
        id: 'sentry-w',
        name: 'Barrier',
        description: 'Grant a shield to an ally that absorbs damage for 3 ticks.',
        manaCost: 100,
        cooldownTicks: 5,
        targetType: 'hero',
        effects: [{ type: 'shield', value: 150, duration: 3 }],
      },
      e: {
        id: 'sentry-e',
        name: 'Scan Pulse',
        description:
          'Reveal all enemy heroes in the current zone and adjacent zones for 2 ticks. Slows revealed enemies.',
        manaCost: 70,
        cooldownTicks: 6,
        targetType: 'none',
        effects: [
          { type: 'reveal', value: 2, duration: 2 },
          { type: 'slow', value: 30, duration: 2, description: 'Movement slow %' },
        ],
      },
      r: {
        id: 'sentry-r',
        name: 'Fortify',
        description:
          'Grant all allied heroes in the zone a massive shield and defense boost for 3 ticks.',
        manaCost: 250,
        cooldownTicks: 25,
        targetType: 'none',
        effects: [
          { type: 'shield', value: 300, duration: 3 },
          { type: 'buff', value: 15, duration: 3, description: 'Bonus defense' },
        ],
      },
    },
  },

  daemon: {
    id: 'daemon',
    name: 'Daemon',
    role: 'assassin',
    lore: 'A background process that lurks unseen, striking from the shadows. Daemon deletes targets before they know what hit them.',
    baseStats: {
      hp: 480,
      mp: 300,
      attack: 65,
      defense: 2,
      magicResist: 12,
      moveSpeed: 2,
      attackRange: 'melee',
    },
    growthPerLevel: {
      hp: 45,
      mp: 20,
      attack: 8,
      defense: 1,
    },
    passive: {
      id: 'daemon-passive',
      name: 'Stealth Process',
      description:
        'After 2 ticks without attacking or taking damage, become invisible. First attack from stealth deals 50% bonus damage.',
      manaCost: 0,
      cooldownTicks: 0,
      targetType: 'none',
      effects: [
        { type: 'buff', value: 2, description: 'Ticks to stealth' },
        { type: 'damage', value: 50, damageType: 'physical', description: 'Bonus damage %' },
      ],
    },
    abilities: {
      q: {
        id: 'daemon-q',
        name: 'Inject',
        description:
          'Apply a DoT debuff on the target, dealing magical damage over 3 ticks.',
        manaCost: 50,
        cooldownTicks: 7,
        targetType: 'hero',
        damageType: 'magical',
        effects: [
          { type: 'dot', value: 60, duration: 3, damageType: 'magical', description: 'Total damage over 3 ticks' },
        ],
      },
      w: {
        id: 'daemon-w',
        name: 'Fork Bomb',
        description:
          'Create a decoy in the target zone for 3 ticks, granting vision of that zone.',
        manaCost: 100,
        cooldownTicks: 18,
        targetType: 'zone',
        effects: [
          { type: 'reveal', value: 3, duration: 3, description: 'Zone vision via decoy' },
        ],
      },
      e: {
        id: 'daemon-e',
        name: 'Sudo',
        description:
          'Execute a target below 30% HP with pure damage. Fails if target is above the threshold.',
        manaCost: 150,
        cooldownTicks: 20,
        targetType: 'hero',
        damageType: 'pure',
        effects: [
          { type: 'execute', value: 30, description: 'HP threshold %' },
          { type: 'damage', value: 300, damageType: 'pure' },
        ],
      },
      r: {
        id: 'daemon-r',
        name: 'Root Access',
        description:
          'Teleport to any zone on the map.',
        manaCost: 200,
        cooldownTicks: 60,
        targetType: 'zone',
        effects: [
          { type: 'teleport', value: 1, description: 'Global teleport' },
        ],
      },
    },
  },

  kernel: {
    id: 'kernel',
    name: 'Kernel',
    role: 'tank',
    lore: 'The core process that refuses to die. Kernel absorbs punishment meant for others and grows more dangerous the more damage it takes.',
    baseStats: {
      hp: 750,
      mp: 250,
      attack: 48,
      defense: 8,
      magicResist: 25,
      moveSpeed: 1,
      attackRange: 'melee',
    },
    growthPerLevel: {
      hp: 80,
      mp: 15,
      attack: 4,
      defense: 2,
      magicResist: 2,
    },
    passive: {
      id: 'kernel-passive',
      name: 'Hardened',
      description:
        'Gain 1 bonus defense for every 5% HP missing. At 20% HP, gain 20% damage reduction.',
      manaCost: 0,
      cooldownTicks: 0,
      targetType: 'none',
      effects: [{ type: 'buff', value: 1, description: 'Defense per 5% HP missing' }],
    },
    abilities: {
      q: {
        id: 'kernel-q',
        name: 'Core Dump',
        description:
          'Slam the ground, dealing physical damage and stunning all enemies in the zone for 1 tick.',
        manaCost: 80,
        cooldownTicks: 3,
        targetType: 'none',
        damageType: 'physical',
        effects: [
          { type: 'damage', value: 90, damageType: 'physical' },
          { type: 'stun', value: 1, duration: 1 },
        ],
      },
      w: {
        id: 'kernel-w',
        name: 'Firewall',
        description: 'Raise a firewall that reduces all incoming damage by 40% for 2 ticks.',
        manaCost: 70,
        cooldownTicks: 5,
        targetType: 'self',
        effects: [{ type: 'buff', value: 40, duration: 2, description: 'Damage reduction %' }],
      },
      e: {
        id: 'kernel-e',
        name: 'Taunt Process',
        description: 'Force all enemy heroes in the zone to attack Kernel for 2 ticks.',
        manaCost: 60,
        cooldownTicks: 4,
        targetType: 'none',
        effects: [{ type: 'taunt', value: 1, duration: 2 }],
      },
      r: {
        id: 'kernel-r',
        name: 'Kernel Panic',
        description:
          "Overload the core: deal damage to all enemies in the zone based on Kernel's missing HP. Also fears enemies for 2 ticks.",
        manaCost: 250,
        cooldownTicks: 25,
        targetType: 'none',
        damageType: 'magical',
        effects: [
          {
            type: 'damage',
            value: 200,
            damageType: 'magical',
            description: 'Base + 1 per missing HP',
          },
          { type: 'fear', value: 1, duration: 2 },
        ],
      },
    },
  },

  regex: {
    id: 'regex',
    name: 'Regex',
    role: 'mage',
    lore: 'A pattern matcher of terrifying power. Regex weaves spells from syntax, matching enemies to their doom with arcane expressions.',
    baseStats: {
      hp: 450,
      mp: 400,
      attack: 42,
      defense: 1,
      magicResist: 18,
      moveSpeed: 1,
      attackRange: 'ranged',
    },
    growthPerLevel: {
      hp: 40,
      mp: 40,
      attack: 3,
      defense: 1,
      magicResist: 1,
    },
    passive: {
      id: 'regex-passive',
      name: 'Pattern Cache',
      description:
        'Casting an ability on the same target within 3 ticks deals 15% bonus magical damage.',
      manaCost: 0,
      cooldownTicks: 0,
      targetType: 'none',
      effects: [{ type: 'buff', value: 15, description: 'Bonus magical damage %' }],
    },
    abilities: {
      q: {
        id: 'regex-q',
        name: 'Match',
        description:
          'Launch a pattern bolt that deals magical damage and marks the target, increasing magic damage taken by 10% for 3 ticks.',
        manaCost: 60,
        cooldownTicks: 2,
        targetType: 'unit',
        damageType: 'magical',
        effects: [
          { type: 'damage', value: 100, damageType: 'magical' },
          { type: 'debuff', value: 10, duration: 3, description: 'Magic vulnerability %' },
        ],
      },
      w: {
        id: 'regex-w',
        name: 'Capture Group',
        description: 'Root an enemy hero in place for 2 ticks, dealing magical damage over time.',
        manaCost: 90,
        cooldownTicks: 5,
        targetType: 'hero',
        damageType: 'magical',
        effects: [
          { type: 'root', value: 1, duration: 2 },
          { type: 'dot', value: 50, duration: 2, damageType: 'magical' },
        ],
      },
      e: {
        id: 'regex-e',
        name: 'Substitution',
        description:
          'Swap positions with a target hero (ally or enemy). Deals magical damage to enemies upon swap.',
        manaCost: 100,
        cooldownTicks: 6,
        targetType: 'hero',
        damageType: 'magical',
        effects: [
          { type: 'teleport', value: 1, description: 'Position swap' },
          { type: 'damage', value: 80, damageType: 'magical', description: 'On enemy swap' },
        ],
      },
      r: {
        id: 'regex-r',
        name: 'Catastrophic Backtracking',
        description:
          'Unleash a devastating pattern that deals massive magical damage to all enemies in the zone, scaling with their missing mana.',
        manaCost: 300,
        cooldownTicks: 25,
        targetType: 'none',
        damageType: 'magical',
        effects: [
          { type: 'damage', value: 250, damageType: 'magical', description: 'Base damage' },
          { type: 'silence', value: 1, duration: 2 },
        ],
      },
    },
  },

  socket: {
    id: 'socket',
    name: 'Socket',
    role: 'offlaner',
    lore: 'A persistent connection that binds enemies together. Socket thrives in chaos, linking foes to share damage and disrupting formations.',
    baseStats: {
      hp: 650,
      mp: 300,
      attack: 52,
      defense: 5,
      magicResist: 18,
      moveSpeed: 1,
      attackRange: 'melee',
    },
    growthPerLevel: {
      hp: 65,
      mp: 25,
      attack: 5,
      defense: 2,
      magicResist: 1,
    },
    passive: {
      id: 'socket-passive',
      name: 'Persistent Connection',
      description:
        'Basic attacks apply a link stack. At 3 stacks, the target is slowed by 20% for 2 ticks.',
      manaCost: 0,
      cooldownTicks: 0,
      targetType: 'none',
      effects: [
        { type: 'debuff', value: 3, description: 'Stacks to trigger' },
        { type: 'slow', value: 20, duration: 2, description: 'Slow %' },
      ],
    },
    abilities: {
      q: {
        id: 'socket-q',
        name: 'Bind',
        description:
          'Latch onto an enemy hero, dealing damage and reducing their move speed for 2 ticks.',
        manaCost: 60,
        cooldownTicks: 3,
        targetType: 'hero',
        damageType: 'physical',
        effects: [
          { type: 'damage', value: 85, damageType: 'physical' },
          { type: 'slow', value: 30, duration: 2 },
        ],
      },
      w: {
        id: 'socket-w',
        name: 'Handshake',
        description:
          'Establish a link between Socket and an enemy. For 3 ticks, 30% of damage dealt to either is shared with the other.',
        manaCost: 80,
        cooldownTicks: 5,
        targetType: 'hero',
        effects: [{ type: 'debuff', value: 30, duration: 3, description: 'Damage share %' }],
      },
      e: {
        id: 'socket-e',
        name: 'Packet Burst',
        description:
          'Deal magical damage in a burst to all enemies in the zone. Applies one Persistent Connection stack.',
        manaCost: 70,
        cooldownTicks: 4,
        targetType: 'none',
        damageType: 'magical',
        effects: [
          { type: 'damage', value: 95, damageType: 'magical' },
          { type: 'debuff', value: 1, description: 'Persistent Connection stack' },
        ],
      },
      r: {
        id: 'socket-r',
        name: 'DDoS',
        description:
          'Overwhelm all enemies in the zone with a flood of connections, stunning them for 2 ticks and dealing damage over time.',
        manaCost: 250,
        cooldownTicks: 24,
        targetType: 'none',
        damageType: 'magical',
        effects: [
          { type: 'stun', value: 1, duration: 2 },
          { type: 'dot', value: 70, duration: 3, damageType: 'magical' },
        ],
      },
    },
  },
} as const

export const HERO_IDS = Object.keys(HEROES) as ReadonlyArray<string>
