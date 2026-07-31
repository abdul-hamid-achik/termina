import type { HeroDef } from '../types/hero'

export const HEROES: Record<string, HeroDef> = {
  echo: {
    id: 'echo',
    name: 'Echo',
    role: 'carry',
    posture: 'HARDLINE',
    attackType: 'kinetic',
    difficulty: 'medium',
    openingCombo: ['q', 'r'],
    oneLineTip:
      'Lock onto one target and never switch: Resonance adds 8% per consecutive attack, and E only fires once your basic attacks have stored feedback stacks.',
    baseStats: {
      integ: 550,
      bw: 280,
      attack: 58,
      plate: 3,
      ice: 15,
    },
    growthPerLevel: {
      integ: 55,
      bw: 25,
      attack: 7,
      plate: 1,
      ice: 1,
    },
    passive: {
      id: 'echo-passive',
      name: 'Resonance',
      description:
        'Each consecutive attack on the same target deals 8% more damage, stacking up to 5 times.',
      bwCost: 0,
      cooldownCycles: 0,
      targetType: 'none',
      effects: [{ type: 'buff', value: 8, description: 'Damage amplification per stack' }],
    },
    abilities: {
      q: {
        id: 'echo-q',
        name: 'Resonance',
        description:
          'Fire a projectile dealing kinetic damage to target and bouncing to 1 nearby enemy for 50% damage.',
        bwCost: 40,
        bwCostByLevel: [40, 50, 60, 70],
        cooldownCycles: 6,
        targetType: 'hero',
        damageType: 'kinetic',
        effects: [
          { type: 'damage', value: 80, damageType: 'kinetic' },
          { type: 'damage', value: 40, damageType: 'kinetic', description: 'Bounce damage (50%)' },
        ],
      },
      // W: Phase Shift — dodge next attack
      w: {
        id: 'echo-w',
        name: 'Phase Shift',
        description: 'Phase out to dodge the next incoming attack.',
        bwCost: 50,
        bwCostByLevel: [50, 60, 70, 80],
        cooldownCycles: 12,
        targetType: 'self',
        effects: [{ type: 'buff', value: 1, duration: 1, description: 'Dodge 1 attack' }],
      },
      e: {
        id: 'echo-e',
        name: 'Feedback Loop',
        description:
          'Passive: Attacks store 10 INTEG as feedback stacks. Active: Consume stacks to deal 2x as burst damage.',
        bwCost: 0,
        cooldownCycles: 8,
        targetType: 'hero',
        damageType: 'kinetic',
        effects: [
          { type: 'buff', value: 10, description: 'INTEG stored per attack' },
          {
            type: 'damage',
            value: 20,
            damageType: 'kinetic',
            description: 'Per stack (2x stored)',
          },
        ],
      },
      r: {
        id: 'echo-r',
        name: 'Cascade',
        description: 'Unleash 6 attacks on a target, each dealing kinetic damage.',
        bwCost: 150,
        bwCostByLevel: [150, 175, 200],
        cooldownCycles: 50,
        targetType: 'hero',
        damageType: 'kinetic',
        effects: [
          { type: 'damage', value: 60, damageType: 'kinetic', description: 'Per hit (x6)' },
        ],
      },
    },
  },

  sentry: {
    id: 'sentry',
    name: 'Sentry',
    role: 'support',
    posture: 'HARDLINE',
    attackType: 'kinetic',
    difficulty: 'easy',
    openingCombo: ['w', 'q', 'e'],
    oneLineTip:
      "Shield before the damage lands — Barrier absorbs it, Mend only heals what's left — and stand in your carry's zone so the passive's +5 plate reaches them.",
    baseStats: {
      integ: 600,
      bw: 350,
      attack: 40,
      plate: 4,
      ice: 20,
    },
    growthPerLevel: {
      integ: 60,
      bw: 35,
      attack: 3,
      plate: 1,
      ice: 1,
    },
    passive: {
      id: 'sentry-passive',
      name: 'Overwatch',
      description:
        'Grants vision of adjacent zones. Allied heroes in the same zone gain 5 bonus plate.',
      bwCost: 0,
      cooldownCycles: 0,
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
        description: 'Heal an allied hero.',
        bwCost: 80,
        cooldownCycles: 6,
        targetType: 'ally',
        effects: [{ type: 'heal', value: 80 }],
      },
      w: {
        id: 'sentry-w',
        name: 'Barrier',
        description: 'Grant a shield to an ally that absorbs damage for 3 cycles.',
        bwCost: 100,
        cooldownCycles: 10,
        targetType: 'ally',
        effects: [{ type: 'shield', value: 100, duration: 3 }],
      },
      e: {
        id: 'sentry-e',
        name: 'Scan Pulse',
        description: 'Reveal zone and slow enemies 30% for 2 cycles.',
        bwCost: 70,
        cooldownCycles: 12,
        targetType: 'none',
        effects: [
          { type: 'reveal', value: 1, duration: 2 },
          { type: 'slow', value: 30, duration: 2, description: 'Movement slow %' },
        ],
      },
      r: {
        id: 'sentry-r',
        name: 'Fortify',
        description: 'Grant allies in your zone +3 plate and 150 shield for 4 cycles.',
        bwCost: 250,
        cooldownCycles: 60,
        targetType: 'none',
        effects: [
          { type: 'shield', value: 150, duration: 4 },
          { type: 'buff', value: 3, duration: 4, description: 'Bonus plate' },
        ],
      },
    },
  },

  daemon: {
    id: 'daemon',
    name: 'Daemon',
    role: 'assassin',
    posture: 'BREACH',
    attackType: 'code',
    difficulty: 'hard',
    openingCombo: ['q', 'e'],
    oneLineTip:
      "Sudo (E) fails outright above 30% INTEG: open with Inject's damage-over-time, watch the INTEG bar, and only then press E.",
    baseStats: {
      integ: 480,
      bw: 300,
      attack: 65,
      plate: 2,
      ice: 12,
    },
    growthPerLevel: {
      integ: 45,
      bw: 20,
      attack: 8,
      plate: 1,
      ice: 1,
    },
    passive: {
      id: 'daemon-passive',
      name: 'Stealth Process',
      description:
        'After 2 cycles without attacking or taking damage, become invisible. First attack from stealth deals 50% bonus damage.',
      bwCost: 0,
      cooldownCycles: 0,
      targetType: 'none',
      effects: [
        { type: 'buff', value: 2, description: 'Ticks to stealth' },
        { type: 'damage', value: 50, damageType: 'kinetic', description: 'Bonus damage %' },
      ],
    },
    abilities: {
      q: {
        id: 'daemon-q',
        name: 'Inject',
        description: 'Apply a DoT debuff on the target, dealing code damage over 3 cycles.',
        bwCost: 50,
        bwCostByLevel: [50, 70, 90, 110],
        cooldownCycles: 7,
        targetType: 'hero',
        damageType: 'code',
        effects: [
          {
            type: 'dot',
            value: 60,
            duration: 3,
            damageType: 'code',
            description: 'Total damage over 3 cycles',
          },
        ],
      },
      w: {
        id: 'daemon-w',
        name: 'Fork Bomb',
        description:
          'Create a decoy in the target zone for 3 cycles, granting vision of that zone.',
        bwCost: 100,
        cooldownCycles: 18,
        targetType: 'zone',
        effects: [{ type: 'reveal', value: 3, duration: 3, description: 'Zone vision via decoy' }],
      },
      e: {
        id: 'daemon-e',
        name: 'Sudo',
        description:
          'Execute a target below 30% INTEG with black damage. Fails if target is above the threshold.',
        bwCost: 150,
        bwCostByLevel: [150, 200, 250],
        cooldownCycles: 20,
        targetType: 'hero',
        damageType: 'black',
        effects: [
          { type: 'execute', value: 30, description: 'INTEG threshold %' },
          { type: 'damage', value: 300, damageType: 'black' },
        ],
      },
      r: {
        id: 'daemon-r',
        name: 'Root Access',
        description: 'Teleport to any zone on the map.',
        bwCost: 200,
        bwCostByLevel: [200, 300, 400],
        cooldownCycles: 60,
        targetType: 'zone',
        effects: [{ type: 'teleport', value: 1, description: 'Global teleport' }],
      },
    },
  },

  kernel: {
    id: 'kernel',
    name: 'Kernel',
    role: 'tank',
    posture: 'HOLD',
    attackType: 'kinetic',
    difficulty: 'easy',
    openingCombo: ['e', 'w', 'q'],
    oneLineTip:
      'Taunt first (Core Dump), then shield (Buffer): the buffer soaks exactly the hits you just pulled onto yourself.',
    baseStats: {
      integ: 750,
      bw: 250,
      attack: 48,
      plate: 8,
      ice: 25,
    },
    growthPerLevel: {
      integ: 80,
      bw: 15,
      attack: 4,
      plate: 2,
      ice: 2,
    },
    passive: {
      id: 'kernel-passive',
      name: 'Hardened',
      description: 'Permanently take 10% reduced damage from all sources.',
      bwCost: 0,
      cooldownCycles: 0,
      targetType: 'none',
      effects: [{ type: 'buff', value: 1, description: 'Defense per 5% INTEG missing' }],
    },
    abilities: {
      q: {
        id: 'kernel-q',
        name: 'Interrupt',
        description: 'Interrupt a target enemy hero in your zone, stunning them for 1 cycle.',
        bwCost: 80,
        bwCostByLevel: [80, 90, 100, 110],
        cooldownCycles: 10,
        targetType: 'hero',
        effects: [{ type: 'stun', value: 1, duration: 1 }],
      },
      w: {
        id: 'kernel-w',
        name: 'Buffer',
        description: 'Buffer incoming damage with a self shield that absorbs damage for 3 cycles.',
        bwCost: 100,
        bwCostByLevel: [100, 120, 140, 160],
        cooldownCycles: 14,
        targetType: 'self',
        effects: [{ type: 'shield', value: 150, duration: 3 }],
      },
      e: {
        id: 'kernel-e',
        name: 'Core Dump',
        description: 'Force all enemy heroes in the zone to attack Kernel for 2 cycles.',
        bwCost: 120,
        bwCostByLevel: [120, 140, 160, 180],
        cooldownCycles: 18,
        targetType: 'none',
        effects: [{ type: 'taunt', value: 1, duration: 2 }],
      },
      r: {
        id: 'kernel-r',
        name: 'Panic',
        description:
          'Trigger a kernel panic, displacing all enemy heroes in the zone to a random adjacent zone and fearing them.',
        bwCost: 200,
        bwCostByLevel: [200, 300, 400],
        cooldownCycles: 50,
        targetType: 'none',
        effects: [
          { type: 'fear', value: 1, duration: 1, description: 'Displace to random adjacent zone' },
        ],
      },
    },
  },

  regex: {
    id: 'regex',
    name: 'Regex',
    role: 'mage',
    posture: 'BREACH',
    attackType: 'code',
    difficulty: 'medium',
    openingCombo: ['q', 'w', 'r'],
    oneLineTip:
      "Everything keys off Match's mark — 15% magic vulnerability, plus another 15% from the passive if every follow-up lands on that same target within 3 cycles.",
    baseStats: {
      integ: 450,
      bw: 400,
      attack: 42,
      plate: 1,
      ice: 18,
    },
    growthPerLevel: {
      integ: 40,
      bw: 40,
      attack: 3,
      plate: 1,
      ice: 1,
    },
    passive: {
      id: 'regex-passive',
      name: 'Pattern Cache',
      description:
        'Casting an ability on the same target within 3 cycles deals 15% bonus code damage.',
      bwCost: 0,
      cooldownCycles: 0,
      targetType: 'none',
      effects: [{ type: 'buff', value: 15, description: 'Bonus code damage %' }],
    },
    abilities: {
      q: {
        id: 'regex-q',
        name: 'Match',
        description:
          'Launch a pattern bolt that deals code damage and marks the target, increasing code damage taken by 15% for 3 cycles.',
        bwCost: 60,
        cooldownCycles: 5,
        targetType: 'hero',
        damageType: 'code',
        effects: [
          { type: 'damage', value: 70, damageType: 'code' },
          { type: 'debuff', value: 15, duration: 3, description: 'Magic vulnerability %' },
        ],
      },
      w: {
        id: 'regex-w',
        name: 'Capture Group',
        description: 'Root an enemy hero in place for 2 cycles, dealing code damage over time.',
        bwCost: 90,
        cooldownCycles: 10,
        targetType: 'hero',
        damageType: 'code',
        effects: [
          { type: 'root', value: 1, duration: 2 },
          {
            type: 'dot',
            value: 90,
            duration: 3,
            damageType: 'code',
            description: 'Total damage over 3 cycles',
          },
        ],
      },
      e: {
        id: 'regex-e',
        name: 'Substitution',
        description:
          'Swap positions with a target hero (ally or enemy). Both are stunned for 1 cycle.',
        bwCost: 100,
        cooldownCycles: 15,
        targetType: 'hero',
        effects: [
          { type: 'teleport', value: 1, description: 'Position swap' },
          { type: 'stun', value: 1, duration: 1, description: 'Both stunned' },
        ],
      },
      r: {
        id: 'regex-r',
        name: 'Catastrophic Backtracking',
        description:
          'Deal damage to a target based on their missing BW. Each 100 missing BW deals 50 damage. Also silences for 2 cycles.',
        bwCost: 300,
        cooldownCycles: 60,
        targetType: 'hero',
        damageType: 'code',
        effects: [
          { type: 'damage', value: 50, damageType: 'code', description: 'Per 100 missing BW' },
          { type: 'silence', value: 1, duration: 2 },
        ],
      },
    },
  },

  socket: {
    id: 'socket',
    name: 'Socket',
    role: 'offlaner',
    posture: 'ROAM',
    attackType: 'kinetic',
    difficulty: 'medium',
    openingCombo: ['e', 'q', 'w'],
    oneLineTip:
      'Accept (E) drags a target out of position and Bind (Q) pins it there — pull first, root second, and let your team collapse.',
    baseStats: {
      integ: 650,
      bw: 300,
      attack: 52,
      plate: 5,
      ice: 18,
    },
    growthPerLevel: {
      integ: 65,
      bw: 25,
      attack: 5,
      plate: 2,
      ice: 1,
    },
    passive: {
      id: 'socket-passive',
      name: 'Persistent Connection',
      description:
        'Basic attacks grant vision of the target and apply a link stack. At 3 stacks, the target is slowed by 20% for 2 cycles.',
      bwCost: 0,
      cooldownCycles: 0,
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
        description: 'Latch onto an enemy hero in your zone, rooting them in place for 2 cycles.',
        bwCost: 80,
        bwCostByLevel: [80, 100, 120, 140],
        cooldownCycles: 12,
        targetType: 'hero',
        effects: [{ type: 'root', value: 1, duration: 2 }],
      },
      w: {
        id: 'socket-w',
        name: 'Listen',
        description:
          'Place an invisible trap in your current zone that damages and reveals the first enemy to enter.',
        bwCost: 60,
        bwCostByLevel: [60, 80, 100, 120],
        cooldownCycles: 16,
        targetType: 'none',
        damageType: 'code',
        effects: [
          { type: 'damage', value: 80, damageType: 'code', description: 'Trap trigger damage' },
          { type: 'reveal', value: 1, duration: 2, description: 'Reveal triggering enemy' },
        ],
      },
      e: {
        id: 'socket-e',
        name: 'Accept',
        description: 'Pull an enemy hero from an adjacent zone one step toward you.',
        bwCost: 100,
        bwCostByLevel: [100, 130, 160, 190],
        cooldownCycles: 20,
        targetType: 'hero',
        effects: [{ type: 'teleport', value: 1, description: 'Pull target one zone closer' }],
      },
      r: {
        id: 'socket-r',
        name: 'Broadcast',
        description:
          'Broadcast a slowing signal across the map, reducing the move speed of all enemy heroes for 3 cycles.',
        bwCost: 200,
        bwCostByLevel: [200, 300, 400],
        cooldownCycles: 55,
        targetType: 'none',
        effects: [
          {
            type: 'slow',
            value: 30,
            duration: 3,
            description: 'Global move speed reduction (% move-fail chance)',
          },
        ],
      },
    },
  },

  proxy: {
    id: 'proxy',
    name: 'Proxy',
    role: 'support',
    posture: 'HOLD',
    attackType: 'code',
    difficulty: 'medium',
    openingCombo: ['w', 'q', 'e'],
    oneLineTip:
      "The passive reroutes 12% of a zone-mate's incoming damage onto you, so buy INTEG early and treat your own INTEG bar as the team's shield.",
    baseStats: {
      integ: 580,
      bw: 380,
      attack: 42,
      plate: 4,
      ice: 20,
    },
    growthPerLevel: {
      integ: 55,
      bw: 35,
      attack: 3,
      plate: 1,
      ice: 1,
    },
    passive: {
      id: 'proxy-passive',
      name: 'Middleman',
      description:
        'Redirects 12% of damage dealt to the nearest ally within the same zone to Proxy instead.',
      bwCost: 0,
      cooldownCycles: 0,
      targetType: 'none',
      effects: [{ type: 'buff', value: 12, description: 'Damage redirect %' }],
    },
    abilities: {
      q: {
        id: 'proxy-q',
        name: 'Packet Redirect',
        description:
          'Hurl a redirected packet at an enemy, dealing code damage and slowing them for 2 cycles.',
        bwCost: 70,
        bwCostByLevel: [70, 90, 110, 130],
        cooldownCycles: 8,
        targetType: 'hero',
        damageType: 'code',
        effects: [
          { type: 'damage', value: 85, damageType: 'code' },
          { type: 'slow', value: 25, duration: 2 },
        ],
      },
      w: {
        id: 'proxy-w',
        name: 'Cache Shield',
        description:
          'Grant an allied hero a cached response shield that absorbs damage for 3 cycles.',
        bwCost: 90,
        bwCostByLevel: [90, 110, 130, 150],
        cooldownCycles: 12,
        targetType: 'ally',
        effects: [{ type: 'shield', value: 140, duration: 3 }],
      },
      e: {
        id: 'proxy-e',
        name: 'Load Balance',
        description:
          'Split healing evenly among all allied heroes in the zone, restoring INTEG to each.',
        bwCost: 100,
        bwCostByLevel: [100, 130, 160, 190],
        cooldownCycles: 10,
        targetType: 'none',
        effects: [{ type: 'heal', value: 180, description: 'Total healing split among allies' }],
      },
      r: {
        id: 'proxy-r',
        name: 'Reverse Proxy',
        description:
          'Swap positions with an allied hero, granting both brief invulnerability for 1 cycle.',
        bwCost: 200,
        bwCostByLevel: [200, 300, 400],
        cooldownCycles: 50,
        targetType: 'ally',
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
    posture: 'BREACH',
    attackType: 'kinetic',
    difficulty: 'medium',
    openingCombo: ['q', 'e', 'w'],
    oneLineTip:
      'Buff with Allocate before you dash: E closes the gap and stuns, W finishes. Stack Overflow costs 20% of your current INTEG, so it is a closer, never an opener.',
    baseStats: {
      integ: 520,
      bw: 300,
      attack: 62,
      plate: 2,
      ice: 14,
    },
    growthPerLevel: {
      integ: 50,
      bw: 25,
      attack: 8,
      plate: 1,
      ice: 1,
    },
    passive: {
      id: 'malloc-passive',
      name: 'Heap Growth',
      description:
        'Gain +1 bonus attack damage for every 100 scrip currently held, up to +40 (at 4000 scrip).',
      bwCost: 0,
      cooldownCycles: 0,
      targetType: 'none',
      effects: [{ type: 'buff', value: 1, description: 'Attack per 100 scrip' }],
    },
    abilities: {
      q: {
        id: 'malloc-q',
        name: 'Allocate',
        description: 'Allocate additional resources, buffing attack damage by 25 for 3 cycles.',
        bwCost: 60,
        bwCostByLevel: [60, 80, 100, 120],
        cooldownCycles: 8,
        targetType: 'self',
        effects: [{ type: 'buff', value: 25, duration: 3, description: 'Bonus attack damage' }],
      },
      w: {
        id: 'malloc-w',
        name: 'Free()',
        description:
          'Deallocate a target, dealing kinetic damage. Deals 40% bonus damage if the target is below 30% INTEG.',
        bwCost: 70,
        bwCostByLevel: [70, 90, 110, 130],
        cooldownCycles: 7,
        targetType: 'hero',
        damageType: 'kinetic',
        effects: [
          { type: 'damage', value: 110, damageType: 'kinetic' },
          {
            type: 'damage',
            value: 44,
            damageType: 'kinetic',
            description: 'Bonus if target below 30% INTEG',
          },
        ],
      },
      e: {
        id: 'malloc-e',
        name: 'Pointer Dereference',
        description: 'Dash to a target enemy, closing the gap and stunning them for 1 cycle.',
        bwCost: 80,
        bwCostByLevel: [80, 100, 120, 140],
        cooldownCycles: 12,
        targetType: 'hero',
        damageType: 'kinetic',
        effects: [
          { type: 'damage', value: 75, damageType: 'kinetic' },
          { type: 'stun', value: 1, duration: 1 },
        ],
      },
      r: {
        id: 'malloc-r',
        name: 'Stack Overflow',
        description:
          'Overflow the stack with raw power, dealing massive kinetic damage to all enemies in the zone. Costs 20% of current INTEG.',
        bwCost: 150,
        bwCostByLevel: [150, 250, 350],
        cooldownCycles: 50,
        targetType: 'none',
        damageType: 'kinetic',
        effects: [{ type: 'damage', value: 280, damageType: 'kinetic', description: 'AOE damage' }],
      },
    },
  },

  cipher: {
    id: 'cipher',
    name: 'Cipher',
    role: 'assassin',
    posture: 'BREACH',
    attackType: 'code',
    difficulty: 'medium',
    openingCombo: ['w', 'q', 'r'],
    oneLineTip:
      "Land two basic attacks before you burst — each strips 2 plate, up to 4 stacks — and remember Encrypt's stealth breaks the instant you attack.",
    baseStats: {
      integ: 480,
      bw: 320,
      attack: 64,
      plate: 2,
      ice: 13,
    },
    growthPerLevel: {
      integ: 45,
      bw: 22,
      attack: 7,
      plate: 1,
      ice: 1,
    },
    passive: {
      id: 'cipher-passive',
      name: 'Encryption Key',
      description:
        "Each attack reduces the target's plate by 2 for 3 cycles, stacking up to 4 times.",
      bwCost: 0,
      cooldownCycles: 0,
      targetType: 'none',
      effects: [
        { type: 'debuff', value: 2, duration: 3, description: 'Defense reduction per stack' },
      ],
    },
    abilities: {
      q: {
        id: 'cipher-q',
        name: 'XOR Strike',
        description:
          'Strike with an XOR-encoded blade, dealing bonus code damage on top of the kinetic attack.',
        bwCost: 50,
        bwCostByLevel: [50, 65, 80, 95],
        cooldownCycles: 5,
        targetType: 'hero',
        damageType: 'code',
        effects: [
          { type: 'damage', value: 70, damageType: 'code' },
          { type: 'damage', value: 40, damageType: 'kinetic', description: 'Base strike' },
        ],
      },
      w: {
        id: 'cipher-w',
        name: 'Encrypt',
        description:
          'Encrypt self, becoming invisible for 2 cycles. Taking damage or attacking breaks stealth.',
        bwCost: 80,
        bwCostByLevel: [80, 100, 120, 140],
        cooldownCycles: 14,
        targetType: 'self',
        effects: [{ type: 'buff', value: 1, duration: 2, description: 'Stealth' }],
      },
      e: {
        id: 'cipher-e',
        name: 'Decrypt',
        description:
          'Decrypt a target enemy, revealing them for 3 cycles and silencing them for 1 cycle.',
        bwCost: 90,
        bwCostByLevel: [90, 110, 130, 150],
        cooldownCycles: 12,
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
          'Unleash 6 rapid strikes of code damage on a target, applying Encryption Key stacks (-2 plate each, max 4) for 3 cycles.',
        bwCost: 220,
        bwCostByLevel: [220, 320, 420],
        cooldownCycles: 45,
        targetType: 'hero',
        damageType: 'code',
        effects: [
          { type: 'damage', value: 55, damageType: 'code', description: 'Per hit (x6)' },
          { type: 'debuff', value: 2, duration: 3, description: '-2 plate per stack (max 4)' },
        ],
      },
    },
  },

  firewall: {
    id: 'firewall',
    name: 'Ablative Shell',
    role: 'tank',
    posture: 'HOLD',
    attackType: 'kinetic',
    difficulty: 'easy',
    openingCombo: ['w', 'e', 'q'],
    oneLineTip:
      'DMZ first, then taunt: the shield eats the damage Access Control pulls onto you, then explodes on everyone standing next to you.',
    baseStats: {
      integ: 720,
      bw: 270,
      attack: 48,
      plate: 7,
      ice: 22,
    },
    growthPerLevel: {
      integ: 75,
      bw: 18,
      attack: 4,
      plate: 2,
      ice: 2,
    },
    passive: {
      id: 'firewall-passive',
      name: 'Packet Inspection',
      description: 'Reflect 8% of all damage taken back to the attacker as code damage.',
      bwCost: 0,
      cooldownCycles: 0,
      targetType: 'none',
      effects: [{ type: 'damage', value: 8, damageType: 'code', description: 'Damage reflect %' }],
    },
    abilities: {
      q: {
        id: 'firewall-q',
        name: 'Port Block',
        description:
          "Block a target's ports, dealing kinetic damage and stunning them for 1 cycle.",
        bwCost: 70,
        bwCostByLevel: [70, 90, 110, 130],
        cooldownCycles: 8,
        targetType: 'hero',
        damageType: 'kinetic',
        effects: [
          { type: 'damage', value: 95, damageType: 'kinetic' },
          { type: 'stun', value: 1, duration: 1 },
        ],
      },
      w: {
        id: 'firewall-w',
        name: 'DMZ',
        description:
          'Create a demilitarized zone shield around self that absorbs damage for 3 cycles. When the shield expires or breaks, it explodes dealing code damage to nearby enemies.',
        bwCost: 80,
        bwCostByLevel: [80, 100, 120, 140],
        cooldownCycles: 14,
        targetType: 'self',
        effects: [
          { type: 'shield', value: 200, duration: 3 },
          { type: 'damage', value: 80, damageType: 'code', description: 'Explosion on break' },
        ],
      },
      e: {
        id: 'firewall-e',
        name: 'Access Control',
        description:
          'Enforce access control in the zone, taunting all enemies to attack Firewall for 2 cycles.',
        bwCost: 60,
        bwCostByLevel: [60, 80, 100, 120],
        cooldownCycles: 16,
        targetType: 'none',
        effects: [{ type: 'taunt', value: 1, duration: 2 }],
      },
      r: {
        id: 'firewall-r',
        name: 'Deep Packet Inspection',
        description:
          'Perform deep inspection on all enemies in the zone, rooting them for 2 cycles and dealing code damage over time.',
        bwCost: 250,
        bwCostByLevel: [250, 350, 450],
        cooldownCycles: 55,
        targetType: 'none',
        damageType: 'code',
        effects: [
          { type: 'root', value: 1, duration: 2 },
          {
            type: 'dot',
            value: 120,
            duration: 3,
            damageType: 'code',
            description: 'Total damage over 3 cycles',
          },
        ],
      },
    },
  },
  null_ref: {
    id: 'null_ref',
    name: 'Null',
    role: 'mage',
    posture: 'ROAM',
    attackType: 'code',
    difficulty: 'medium',
    openingCombo: ['q', 'e', 'r'],
    oneLineTip:
      'Lead with Void Bolt: its 5 magic-resist shred makes every spell after it hit harder, and Dereference adds 50% against anyone already under 25% INTEG.',
    baseStats: {
      integ: 440,
      bw: 420,
      attack: 38,
      plate: 1,
      ice: 16,
    },
    growthPerLevel: {
      integ: 42,
      bw: 40,
      attack: 3,
      plate: 1,
      ice: 1,
    },
    passive: {
      id: 'null_ref-passive',
      name: 'Void Drain',
      description: 'On kill, restore 15% max BW and reduce all ability cooldowns by 2 cycles.',
      bwCost: 0,
      cooldownCycles: 0,
      targetType: 'none',
      effects: [
        { type: 'heal', value: 15, description: 'BW restore % on kill' },
        { type: 'buff', value: 2, description: 'Cooldown reduction cycles' },
      ],
    },
    abilities: {
      q: {
        id: 'null_ref-q',
        name: 'Void Bolt',
        description:
          "Fire a bolt of void energy that deals code damage and shreds the target's iceance by 5 for 3 cycles.",
        bwCost: 55,
        bwCostByLevel: [55, 70, 85, 100],
        cooldownCycles: 5,
        targetType: 'hero',
        damageType: 'code',
        effects: [
          { type: 'damage', value: 90, damageType: 'code' },
          { type: 'debuff', value: 5, duration: 3, description: 'Ice shred' },
        ],
      },
      w: {
        id: 'null_ref-w',
        name: 'Null Pointer',
        description:
          'Silence a target enemy hero for 2 cycles, preventing them from casting abilities.',
        bwCost: 80,
        bwCostByLevel: [80, 95, 110, 125],
        cooldownCycles: 12,
        targetType: 'hero',
        effects: [{ type: 'silence', value: 1, duration: 2 }],
      },
      e: {
        id: 'null_ref-e',
        name: 'Void Zone',
        description:
          'Create a zone of null space, dealing code damage over time to all enemies in the zone for 3 cycles and revealing them.',
        bwCost: 90,
        bwCostByLevel: [90, 105, 120, 135],
        cooldownCycles: 14,
        targetType: 'none',
        damageType: 'code',
        effects: [
          {
            type: 'dot',
            value: 120,
            duration: 3,
            damageType: 'code',
            description: 'Total damage over 3 cycles',
          },
          { type: 'reveal', value: 1, duration: 3 },
        ],
      },
      r: {
        id: 'null_ref-r',
        name: 'Dereference',
        description:
          'Unleash a devastating null dereference on all enemies in the zone, dealing massive code damage. Enemies below 25% INTEG take 50% bonus damage.',
        bwCost: 280,
        bwCostByLevel: [280, 360, 440],
        cooldownCycles: 50,
        targetType: 'none',
        damageType: 'code',
        effects: [
          { type: 'damage', value: 240, damageType: 'code' },
          { type: 'execute', value: 25, description: 'Execute threshold % for bonus damage' },
        ],
      },
    },
  },

  lambda: {
    id: 'lambda',
    name: 'Lambda',
    role: 'mage',
    posture: 'BREACH',
    attackType: 'code',
    difficulty: 'hard',
    openingCombo: ['q', 'e', 'w', 'r'],
    oneLineTip:
      'Three casts inside four cycles arms Closure — only then press Reduce, which costs no BW, hits 30% harder and stuns.',
    baseStats: {
      integ: 460,
      bw: 400,
      attack: 40,
      plate: 1,
      ice: 17,
    },
    growthPerLevel: {
      integ: 38,
      bw: 38,
      attack: 3,
      plate: 1,
      ice: 1,
    },
    passive: {
      id: 'lambda-passive',
      name: 'Closure',
      description:
        'Casting 3 abilities within 4 cycles activates Closure: next ability costs no BW and deals 30% bonus damage.',
      bwCost: 0,
      cooldownCycles: 0,
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
        description: 'Fire a quick bolt of functional energy, dealing code damage to a target.',
        bwCost: 40,
        bwCostByLevel: [40, 50, 60, 70],
        cooldownCycles: 5,
        targetType: 'hero',
        damageType: 'code',
        effects: [{ type: 'damage', value: 75, damageType: 'code' }],
      },
      w: {
        id: 'lambda-w',
        name: 'Return',
        description: 'Mark current zone. After 2 cycles, teleport back to the marked zone.',
        bwCost: 70,
        bwCostByLevel: [70, 85, 100, 115],
        cooldownCycles: 14,
        targetType: 'self',
        effects: [{ type: 'teleport', value: 2, description: 'Delayed return after 2 cycles' }],
      },
      e: {
        id: 'lambda-e',
        name: 'Map',
        description:
          'Apply a slowing field to all enemies in the zone, reducing move speed for 2 cycles and dealing code damage.',
        bwCost: 80,
        bwCostByLevel: [80, 95, 110, 125],
        cooldownCycles: 10,
        targetType: 'none',
        damageType: 'code',
        effects: [
          { type: 'damage', value: 70, damageType: 'code' },
          { type: 'slow', value: 30, duration: 2 },
        ],
      },
      r: {
        id: 'lambda-r',
        name: 'Reduce',
        description:
          'Channel all accumulated function calls into a single target, dealing massive code damage. Stuns for 1 cycle if Closure is active.',
        bwCost: 250,
        bwCostByLevel: [250, 350, 450],
        cooldownCycles: 50,
        targetType: 'hero',
        damageType: 'code',
        effects: [
          { type: 'damage', value: 300, damageType: 'code' },
          { type: 'stun', value: 1, duration: 1, description: 'Only if Closure active' },
        ],
      },
    },
  },

  mutex: {
    id: 'mutex',
    name: 'Mutex',
    role: 'offlaner',
    posture: 'HARDLINE',
    attackType: 'kinetic',
    difficulty: 'medium',
    openingCombo: ['q', 'e', 'r'],
    oneLineTip:
      'Stop moving: five cycles parked in one zone is +5 plate, +15 attack and a far bigger Priority Inversion — one step resets all of it.',
    baseStats: {
      integ: 680,
      bw: 260,
      attack: 55,
      plate: 6,
      ice: 20,
    },
    growthPerLevel: {
      integ: 70,
      bw: 20,
      attack: 6,
      plate: 2,
      ice: 1,
    },
    passive: {
      id: 'mutex-passive',
      name: 'Deadlock',
      description:
        'Gain +1 plate and +3 attack per cycle while remaining in the same zone, stacking up to 5 times. Moving resets stacks.',
      bwCost: 0,
      cooldownCycles: 0,
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
          'Slam the target with a locking mechanism, dealing kinetic damage and rooting them for 1 cycle.',
        bwCost: 60,
        bwCostByLevel: [60, 75, 90, 105],
        cooldownCycles: 8,
        targetType: 'hero',
        damageType: 'kinetic',
        effects: [
          { type: 'damage', value: 90, damageType: 'kinetic' },
          { type: 'root', value: 1, duration: 1 },
        ],
      },
      w: {
        id: 'mutex-w',
        name: 'Critical Section',
        description:
          'Enter a critical section, gaining a shield and bonus plate for 2 cycles. Roots self during the duration.',
        bwCost: 70,
        bwCostByLevel: [70, 85, 100, 115],
        cooldownCycles: 12,
        targetType: 'self',
        effects: [
          { type: 'shield', value: 180, duration: 2 },
          { type: 'buff', value: 10, duration: 2, description: 'Bonus plate' },
          { type: 'root', value: 1, duration: 2, description: 'Self-root' },
        ],
      },
      e: {
        id: 'mutex-e',
        name: 'Spinlock',
        description:
          'Rapidly strike enemies in the zone 3 times, each hit applying a stacking 10% slow for 2 cycles.',
        bwCost: 50,
        bwCostByLevel: [50, 65, 80, 95],
        cooldownCycles: 10,
        targetType: 'none',
        damageType: 'kinetic',
        effects: [
          { type: 'damage', value: 40, damageType: 'kinetic', description: 'Per hit (x3)' },
          { type: 'slow', value: 10, duration: 2, description: 'Stacking slow per hit' },
        ],
      },
      r: {
        id: 'mutex-r',
        name: 'Priority Inversion',
        description:
          'Invert priority in the zone, fearing all enemies for 2 cycles and dealing kinetic damage. Bonus damage for each Deadlock stack.',
        bwCost: 200,
        bwCostByLevel: [200, 280, 360],
        cooldownCycles: 50,
        targetType: 'none',
        damageType: 'kinetic',
        effects: [
          {
            type: 'damage',
            value: 150,
            damageType: 'kinetic',
            description: 'Base + 30 per Deadlock stack',
          },
          { type: 'fear', value: 1, duration: 2 },
        ],
      },
    },
  },

  ping: {
    id: 'ping',
    name: 'Ping',
    role: 'offlaner',
    posture: 'ROAM',
    attackType: 'code',
    difficulty: 'easy',
    openingCombo: ['q', 'w', 'r'],
    oneLineTip:
      'ICMP Echo reaches into an adjacent zone for 60% damage — harass from where they cannot answer, and only step in once Flood is up.',
    baseStats: {
      integ: 580,
      bw: 310,
      attack: 50,
      plate: 4,
      ice: 18,
    },
    growthPerLevel: {
      integ: 55,
      bw: 28,
      attack: 5,
      plate: 1,
      ice: 1,
    },
    passive: {
      id: 'ping-passive',
      name: 'Latency',
      description: "Basic attacks add +1 cycle to the target's next ability cooldown.",
      bwCost: 0,
      cooldownCycles: 0,
      targetType: 'none',
      effects: [{ type: 'debuff', value: 1, description: 'Cooldown increase per attack' }],
    },
    abilities: {
      q: {
        id: 'ping-q',
        name: 'ICMP Echo',
        description:
          'Send a probing ping that deals code damage. Can target enemies in adjacent zones for 60% damage.',
        bwCost: 45,
        bwCostByLevel: [45, 60, 75, 90],
        cooldownCycles: 5,
        targetType: 'hero',
        damageType: 'code',
        effects: [
          { type: 'damage', value: 80, damageType: 'code' },
          {
            type: 'damage',
            value: 48,
            damageType: 'code',
            description: 'Adjacent zone damage (60%)',
          },
        ],
      },
      w: {
        id: 'ping-w',
        name: 'Timeout',
        description:
          "Disrupt a target's connection, silencing them for 1 cycle and reducing their attack damage by 20% for 3 cycles.",
        bwCost: 75,
        bwCostByLevel: [75, 90, 105, 120],
        cooldownCycles: 12,
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
          'Trace the network path, extending your vision one zone further (two hops out) for 3 cycles.',
        bwCost: 60,
        bwCostByLevel: [60, 75, 90, 105],
        cooldownCycles: 14,
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
          'Flood the zone with packets, dealing code damage over time for 3 cycles and slowing enemies who try to leave.',
        bwCost: 200,
        bwCostByLevel: [200, 280, 360],
        cooldownCycles: 50,
        targetType: 'none',
        damageType: 'code',
        effects: [
          {
            type: 'dot',
            value: 180,
            duration: 3,
            damageType: 'code',
            description: 'Total damage over 3 cycles',
          },
          { type: 'slow', value: 40, duration: 3, description: 'Movement slow %' },
        ],
      },
    },
  },

  cron: {
    id: 'cron',
    name: 'Cron',
    role: 'support',
    posture: 'HOLD',
    attackType: 'kinetic',
    difficulty: 'easy',
    openingCombo: ['q', 'w', 'r'],
    oneLineTip:
      'Purge (W) is a cleanse, not just a shield — hold it for the stun or silence that would otherwise kill your carry.',
    baseStats: {
      integ: 620,
      bw: 380,
      attack: 42,
      plate: 5,
      ice: 22,
    },
    growthPerLevel: {
      integ: 60,
      bw: 30,
      attack: 3,
      plate: 1,
      ice: 1,
    },
    passive: {
      id: 'cron-passive',
      name: 'Scheduled Task',
      description:
        'Every 4th game cycle, automatically heal the lowest INTEG ally in the zone for 40 INTEG.',
      bwCost: 0,
      cooldownCycles: 0,
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
          'Buff an allied hero, increasing their attack by 15 and plate by 5 for 3 cycles.',
        bwCost: 65,
        bwCostByLevel: [65, 80, 95, 110],
        cooldownCycles: 8,
        targetType: 'ally',
        effects: [
          { type: 'buff', value: 15, duration: 3, description: 'Bonus attack' },
          { type: 'buff', value: 5, duration: 3, description: 'Bonus plate' },
        ],
      },
      w: {
        id: 'cron-w',
        name: 'Purge',
        description:
          'Cleanse all debuffs from an allied hero and grant them a shield for 2 cycles.',
        bwCost: 90,
        bwCostByLevel: [90, 105, 120, 135],
        cooldownCycles: 12,
        targetType: 'ally',
        effects: [
          { type: 'buff', value: 1, description: 'Debuff cleanse' },
          { type: 'shield', value: 130, duration: 2 },
        ],
      },
      e: {
        id: 'cron-e',
        name: 'Kill Signal',
        description:
          'Send a kill signal to an enemy, dealing kinetic damage and taunting them for 1 cycle.',
        bwCost: 55,
        bwCostByLevel: [55, 70, 85, 100],
        cooldownCycles: 10,
        targetType: 'hero',
        damageType: 'kinetic',
        effects: [
          { type: 'damage', value: 75, damageType: 'kinetic' },
          { type: 'taunt', value: 1, duration: 1 },
        ],
      },
      r: {
        id: 'cron-r',
        name: 'Crontab',
        description:
          'Install a healing crontab for all allies in the zone, restoring INTEG and BW over 4 cycles.',
        bwCost: 250,
        bwCostByLevel: [250, 340, 430],
        cooldownCycles: 55,
        targetType: 'none',
        effects: [
          { type: 'heal', value: 300, description: 'Total INTEG restored over 4 cycles' },
          { type: 'buff', value: 60, description: 'Total BW restored over 4 cycles' },
        ],
      },
    },
  },

  traceroute: {
    id: 'traceroute',
    name: 'Traceroute',
    role: 'assassin',
    posture: 'BREACH',
    attackType: 'code',
    difficulty: 'hard',
    openingCombo: ['e', 'w', 'q'],
    oneLineTip:
      'Arrive fresh: three zones of movement is +60% damage and it decays two cycles after you stop, so mark your escape with Next Hop, pin with TTL, then Probe.',
    baseStats: {
      integ: 470,
      bw: 290,
      attack: 62,
      plate: 2,
      ice: 14,
    },
    growthPerLevel: {
      integ: 44,
      bw: 22,
      attack: 7,
      plate: 1,
      ice: 1,
    },
    passive: {
      id: 'traceroute-passive',
      name: 'Hop Count',
      description:
        'Moving to a new zone grants +20% bonus damage per zone moved, stacking up to 3 times. Stacks decay after 2 cycles without moving.',
      bwCost: 0,
      cooldownCycles: 0,
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
          'Fire a tracing probe at a target, dealing kinetic damage. Deals 35% bonus damage if the target has no allies in their zone.',
        bwCost: 50,
        bwCostByLevel: [50, 65, 80, 95],
        cooldownCycles: 8,
        targetType: 'hero',
        damageType: 'kinetic',
        effects: [
          { type: 'damage', value: 100, damageType: 'kinetic' },
          { type: 'damage', value: 35, damageType: 'kinetic', description: 'Isolation bonus %' },
        ],
      },
      w: {
        id: 'traceroute-w',
        name: 'TTL',
        description: 'Set a time-to-live trap on a target, rooting them for 2 cycles.',
        bwCost: 70,
        bwCostByLevel: [70, 85, 100, 115],
        cooldownCycles: 12,
        targetType: 'hero',
        effects: [
          { type: 'root', value: 1, duration: 2, description: 'Delayed root after 1 cycle' },
        ],
      },
      e: {
        id: 'traceroute-e',
        name: 'Next Hop',
        description:
          'Mark your current position with a return shadow for 2 cycles, allowing a quick repositioning hop.',
        bwCost: 60,
        bwCostByLevel: [60, 75, 90, 105],
        cooldownCycles: 12,
        targetType: 'self',
        effects: [{ type: 'buff', value: 2, duration: 2, description: 'Return shadow duration' }],
      },
      r: {
        id: 'traceroute-r',
        name: 'Full Trace',
        description: 'Reveal all enemy heroes for 3 cycles and gain +50% damage for 2 cycles.',
        bwCost: 200,
        bwCostByLevel: [200, 280, 360],
        cooldownCycles: 60,
        targetType: 'none',
        effects: [
          { type: 'reveal', value: 1, duration: 3, description: 'All enemy heroes' },
          { type: 'buff', value: 50, duration: 2, description: '+50% damage' },
        ],
      },
    },
  },

  thread: {
    id: 'thread',
    name: 'Thread',
    role: 'carry',
    posture: 'ROAM',
    attackType: 'code',
    difficulty: 'easy',
    openingCombo: ['e', 'q', 'r'],
    oneLineTip:
      "Mark with Yield first: the 25% bonus damage taken applies to your whole team's damage, and Thread Pool turns every basic attack into a zone-wide hit.",
    baseStats: {
      integ: 530,
      bw: 270,
      attack: 60,
      plate: 3,
      ice: 15,
    },
    growthPerLevel: {
      integ: 52,
      bw: 24,
      attack: 8,
      plate: 1,
      ice: 1,
    },
    passive: {
      id: 'thread-passive',
      name: 'Multithread',
      description:
        'Basic attacks splash to 1 additional enemy in the zone for 40% damage. At level 10+, splashes to 2 additional enemies.',
      bwCost: 0,
      cooldownCycles: 0,
      targetType: 'none',
      effects: [
        { type: 'damage', value: 40, damageType: 'kinetic', description: 'Splash damage %' },
        { type: 'buff', value: 1, description: 'Extra targets (2 at level 10+)' },
      ],
    },
    abilities: {
      q: {
        id: 'thread-q',
        name: 'Fork',
        description:
          'Fork a new thread of power, dealing kinetic damage to a target and buffing own attack by 20 for 3 cycles.',
        bwCost: 55,
        bwCostByLevel: [55, 70, 85, 100],
        cooldownCycles: 8,
        targetType: 'hero',
        damageType: 'kinetic',
        effects: [
          { type: 'damage', value: 85, damageType: 'kinetic' },
          { type: 'buff', value: 20, duration: 3, description: 'Bonus attack' },
        ],
      },
      w: {
        id: 'thread-w',
        name: 'Sync Barrier',
        description:
          'Create a synchronization barrier shield. Shield strength increases by 40 for each allied hero in the zone.',
        bwCost: 70,
        bwCostByLevel: [70, 85, 100, 115],
        cooldownCycles: 12,
        targetType: 'self',
        effects: [
          { type: 'shield', value: 100, duration: 3, description: 'Base shield + 40 per ally' },
        ],
      },
      e: {
        id: 'thread-e',
        name: 'Yield',
        description:
          'Mark a target. The marked target takes 25% bonus damage from all sources for 3 cycles.',
        bwCost: 60,
        bwCostByLevel: [60, 75, 90, 105],
        cooldownCycles: 10,
        targetType: 'hero',
        effects: [{ type: 'debuff', value: 25, duration: 3, description: 'Bonus damage taken %' }],
      },
      r: {
        id: 'thread-r',
        name: 'Thread Pool',
        description:
          'Overclock all threads: for the next 4 cycles, basic attacks hit ALL enemies in the zone.',
        bwCost: 250,
        bwCostByLevel: [250, 340, 430],
        cooldownCycles: 55,
        targetType: 'self',
        effects: [{ type: 'buff', value: 4, duration: 4, description: 'AoE attacks duration' }],
      },
    },
  },

  cache: {
    id: 'cache',
    name: 'Cache',
    role: 'tank',
    posture: 'HARDLINE',
    attackType: 'code',
    difficulty: 'hard',
    openingCombo: ['e', 'q', 'r'],
    oneLineTip:
      'Cache has to take damage before it can deal any — Q, W and R all spend stored energy, so opening a fight at full INTEG with an empty cache does almost nothing.',
    baseStats: {
      integ: 700,
      bw: 260,
      attack: 45,
      plate: 7,
      ice: 24,
    },
    growthPerLevel: {
      integ: 72,
      bw: 18,
      attack: 4,
      plate: 2,
      ice: 2,
    },
    passive: {
      id: 'cache-passive',
      name: 'Write-Back',
      description:
        'Stores 15% of all damage taken as cached energy, up to 30% of max INTEG. Cached energy can be consumed by abilities.',
      bwCost: 0,
      cooldownCycles: 0,
      targetType: 'none',
      effects: [
        { type: 'buff', value: 15, description: 'Damage stored %' },
        { type: 'buff', value: 30, description: 'Max stored % of max INTEG' },
      ],
    },
    abilities: {
      q: {
        id: 'cache-q',
        name: 'Cache Hit',
        description:
          'Strike a target with stored energy, dealing kinetic damage plus 50% of currently cached energy as bonus damage.',
        bwCost: 55,
        bwCostByLevel: [55, 70, 85, 100],
        cooldownCycles: 8,
        targetType: 'hero',
        damageType: 'kinetic',
        effects: [
          { type: 'damage', value: 80, damageType: 'kinetic' },
          {
            type: 'damage',
            value: 50,
            damageType: 'kinetic',
            description: '% of cached energy as bonus',
          },
        ],
      },
      w: {
        id: 'cache-w',
        name: 'Flush',
        description:
          'Flush the cache, converting all stored energy into a shield that lasts 3 cycles.',
        bwCost: 60,
        bwCostByLevel: [60, 75, 90, 105],
        cooldownCycles: 12,
        targetType: 'self',
        effects: [
          { type: 'shield', value: 1, duration: 3, description: 'Shield equal to cached energy' },
        ],
      },
      e: {
        id: 'cache-e',
        name: 'Invalidate',
        description:
          "Invalidate a target's healing cache, dealing code damage and applying anti-heal (50% reduced healing) for 3 cycles.",
        bwCost: 65,
        bwCostByLevel: [65, 80, 95, 110],
        cooldownCycles: 10,
        targetType: 'hero',
        damageType: 'code',
        effects: [
          { type: 'damage', value: 70, damageType: 'code' },
          { type: 'debuff', value: 50, duration: 3, description: 'Healing reduction %' },
        ],
      },
      r: {
        id: 'cache-r',
        name: 'Eviction',
        description:
          'Evict all cached energy in a devastating burst, dealing black AoE damage equal to 100% of cached energy to all enemies in the zone and slowing them.',
        bwCost: 180,
        bwCostByLevel: [180, 250, 320],
        cooldownCycles: 50,
        targetType: 'none',
        damageType: 'black',
        effects: [
          {
            type: 'damage',
            value: 1,
            damageType: 'black',
            description: 'Damage equals cached energy',
          },
          { type: 'slow', value: 35, duration: 2, description: 'Movement slow %' },
        ],
      },
    },
  },
}

/** Mirrors the KEY SET of {@link HEROES} as a literal-keyed object so the hero
 *  IDs can be surfaced as a literal union type ({@link HeroId}) without losing
 *  the ergonomic `Record<string, HeroDef>` indexing on the runtime `HEROES`
 *  export. Only the keys matter here (values are `0` placeholders); the
 *  `assertHeroKeysInSync()` call below guards the two from drifting at load. */
const _HERO_KEYS = {
  echo: 0,
  sentry: 0,
  daemon: 0,
  kernel: 0,
  regex: 0,
  socket: 0,
  proxy: 0,
  malloc: 0,
  cipher: 0,
  firewall: 0,
  null_ref: 0,
  lambda: 0,
  mutex: 0,
  ping: 0,
  cron: 0,
  traceroute: 0,
  thread: 0,
  cache: 0,
} as const

/** The literal union of every hero ID. Deriving from `_HERO_KEYS` (mirrored
 *  from the `HEROES` registry) gives compile-time exhaustiveness —
 *  `Record<HeroId, T>` now catches missing entries at build time (e.g. a hero
 *  added to `HEROES` but missing from `TALENT_TREES` is a type error, not a
 *  silent runtime gap). **Adding a hero requires updating `_HERO_KEYS` too**,
 *  which is the single source of truth for the `HeroId` union. */
export type HeroId = keyof typeof _HERO_KEYS

export const HERO_IDS: readonly HeroId[] = [
  'echo',
  'sentry',
  'daemon',
  'kernel',
  'regex',
  'socket',
  'proxy',
  'malloc',
  'cipher',
  'firewall',
  'null_ref',
  'lambda',
  'mutex',
  'ping',
  'cron',
  'traceroute',
  'thread',
  'cache',
]

/** Type guard — narrows `string` to `HeroId` if it's a registered hero ID. */
export function isHeroId(id: string): id is HeroId {
  return HERO_IDS.includes(id as HeroId)
}

// Runtime guard: if a hero is added to HEROES but not to _HERO_KEYS, the module
// throws on import. Combined with the `Record<HeroId, TalentTree>` type on
// TALENT_TREES, this gives full coverage — a missing _HERO_KEYS entry fails
// TALENT_TREES at compile time; an extra HEROES entry fails here at load.
// Authored as a named function + bare call (not an unused `const = IIFE`) so a
// production bundler can't tree-shake the check away as dead code.
function assertHeroKeysInSync(): void {
  const registryKeys = new Set(Object.keys(HEROES))
  const declaredKeys = new Set(Object.keys(_HERO_KEYS))
  const missing = [...registryKeys].filter((k) => !declaredKeys.has(k))
  const extra = [...declaredKeys].filter((k) => !registryKeys.has(k))
  if (missing.length || extra.length) {
    throw new Error(
      `HEROES/_HERO_KEYS drift — missing in _HERO_KEYS: [${missing.join(', ')}], extra in _HERO_KEYS: [${extra.join(', ')}]`,
    )
  }
}
assertHeroKeysInSync()
