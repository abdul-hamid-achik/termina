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

  proxy: {
    id: 'proxy',
    name: 'Proxy',
    role: 'support',
    lore: 'A network intermediary that intercepts traffic and redirects harm. Proxy shields allies by absorbing and rerouting damage through cached connections.',
    baseStats: {
      hp: 580,
      mp: 380,
      attack: 42,
      defense: 4,
      magicResist: 20,
      moveSpeed: 1,
      attackRange: 'ranged',
    },
    growthPerLevel: {
      hp: 55,
      mp: 35,
      attack: 3,
      defense: 1,
    },
    passive: {
      id: 'proxy-passive',
      name: 'Middleman',
      description:
        'Redirects 12% of damage dealt to the nearest ally within the same zone to Proxy instead.',
      manaCost: 0,
      cooldownTicks: 0,
      targetType: 'none',
      effects: [{ type: 'buff', value: 12, description: 'Damage redirect %' }],
    },
    abilities: {
      q: {
        id: 'proxy-q',
        name: 'Packet Redirect',
        description:
          'Hurl a redirected packet at an enemy, dealing magical damage and slowing them for 2 ticks.',
        manaCost: 70,
        cooldownTicks: 3,
        targetType: 'unit',
        damageType: 'magical',
        effects: [
          { type: 'damage', value: 85, damageType: 'magical' },
          { type: 'slow', value: 25, duration: 2 },
        ],
      },
      w: {
        id: 'proxy-w',
        name: 'Cache Shield',
        description:
          'Grant an allied hero a cached response shield that absorbs damage for 3 ticks.',
        manaCost: 90,
        cooldownTicks: 5,
        targetType: 'hero',
        effects: [{ type: 'shield', value: 140, duration: 3 }],
      },
      e: {
        id: 'proxy-e',
        name: 'Load Balance',
        description:
          'Split healing evenly among all allied heroes in the zone, restoring HP to each.',
        manaCost: 100,
        cooldownTicks: 4,
        targetType: 'none',
        effects: [{ type: 'heal', value: 180, description: 'Total healing split among allies' }],
      },
      r: {
        id: 'proxy-r',
        name: 'Reverse Proxy',
        description:
          'Swap positions with an allied hero, granting both brief invulnerability for 1 tick.',
        manaCost: 200,
        cooldownTicks: 22,
        targetType: 'hero',
        effects: [
          { type: 'teleport', value: 1, description: 'Position swap with ally' },
          { type: 'buff', value: 1, duration: 1, description: 'Invulnerability' },
        ],
      },
    },
  },

  malloc: {
    id: 'malloc',
    name: 'Malloc',
    role: 'carry',
    lore: 'A memory allocator that grows in power the more resources it claims. Malloc scales relentlessly, converting gold into raw destructive force.',
    baseStats: {
      hp: 520,
      mp: 300,
      attack: 62,
      defense: 2,
      magicResist: 14,
      moveSpeed: 1,
      attackRange: 'melee',
    },
    growthPerLevel: {
      hp: 50,
      mp: 25,
      attack: 8,
      defense: 1,
    },
    passive: {
      id: 'malloc-passive',
      name: 'Heap Growth',
      description: 'Gain +1 bonus attack damage for every 100 gold currently held.',
      manaCost: 0,
      cooldownTicks: 0,
      targetType: 'none',
      effects: [{ type: 'buff', value: 1, description: 'Attack per 100 gold' }],
    },
    abilities: {
      q: {
        id: 'malloc-q',
        name: 'Allocate',
        description:
          'Allocate additional resources, buffing attack damage by 25 for 3 ticks.',
        manaCost: 60,
        cooldownTicks: 4,
        targetType: 'self',
        effects: [{ type: 'buff', value: 25, duration: 3, description: 'Bonus attack damage' }],
      },
      w: {
        id: 'malloc-w',
        name: 'Free()',
        description:
          'Deallocate a target, dealing physical damage. Deals 40% bonus damage if the target is below 30% HP.',
        manaCost: 70,
        cooldownTicks: 3,
        targetType: 'hero',
        damageType: 'physical',
        effects: [
          { type: 'damage', value: 110, damageType: 'physical' },
          { type: 'damage', value: 44, damageType: 'physical', description: 'Bonus if target below 30% HP' },
        ],
      },
      e: {
        id: 'malloc-e',
        name: 'Pointer Dereference',
        description:
          'Dash to a target enemy, closing the gap and stunning them for 1 tick.',
        manaCost: 80,
        cooldownTicks: 5,
        targetType: 'hero',
        damageType: 'physical',
        effects: [
          { type: 'damage', value: 75, damageType: 'physical' },
          { type: 'stun', value: 1, duration: 1 },
        ],
      },
      r: {
        id: 'malloc-r',
        name: 'Stack Overflow',
        description:
          'Overflow the stack with raw power, dealing massive physical damage to all enemies in the zone. Costs 20% of current HP and MP.',
        manaCost: 150,
        cooldownTicks: 22,
        targetType: 'none',
        damageType: 'physical',
        effects: [
          { type: 'damage', value: 280, damageType: 'physical', description: 'AOE damage' },
        ],
      },
    },
  },

  cipher: {
    id: 'cipher',
    name: 'Cipher',
    role: 'assassin',
    lore: 'An encryption algorithm given form. Cipher strikes from encrypted obscurity, decrypting enemies to expose their weaknesses before delivering lethal bursts of data.',
    baseStats: {
      hp: 480,
      mp: 320,
      attack: 64,
      defense: 2,
      magicResist: 13,
      moveSpeed: 2,
      attackRange: 'melee',
    },
    growthPerLevel: {
      hp: 45,
      mp: 22,
      attack: 7,
      defense: 1,
    },
    passive: {
      id: 'cipher-passive',
      name: 'Encryption Key',
      description:
        'Each attack reduces the target\'s defense by 2 for 3 ticks, stacking up to 4 times.',
      manaCost: 0,
      cooldownTicks: 0,
      targetType: 'none',
      effects: [{ type: 'debuff', value: 2, duration: 3, description: 'Defense reduction per stack' }],
    },
    abilities: {
      q: {
        id: 'cipher-q',
        name: 'XOR Strike',
        description:
          'Strike with an XOR-encoded blade, dealing bonus magical damage on top of the physical attack.',
        manaCost: 50,
        cooldownTicks: 2,
        targetType: 'hero',
        damageType: 'magical',
        effects: [
          { type: 'damage', value: 70, damageType: 'magical' },
          { type: 'damage', value: 40, damageType: 'physical', description: 'Base strike' },
        ],
      },
      w: {
        id: 'cipher-w',
        name: 'Encrypt',
        description:
          'Encrypt self, becoming invisible for 2 ticks. Taking damage or attacking breaks stealth.',
        manaCost: 80,
        cooldownTicks: 6,
        targetType: 'self',
        effects: [{ type: 'buff', value: 1, duration: 2, description: 'Stealth' }],
      },
      e: {
        id: 'cipher-e',
        name: 'Decrypt',
        description:
          'Decrypt a target enemy, revealing them for 3 ticks and silencing them for 1 tick.',
        manaCost: 90,
        cooldownTicks: 5,
        targetType: 'hero',
        effects: [
          { type: 'reveal', value: 1, duration: 3 },
          { type: 'silence', value: 1, duration: 1 },
        ],
      },
      r: {
        id: 'cipher-r',
        name: 'Brute Force',
        description:
          'Unleash 6 rapid decryption strikes on a target, each dealing magical damage. Applies Encryption Key stacks.',
        manaCost: 220,
        cooldownTicks: 20,
        targetType: 'hero',
        damageType: 'magical',
        effects: [
          { type: 'damage', value: 55, damageType: 'magical', description: 'Per hit (x6)' },
          { type: 'debuff', value: 6, description: 'Encryption Key stacks applied' },
        ],
      },
    },
  },

  firewall: {
    id: 'firewall',
    name: 'Firewall',
    role: 'tank',
    lore: 'A sentient packet filter that stands between allies and destruction. Firewall blocks, reflects, and punishes all who dare breach its perimeter.',
    baseStats: {
      hp: 720,
      mp: 270,
      attack: 48,
      defense: 7,
      magicResist: 22,
      moveSpeed: 1,
      attackRange: 'melee',
    },
    growthPerLevel: {
      hp: 75,
      mp: 18,
      attack: 4,
      defense: 2,
      magicResist: 2,
    },
    passive: {
      id: 'firewall-passive',
      name: 'Packet Inspection',
      description:
        'Reflect 8% of all damage taken back to the attacker as magical damage.',
      manaCost: 0,
      cooldownTicks: 0,
      targetType: 'none',
      effects: [{ type: 'damage', value: 8, damageType: 'magical', description: 'Damage reflect %' }],
    },
    abilities: {
      q: {
        id: 'firewall-q',
        name: 'Port Block',
        description:
          'Block a target\'s ports, dealing physical damage and stunning them for 1 tick.',
        manaCost: 70,
        cooldownTicks: 3,
        targetType: 'hero',
        damageType: 'physical',
        effects: [
          { type: 'damage', value: 95, damageType: 'physical' },
          { type: 'stun', value: 1, duration: 1 },
        ],
      },
      w: {
        id: 'firewall-w',
        name: 'DMZ',
        description:
          'Create a demilitarized zone shield around self that absorbs damage for 3 ticks. When the shield expires or breaks, it explodes dealing magical damage to nearby enemies.',
        manaCost: 80,
        cooldownTicks: 5,
        targetType: 'self',
        effects: [
          { type: 'shield', value: 200, duration: 3 },
          { type: 'damage', value: 80, damageType: 'magical', description: 'Explosion on break' },
        ],
      },
      e: {
        id: 'firewall-e',
        name: 'Access Control',
        description:
          'Enforce access control in the zone, taunting all enemies to attack Firewall for 2 ticks.',
        manaCost: 60,
        cooldownTicks: 4,
        targetType: 'none',
        effects: [{ type: 'taunt', value: 1, duration: 2 }],
      },
      r: {
        id: 'firewall-r',
        name: 'Deep Packet Inspection',
        description:
          'Perform deep inspection on all enemies in the zone, rooting them for 2 ticks and dealing magical damage over time.',
        manaCost: 250,
        cooldownTicks: 24,
        targetType: 'none',
        damageType: 'magical',
        effects: [
          { type: 'root', value: 1, duration: 2 },
          { type: 'dot', value: 120, duration: 3, damageType: 'magical', description: 'Total damage over 3 ticks' },
        ],
      },
    },
  },
  null_ref: {
    id: 'null_ref',
    name: 'Null',
    role: 'mage',
    lore: 'A void reference that consumes all it touches. Null drains the essence from enemies, growing stronger with each deletion it causes.',
    baseStats: {
      hp: 440,
      mp: 420,
      attack: 38,
      defense: 1,
      magicResist: 16,
      moveSpeed: 1,
      attackRange: 'ranged',
    },
    growthPerLevel: {
      hp: 42,
      mp: 40,
      attack: 3,
      defense: 1,
    },
    passive: {
      id: 'null_ref-passive',
      name: 'Void Drain',
      description:
        'On kill, restore 15% max MP and reduce all ability cooldowns by 2 ticks.',
      manaCost: 0,
      cooldownTicks: 0,
      targetType: 'none',
      effects: [
        { type: 'heal', value: 15, description: 'MP restore % on kill' },
        { type: 'buff', value: 2, description: 'Cooldown reduction ticks' },
      ],
    },
    abilities: {
      q: {
        id: 'null_ref-q',
        name: 'Void Bolt',
        description:
          'Fire a bolt of void energy that deals magical damage and shreds the target\'s magic resistance by 5 for 3 ticks.',
        manaCost: 55,
        cooldownTicks: 2,
        targetType: 'unit',
        damageType: 'magical',
        effects: [
          { type: 'damage', value: 90, damageType: 'magical' },
          { type: 'debuff', value: 5, duration: 3, description: 'Magic resist shred' },
        ],
      },
      w: {
        id: 'null_ref-w',
        name: 'Null Pointer',
        description:
          'Silence a target enemy hero for 2 ticks, preventing them from casting abilities.',
        manaCost: 80,
        cooldownTicks: 5,
        targetType: 'hero',
        effects: [
          { type: 'silence', value: 1, duration: 2 },
        ],
      },
      e: {
        id: 'null_ref-e',
        name: 'Void Zone',
        description:
          'Create a zone of null space, dealing magical damage over time to all enemies in the zone for 3 ticks and revealing them.',
        manaCost: 90,
        cooldownTicks: 6,
        targetType: 'none',
        damageType: 'magical',
        effects: [
          { type: 'dot', value: 120, duration: 3, damageType: 'magical', description: 'Total damage over 3 ticks' },
          { type: 'reveal', value: 1, duration: 3 },
        ],
      },
      r: {
        id: 'null_ref-r',
        name: 'Dereference',
        description:
          'Unleash a devastating null dereference on all enemies in the zone, dealing massive magical damage. Enemies below 25% HP take 50% bonus damage.',
        manaCost: 280,
        cooldownTicks: 24,
        targetType: 'none',
        damageType: 'magical',
        effects: [
          { type: 'damage', value: 240, damageType: 'magical' },
          { type: 'execute', value: 25, description: 'Execute threshold % for bonus damage' },
        ],
      },
    },
  },

  lambda: {
    id: 'lambda',
    name: 'Lambda',
    role: 'mage',
    lore: 'An anonymous function of pure destruction. Lambda chains abilities into devastating combos, rewarding rapid casting with amplified power.',
    baseStats: {
      hp: 460,
      mp: 400,
      attack: 40,
      defense: 1,
      magicResist: 17,
      moveSpeed: 1,
      attackRange: 'ranged',
    },
    growthPerLevel: {
      hp: 38,
      mp: 38,
      attack: 3,
      defense: 1,
    },
    passive: {
      id: 'lambda-passive',
      name: 'Closure',
      description:
        'Casting 3 abilities within 4 ticks activates Closure: next ability costs no mana and deals 30% bonus damage.',
      manaCost: 0,
      cooldownTicks: 0,
      targetType: 'none',
      effects: [
        { type: 'buff', value: 30, description: 'Bonus damage % when Closure active' },
        { type: 'buff', value: 3, description: 'Casts needed to trigger' },
      ],
    },
    abilities: {
      q: {
        id: 'lambda-q',
        name: 'Invoke',
        description:
          'Fire a quick bolt of functional energy, dealing magical damage to a target.',
        manaCost: 40,
        cooldownTicks: 2,
        targetType: 'unit',
        damageType: 'magical',
        effects: [
          { type: 'damage', value: 75, damageType: 'magical' },
        ],
      },
      w: {
        id: 'lambda-w',
        name: 'Return',
        description:
          'Mark current zone. After 2 ticks, teleport back to the marked zone.',
        manaCost: 70,
        cooldownTicks: 6,
        targetType: 'self',
        effects: [
          { type: 'teleport', value: 2, description: 'Delayed return after 2 ticks' },
        ],
      },
      e: {
        id: 'lambda-e',
        name: 'Map',
        description:
          'Apply a slowing field to all enemies in the zone, reducing move speed for 2 ticks and dealing magical damage.',
        manaCost: 80,
        cooldownTicks: 4,
        targetType: 'none',
        damageType: 'magical',
        effects: [
          { type: 'damage', value: 70, damageType: 'magical' },
          { type: 'slow', value: 30, duration: 2 },
        ],
      },
      r: {
        id: 'lambda-r',
        name: 'Reduce',
        description:
          'Channel all accumulated function calls into a single target, dealing massive magical damage. Stuns for 1 tick if Closure is active.',
        manaCost: 250,
        cooldownTicks: 22,
        targetType: 'hero',
        damageType: 'magical',
        effects: [
          { type: 'damage', value: 300, damageType: 'magical' },
          { type: 'stun', value: 1, duration: 1, description: 'Only if Closure active' },
        ],
      },
    },
  },

  mutex: {
    id: 'mutex',
    name: 'Mutex',
    role: 'offlaner',
    lore: 'A mutual exclusion lock given form. Mutex thrives in contested space, growing harder to move and more dangerous the longer it holds its ground.',
    baseStats: {
      hp: 680,
      mp: 260,
      attack: 55,
      defense: 6,
      magicResist: 20,
      moveSpeed: 1,
      attackRange: 'melee',
    },
    growthPerLevel: {
      hp: 70,
      mp: 20,
      attack: 6,
      defense: 2,
    },
    passive: {
      id: 'mutex-passive',
      name: 'Deadlock',
      description:
        'Gain +1 defense and +3 attack per tick while remaining in the same zone, stacking up to 5 times. Moving resets stacks.',
      manaCost: 0,
      cooldownTicks: 0,
      targetType: 'none',
      effects: [
        { type: 'buff', value: 1, description: 'Defense per stack' },
        { type: 'buff', value: 3, description: 'Attack per stack' },
      ],
    },
    abilities: {
      q: {
        id: 'mutex-q',
        name: 'Lock',
        description:
          'Slam the target with a locking mechanism, dealing physical damage and rooting them for 1 tick.',
        manaCost: 60,
        cooldownTicks: 3,
        targetType: 'hero',
        damageType: 'physical',
        effects: [
          { type: 'damage', value: 90, damageType: 'physical' },
          { type: 'root', value: 1, duration: 1 },
        ],
      },
      w: {
        id: 'mutex-w',
        name: 'Critical Section',
        description:
          'Enter a critical section, gaining a shield and bonus defense for 2 ticks. Roots self during the duration.',
        manaCost: 70,
        cooldownTicks: 5,
        targetType: 'self',
        effects: [
          { type: 'shield', value: 180, duration: 2 },
          { type: 'buff', value: 10, duration: 2, description: 'Bonus defense' },
          { type: 'root', value: 1, duration: 2, description: 'Self-root' },
        ],
      },
      e: {
        id: 'mutex-e',
        name: 'Spinlock',
        description:
          'Rapidly strike enemies in the zone 3 times, each hit applying a stacking 10% slow for 2 ticks.',
        manaCost: 50,
        cooldownTicks: 4,
        targetType: 'none',
        damageType: 'physical',
        effects: [
          { type: 'damage', value: 40, damageType: 'physical', description: 'Per hit (x3)' },
          { type: 'slow', value: 10, duration: 2, description: 'Stacking slow per hit' },
        ],
      },
      r: {
        id: 'mutex-r',
        name: 'Priority Inversion',
        description:
          'Invert priority in the zone, fearing all enemies for 2 ticks and dealing physical damage. Bonus damage for each Deadlock stack.',
        manaCost: 200,
        cooldownTicks: 24,
        targetType: 'none',
        damageType: 'physical',
        effects: [
          { type: 'damage', value: 150, damageType: 'physical', description: 'Base + 30 per Deadlock stack' },
          { type: 'fear', value: 1, duration: 2 },
        ],
      },
    },
  },

  ping: {
    id: 'ping',
    name: 'Ping',
    role: 'offlaner',
    lore: 'A relentless ICMP echo that probes enemy defenses from afar. Ping disrupts timing, delays responses, and controls space through persistent harassment.',
    baseStats: {
      hp: 580,
      mp: 310,
      attack: 50,
      defense: 4,
      magicResist: 18,
      moveSpeed: 1,
      attackRange: 'ranged',
    },
    growthPerLevel: {
      hp: 55,
      mp: 28,
      attack: 5,
      defense: 1,
    },
    passive: {
      id: 'ping-passive',
      name: 'Latency',
      description:
        'Basic attacks add +1 tick to the target\'s next ability cooldown.',
      manaCost: 0,
      cooldownTicks: 0,
      targetType: 'none',
      effects: [
        { type: 'debuff', value: 1, description: 'Cooldown increase per attack' },
      ],
    },
    abilities: {
      q: {
        id: 'ping-q',
        name: 'ICMP Echo',
        description:
          'Send a probing ping that deals magical damage. Can target enemies in adjacent zones for 60% damage.',
        manaCost: 45,
        cooldownTicks: 2,
        targetType: 'unit',
        damageType: 'magical',
        effects: [
          { type: 'damage', value: 80, damageType: 'magical' },
          { type: 'damage', value: 48, damageType: 'magical', description: 'Adjacent zone damage (60%)' },
        ],
      },
      w: {
        id: 'ping-w',
        name: 'Timeout',
        description:
          'Disrupt a target\'s connection, silencing them for 1 tick and reducing their attack damage by 20% for 3 ticks.',
        manaCost: 75,
        cooldownTicks: 5,
        targetType: 'hero',
        effects: [
          { type: 'silence', value: 1, duration: 1 },
          { type: 'debuff', value: 20, duration: 3, description: 'Attack reduction %' },
        ],
      },
      e: {
        id: 'ping-e',
        name: 'Tracepath',
        description:
          'Trace the network path, granting vision of the current and adjacent zones for 3 ticks and boosting move speed.',
        manaCost: 60,
        cooldownTicks: 6,
        targetType: 'self',
        effects: [
          { type: 'reveal', value: 2, duration: 3, description: 'Zone vision range' },
          { type: 'buff', value: 1, duration: 2, description: 'Move speed bonus' },
        ],
      },
      r: {
        id: 'ping-r',
        name: 'Flood',
        description:
          'Flood the zone with packets, dealing magical damage over time for 3 ticks and slowing enemies who try to leave.',
        manaCost: 200,
        cooldownTicks: 22,
        targetType: 'none',
        damageType: 'magical',
        effects: [
          { type: 'dot', value: 180, duration: 3, damageType: 'magical', description: 'Total damage over 3 ticks' },
          { type: 'slow', value: 40, duration: 3, description: 'Movement slow %' },
        ],
      },
    },
  },

  cron: {
    id: 'cron',
    name: 'Cron',
    role: 'support',
    lore: 'A scheduled task daemon that executes healing protocols on a precise timer. Cron maintains the team with clockwork efficiency, cleansing corruption and rallying allies.',
    baseStats: {
      hp: 620,
      mp: 380,
      attack: 42,
      defense: 5,
      magicResist: 22,
      moveSpeed: 1,
      attackRange: 'melee',
    },
    growthPerLevel: {
      hp: 60,
      mp: 30,
      attack: 3,
      defense: 1,
    },
    passive: {
      id: 'cron-passive',
      name: 'Scheduled Task',
      description:
        'Every 4th game tick, automatically heal the lowest HP ally in the zone for 40 HP.',
      manaCost: 0,
      cooldownTicks: 0,
      targetType: 'none',
      effects: [
        { type: 'heal', value: 40, description: 'Auto-heal amount' },
        { type: 'buff', value: 4, description: 'Tick interval' },
      ],
    },
    abilities: {
      q: {
        id: 'cron-q',
        name: 'Uptime',
        description:
          'Buff an allied hero, increasing their attack by 15 and defense by 5 for 3 ticks.',
        manaCost: 65,
        cooldownTicks: 3,
        targetType: 'hero',
        effects: [
          { type: 'buff', value: 15, duration: 3, description: 'Bonus attack' },
          { type: 'buff', value: 5, duration: 3, description: 'Bonus defense' },
        ],
      },
      w: {
        id: 'cron-w',
        name: 'Purge',
        description:
          'Cleanse all debuffs from an allied hero and grant them a shield for 2 ticks.',
        manaCost: 90,
        cooldownTicks: 5,
        targetType: 'hero',
        effects: [
          { type: 'buff', value: 1, description: 'Debuff cleanse' },
          { type: 'shield', value: 130, duration: 2 },
        ],
      },
      e: {
        id: 'cron-e',
        name: 'Kill Signal',
        description:
          'Send a kill signal to an enemy, dealing physical damage and taunting them for 1 tick.',
        manaCost: 55,
        cooldownTicks: 4,
        targetType: 'hero',
        damageType: 'physical',
        effects: [
          { type: 'damage', value: 75, damageType: 'physical' },
          { type: 'taunt', value: 1, duration: 1 },
        ],
      },
      r: {
        id: 'cron-r',
        name: 'Crontab',
        description:
          'Install a healing crontab for all allies in the zone, restoring HP and MP over 4 ticks.',
        manaCost: 250,
        cooldownTicks: 25,
        targetType: 'none',
        effects: [
          { type: 'heal', value: 300, description: 'Total HP restored over 4 ticks' },
          { type: 'buff', value: 60, description: 'Total MP restored over 4 ticks' },
        ],
      },
    },
  },

  traceroute: {
    id: 'traceroute',
    name: 'Traceroute',
    role: 'assassin',
    lore: 'A roaming hunter that traces the path between nodes, gaining momentum with each hop. Traceroute strikes hardest when targets are isolated and far from help.',
    baseStats: {
      hp: 470,
      mp: 290,
      attack: 62,
      defense: 2,
      magicResist: 14,
      moveSpeed: 2,
      attackRange: 'ranged',
    },
    growthPerLevel: {
      hp: 44,
      mp: 22,
      attack: 7,
      defense: 1,
    },
    passive: {
      id: 'traceroute-passive',
      name: 'Hop Count',
      description:
        'Moving to a new zone grants +20% bonus damage per zone moved, stacking up to 3 times. Stacks decay after 2 ticks without moving.',
      manaCost: 0,
      cooldownTicks: 0,
      targetType: 'none',
      effects: [
        { type: 'buff', value: 20, description: 'Bonus damage % per hop' },
        { type: 'buff', value: 3, description: 'Max stacks' },
      ],
    },
    abilities: {
      q: {
        id: 'traceroute-q',
        name: 'Probe',
        description:
          'Fire a tracing probe at a target, dealing physical damage. Deals 35% bonus damage if the target has no allies in their zone.',
        manaCost: 50,
        cooldownTicks: 3,
        targetType: 'hero',
        damageType: 'physical',
        effects: [
          { type: 'damage', value: 100, damageType: 'physical' },
          { type: 'damage', value: 35, damageType: 'physical', description: 'Isolation bonus %' },
        ],
      },
      w: {
        id: 'traceroute-w',
        name: 'TTL',
        description:
          'Set a time-to-live trap on a target. After 1 tick delay, root the target for 2 ticks.',
        manaCost: 70,
        cooldownTicks: 5,
        targetType: 'hero',
        effects: [
          { type: 'root', value: 1, duration: 2, description: 'Delayed root after 1 tick' },
        ],
      },
      e: {
        id: 'traceroute-e',
        name: 'Next Hop',
        description:
          'Dash to an adjacent zone, leaving a shadow at the origin. Can recast within 2 ticks to return to shadow.',
        manaCost: 60,
        cooldownTicks: 5,
        targetType: 'zone',
        effects: [
          { type: 'teleport', value: 1, description: 'Dash to adjacent zone' },
          { type: 'buff', value: 2, duration: 2, description: 'Return shadow duration' },
        ],
      },
      r: {
        id: 'traceroute-r',
        name: 'Full Trace',
        description:
          'Reveal all enemy heroes on the map for 3 ticks and gain a massive damage boost of 50% for 2 ticks.',
        manaCost: 200,
        cooldownTicks: 30,
        targetType: 'none',
        effects: [
          { type: 'reveal', value: 99, duration: 3, description: 'Global reveal' },
          { type: 'buff', value: 50, duration: 2, description: 'Damage boost %' },
        ],
      },
    },
  },

  thread: {
    id: 'thread',
    name: 'Thread',
    role: 'carry',
    lore: 'A parallel execution unit that multiplies its strikes across targets. Thread starts slow but becomes an unstoppable force in teamfights, weaving destruction through every enemy.',
    baseStats: {
      hp: 530,
      mp: 270,
      attack: 60,
      defense: 3,
      magicResist: 15,
      moveSpeed: 1,
      attackRange: 'ranged',
    },
    growthPerLevel: {
      hp: 52,
      mp: 24,
      attack: 8,
      defense: 1,
    },
    passive: {
      id: 'thread-passive',
      name: 'Multithread',
      description:
        'Basic attacks splash to 1 additional enemy in the zone for 40% damage. At level 10+, splashes to 2 additional enemies.',
      manaCost: 0,
      cooldownTicks: 0,
      targetType: 'none',
      effects: [
        { type: 'damage', value: 40, damageType: 'physical', description: 'Splash damage %' },
        { type: 'buff', value: 1, description: 'Extra targets (2 at level 10+)' },
      ],
    },
    abilities: {
      q: {
        id: 'thread-q',
        name: 'Fork',
        description:
          'Fork a new thread of power, dealing physical damage to a target and buffing own attack by 20 for 3 ticks.',
        manaCost: 55,
        cooldownTicks: 3,
        targetType: 'hero',
        damageType: 'physical',
        effects: [
          { type: 'damage', value: 85, damageType: 'physical' },
          { type: 'buff', value: 20, duration: 3, description: 'Bonus attack' },
        ],
      },
      w: {
        id: 'thread-w',
        name: 'Sync Barrier',
        description:
          'Create a synchronization barrier shield. Shield strength increases by 40 for each allied hero in the zone.',
        manaCost: 70,
        cooldownTicks: 5,
        targetType: 'self',
        effects: [
          { type: 'shield', value: 100, duration: 3, description: 'Base shield + 40 per ally' },
        ],
      },
      e: {
        id: 'thread-e',
        name: 'Yield',
        description:
          'Mark a target. Consecutive attacks on the marked target deal 25% bonus damage for 3 ticks.',
        manaCost: 60,
        cooldownTicks: 4,
        targetType: 'hero',
        effects: [
          { type: 'debuff', value: 25, duration: 3, description: 'Bonus damage taken %' },
        ],
      },
      r: {
        id: 'thread-r',
        name: 'Thread Pool',
        description:
          'Overclock all threads: for the next 4 ticks, basic attacks hit ALL enemies in the zone.',
        manaCost: 250,
        cooldownTicks: 28,
        targetType: 'self',
        effects: [
          { type: 'buff', value: 4, duration: 4, description: 'AoE attacks duration' },
        ],
      },
    },
  },

  cache: {
    id: 'cache',
    name: 'Cache',
    role: 'tank',
    lore: 'A memory cache that absorbs and stores incoming data. Cache converts the punishment it endures into explosive offensive power, punishing enemies who dare attack it.',
    baseStats: {
      hp: 700,
      mp: 260,
      attack: 45,
      defense: 7,
      magicResist: 24,
      moveSpeed: 1,
      attackRange: 'ranged',
    },
    growthPerLevel: {
      hp: 72,
      mp: 18,
      attack: 4,
      defense: 2,
      magicResist: 2,
    },
    passive: {
      id: 'cache-passive',
      name: 'Write-Back',
      description:
        'Stores 15% of all damage taken as cached energy, up to 30% of max HP. Cached energy can be consumed by abilities.',
      manaCost: 0,
      cooldownTicks: 0,
      targetType: 'none',
      effects: [
        { type: 'buff', value: 15, description: 'Damage stored %' },
        { type: 'buff', value: 30, description: 'Max stored % of max HP' },
      ],
    },
    abilities: {
      q: {
        id: 'cache-q',
        name: 'Cache Hit',
        description:
          'Strike a target with stored energy, dealing physical damage plus 50% of currently cached energy as bonus damage.',
        manaCost: 55,
        cooldownTicks: 3,
        targetType: 'hero',
        damageType: 'physical',
        effects: [
          { type: 'damage', value: 80, damageType: 'physical' },
          { type: 'damage', value: 50, damageType: 'physical', description: '% of cached energy as bonus' },
        ],
      },
      w: {
        id: 'cache-w',
        name: 'Flush',
        description:
          'Flush the cache, converting all stored energy into a shield that lasts 3 ticks.',
        manaCost: 60,
        cooldownTicks: 5,
        targetType: 'self',
        effects: [
          { type: 'shield', value: 1, duration: 3, description: 'Shield equal to cached energy' },
        ],
      },
      e: {
        id: 'cache-e',
        name: 'Invalidate',
        description:
          'Invalidate a target\'s healing cache, dealing magical damage and applying anti-heal (50% reduced healing) for 3 ticks.',
        manaCost: 65,
        cooldownTicks: 4,
        targetType: 'hero',
        damageType: 'magical',
        effects: [
          { type: 'damage', value: 70, damageType: 'magical' },
          { type: 'debuff', value: 50, duration: 3, description: 'Healing reduction %' },
        ],
      },
      r: {
        id: 'cache-r',
        name: 'Eviction',
        description:
          'Evict all cached energy in a devastating burst, dealing pure AoE damage equal to 100% of cached energy to all enemies in the zone and slowing them.',
        manaCost: 180,
        cooldownTicks: 24,
        targetType: 'none',
        damageType: 'pure',
        effects: [
          { type: 'damage', value: 1, damageType: 'pure', description: 'Damage equals cached energy' },
          { type: 'slow', value: 35, duration: 2, description: 'Movement slow %' },
        ],
      },
    },
  },
} as const

export const HERO_IDS = Object.keys(HEROES) as ReadonlyArray<string>
