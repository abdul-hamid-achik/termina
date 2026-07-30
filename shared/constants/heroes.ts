import type { HeroDef } from '../types/hero'

export const HEROES: Record<string, HeroDef> = {
  echo: {
    id: 'echo',
    name: 'Echo',
    role: 'carry',
    lore: 'A recursive signal that grows stronger with each reflection. Echo feeds on combat, amplifying damage the longer a fight persists.',
    difficulty: 'medium',
    openingCombo: ['q', 'r'],
    oneLineTip:
      'Lock onto one target and never switch: Resonance adds 8% per consecutive attack, and E only fires once your basic attacks have stored feedback stacks.',
    baseStats: {
      hp: 550,
      mp: 280,
      attack: 58,
      defense: 3,
      magicResist: 15,
    },
    growthPerLevel: {
      hp: 55,
      mp: 25,
      attack: 7,
      defense: 1,
      magicResist: 1,
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
        name: 'Resonance',
        description:
          'Fire a projectile dealing physical damage to target and bouncing to 1 nearby enemy for 50% damage.',
        manaCost: 40,
        manaCostByLevel: [40, 50, 60, 70],
        cooldownTicks: 6,
        targetType: 'hero',
        damageType: 'physical',
        effects: [
          { type: 'damage', value: 80, damageType: 'physical' },
          { type: 'damage', value: 40, damageType: 'physical', description: 'Bounce damage (50%)' },
        ],
      },
      // W: Phase Shift — dodge next attack
      w: {
        id: 'echo-w',
        name: 'Phase Shift',
        description: 'Phase out to dodge the next incoming attack.',
        manaCost: 50,
        manaCostByLevel: [50, 60, 70, 80],
        cooldownTicks: 12,
        targetType: 'self',
        effects: [{ type: 'buff', value: 1, duration: 1, description: 'Dodge 1 attack' }],
      },
      e: {
        id: 'echo-e',
        name: 'Feedback Loop',
        description:
          'Passive: Attacks store 10 HP as feedback stacks. Active: Consume stacks to deal 2x as burst damage.',
        manaCost: 0,
        cooldownTicks: 8,
        targetType: 'hero',
        damageType: 'physical',
        effects: [
          { type: 'buff', value: 10, description: 'HP stored per attack' },
          {
            type: 'damage',
            value: 20,
            damageType: 'physical',
            description: 'Per stack (2x stored)',
          },
        ],
      },
      r: {
        id: 'echo-r',
        name: 'Cascade',
        description: 'Unleash 6 attacks on a target, each dealing physical damage.',
        manaCost: 150,
        manaCostByLevel: [150, 175, 200],
        cooldownTicks: 50,
        targetType: 'hero',
        damageType: 'physical',
        effects: [
          { type: 'damage', value: 60, damageType: 'physical', description: 'Per hit (x6)' },
        ],
      },
    },
  },

  sentry: {
    id: 'sentry',
    name: 'Sentry',
    role: 'support',
    lore: 'An autonomous watchpoint that protects allies through surveillance and force fields. Sentry sees all and shields the worthy.',
    difficulty: 'easy',
    openingCombo: ['w', 'q', 'e'],
    oneLineTip:
      "Shield before the damage lands — Barrier absorbs it, Mend only heals what's left — and stand in your carry's zone so the passive's +5 defense reaches them.",
    baseStats: {
      hp: 600,
      mp: 350,
      attack: 40,
      defense: 4,
      magicResist: 20,
    },
    growthPerLevel: {
      hp: 60,
      mp: 35,
      attack: 3,
      defense: 1,
      magicResist: 1,
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
        description: 'Heal an allied hero.',
        manaCost: 80,
        cooldownTicks: 6,
        targetType: 'ally',
        effects: [{ type: 'heal', value: 80 }],
      },
      w: {
        id: 'sentry-w',
        name: 'Barrier',
        description: 'Grant a shield to an ally that absorbs damage for 3 cycles.',
        manaCost: 100,
        cooldownTicks: 10,
        targetType: 'ally',
        effects: [{ type: 'shield', value: 100, duration: 3 }],
      },
      e: {
        id: 'sentry-e',
        name: 'Scan Pulse',
        description: 'Reveal zone and slow enemies 30% for 2 cycles.',
        manaCost: 70,
        cooldownTicks: 12,
        targetType: 'none',
        effects: [
          { type: 'reveal', value: 1, duration: 2 },
          { type: 'slow', value: 30, duration: 2, description: 'Movement slow %' },
        ],
      },
      r: {
        id: 'sentry-r',
        name: 'Fortify',
        description: 'Grant allies in your zone +3 defense and 150 shield for 4 cycles.',
        manaCost: 250,
        cooldownTicks: 60,
        targetType: 'none',
        effects: [
          { type: 'shield', value: 150, duration: 4 },
          { type: 'buff', value: 3, duration: 4, description: 'Bonus defense' },
        ],
      },
    },
  },

  daemon: {
    id: 'daemon',
    name: 'Daemon',
    role: 'assassin',
    lore: 'A background process that lurks unseen, striking from the shadows. Daemon deletes targets before they know what hit them.',
    difficulty: 'hard',
    openingCombo: ['q', 'e'],
    oneLineTip:
      "Sudo (E) fails outright above 30% HP: open with Inject's damage-over-time, watch the HP bar, and only then press E.",
    baseStats: {
      hp: 480,
      mp: 300,
      attack: 65,
      defense: 2,
      magicResist: 12,
    },
    growthPerLevel: {
      hp: 45,
      mp: 20,
      attack: 8,
      defense: 1,
      magicResist: 1,
    },
    passive: {
      id: 'daemon-passive',
      name: 'Stealth Process',
      description:
        'After 2 cycles without attacking or taking damage, become invisible. First attack from stealth deals 50% bonus damage.',
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
        description: 'Apply a DoT debuff on the target, dealing magical damage over 3 cycles.',
        manaCost: 50,
        manaCostByLevel: [50, 70, 90, 110],
        cooldownTicks: 7,
        targetType: 'hero',
        damageType: 'magical',
        effects: [
          {
            type: 'dot',
            value: 60,
            duration: 3,
            damageType: 'magical',
            description: 'Total damage over 3 cycles',
          },
        ],
      },
      w: {
        id: 'daemon-w',
        name: 'Fork Bomb',
        description:
          'Create a decoy in the target zone for 3 cycles, granting vision of that zone.',
        manaCost: 100,
        cooldownTicks: 18,
        targetType: 'zone',
        effects: [{ type: 'reveal', value: 3, duration: 3, description: 'Zone vision via decoy' }],
      },
      e: {
        id: 'daemon-e',
        name: 'Sudo',
        description:
          'Execute a target below 30% HP with pure damage. Fails if target is above the threshold.',
        manaCost: 150,
        manaCostByLevel: [150, 200, 250],
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
        description: 'Teleport to any zone on the map.',
        manaCost: 200,
        manaCostByLevel: [200, 300, 400],
        cooldownTicks: 60,
        targetType: 'zone',
        effects: [{ type: 'teleport', value: 1, description: 'Global teleport' }],
      },
    },
  },

  kernel: {
    id: 'kernel',
    name: 'Kernel',
    role: 'tank',
    lore: 'The core process that refuses to die. Kernel absorbs punishment meant for others and grows more dangerous the more damage it takes.',
    difficulty: 'easy',
    openingCombo: ['e', 'w', 'q'],
    oneLineTip:
      'Taunt first (Core Dump), then shield (Buffer): the buffer soaks exactly the hits you just pulled onto yourself.',
    baseStats: {
      hp: 750,
      mp: 250,
      attack: 48,
      defense: 8,
      magicResist: 25,
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
      description: 'Permanently take 10% reduced damage from all sources.',
      manaCost: 0,
      cooldownTicks: 0,
      targetType: 'none',
      effects: [{ type: 'buff', value: 1, description: 'Defense per 5% HP missing' }],
    },
    abilities: {
      q: {
        id: 'kernel-q',
        name: 'Interrupt',
        description: 'Interrupt a target enemy hero in your zone, stunning them for 1 cycle.',
        manaCost: 80,
        manaCostByLevel: [80, 90, 100, 110],
        cooldownTicks: 10,
        targetType: 'hero',
        effects: [{ type: 'stun', value: 1, duration: 1 }],
      },
      w: {
        id: 'kernel-w',
        name: 'Buffer',
        description: 'Buffer incoming damage with a self shield that absorbs damage for 3 cycles.',
        manaCost: 100,
        manaCostByLevel: [100, 120, 140, 160],
        cooldownTicks: 14,
        targetType: 'self',
        effects: [{ type: 'shield', value: 150, duration: 3 }],
      },
      e: {
        id: 'kernel-e',
        name: 'Core Dump',
        description: 'Force all enemy heroes in the zone to attack Kernel for 2 cycles.',
        manaCost: 120,
        manaCostByLevel: [120, 140, 160, 180],
        cooldownTicks: 18,
        targetType: 'none',
        effects: [{ type: 'taunt', value: 1, duration: 2 }],
      },
      r: {
        id: 'kernel-r',
        name: 'Panic',
        description:
          'Trigger a kernel panic, displacing all enemy heroes in the zone to a random adjacent zone and fearing them.',
        manaCost: 200,
        manaCostByLevel: [200, 300, 400],
        cooldownTicks: 50,
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
    lore: 'A pattern matcher of terrifying power. Regex weaves spells from syntax, matching enemies to their doom with arcane expressions.',
    difficulty: 'medium',
    openingCombo: ['q', 'w', 'r'],
    oneLineTip:
      "Everything keys off Match's mark — 15% magic vulnerability, plus another 15% from the passive if every follow-up lands on that same target within 3 cycles.",
    baseStats: {
      hp: 450,
      mp: 400,
      attack: 42,
      defense: 1,
      magicResist: 18,
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
        'Casting an ability on the same target within 3 cycles deals 15% bonus magical damage.',
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
          'Launch a pattern bolt that deals magical damage and marks the target, increasing magic damage taken by 15% for 3 cycles.',
        manaCost: 60,
        cooldownTicks: 5,
        targetType: 'hero',
        damageType: 'magical',
        effects: [
          { type: 'damage', value: 70, damageType: 'magical' },
          { type: 'debuff', value: 15, duration: 3, description: 'Magic vulnerability %' },
        ],
      },
      w: {
        id: 'regex-w',
        name: 'Capture Group',
        description: 'Root an enemy hero in place for 2 cycles, dealing magical damage over time.',
        manaCost: 90,
        cooldownTicks: 10,
        targetType: 'hero',
        damageType: 'magical',
        effects: [
          { type: 'root', value: 1, duration: 2 },
          {
            type: 'dot',
            value: 90,
            duration: 3,
            damageType: 'magical',
            description: 'Total damage over 3 cycles',
          },
        ],
      },
      e: {
        id: 'regex-e',
        name: 'Substitution',
        description:
          'Swap positions with a target hero (ally or enemy). Both are stunned for 1 cycle.',
        manaCost: 100,
        cooldownTicks: 15,
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
          'Deal damage to a target based on their missing mana. Each 100 missing mana deals 50 damage. Also silences for 2 cycles.',
        manaCost: 300,
        cooldownTicks: 60,
        targetType: 'hero',
        damageType: 'magical',
        effects: [
          { type: 'damage', value: 50, damageType: 'magical', description: 'Per 100 missing mana' },
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
    difficulty: 'medium',
    openingCombo: ['e', 'q', 'w'],
    oneLineTip:
      'Accept (E) drags a target out of position and Bind (Q) pins it there — pull first, root second, and let your team collapse.',
    baseStats: {
      hp: 650,
      mp: 300,
      attack: 52,
      defense: 5,
      magicResist: 18,
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
        'Basic attacks grant vision of the target and apply a link stack. At 3 stacks, the target is slowed by 20% for 2 cycles.',
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
        description: 'Latch onto an enemy hero in your zone, rooting them in place for 2 cycles.',
        manaCost: 80,
        manaCostByLevel: [80, 100, 120, 140],
        cooldownTicks: 12,
        targetType: 'hero',
        effects: [{ type: 'root', value: 1, duration: 2 }],
      },
      w: {
        id: 'socket-w',
        name: 'Listen',
        description:
          'Place an invisible trap in your current zone that damages and reveals the first enemy to enter.',
        manaCost: 60,
        manaCostByLevel: [60, 80, 100, 120],
        cooldownTicks: 16,
        targetType: 'none',
        damageType: 'magical',
        effects: [
          { type: 'damage', value: 80, damageType: 'magical', description: 'Trap trigger damage' },
          { type: 'reveal', value: 1, duration: 2, description: 'Reveal triggering enemy' },
        ],
      },
      e: {
        id: 'socket-e',
        name: 'Accept',
        description: 'Pull an enemy hero from an adjacent zone one step toward you.',
        manaCost: 100,
        manaCostByLevel: [100, 130, 160, 190],
        cooldownTicks: 20,
        targetType: 'hero',
        effects: [{ type: 'teleport', value: 1, description: 'Pull target one zone closer' }],
      },
      r: {
        id: 'socket-r',
        name: 'Broadcast',
        description:
          'Broadcast a slowing signal across the map, reducing the move speed of all enemy heroes for 3 cycles.',
        manaCost: 200,
        manaCostByLevel: [200, 300, 400],
        cooldownTicks: 55,
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
    lore: 'A network intermediary that intercepts traffic and redirects harm. Proxy shields allies by absorbing and rerouting damage through cached connections.',
    difficulty: 'medium',
    openingCombo: ['w', 'q', 'e'],
    oneLineTip:
      "The passive reroutes 12% of a zone-mate's incoming damage onto you, so buy HP early and treat your own HP bar as the team's shield.",
    baseStats: {
      hp: 580,
      mp: 380,
      attack: 42,
      defense: 4,
      magicResist: 20,
    },
    growthPerLevel: {
      hp: 55,
      mp: 35,
      attack: 3,
      defense: 1,
      magicResist: 1,
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
          'Hurl a redirected packet at an enemy, dealing magical damage and slowing them for 2 cycles.',
        manaCost: 70,
        manaCostByLevel: [70, 90, 110, 130],
        cooldownTicks: 8,
        targetType: 'hero',
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
          'Grant an allied hero a cached response shield that absorbs damage for 3 cycles.',
        manaCost: 90,
        manaCostByLevel: [90, 110, 130, 150],
        cooldownTicks: 12,
        targetType: 'ally',
        effects: [{ type: 'shield', value: 140, duration: 3 }],
      },
      e: {
        id: 'proxy-e',
        name: 'Load Balance',
        description:
          'Split healing evenly among all allied heroes in the zone, restoring HP to each.',
        manaCost: 100,
        manaCostByLevel: [100, 130, 160, 190],
        cooldownTicks: 10,
        targetType: 'none',
        effects: [{ type: 'heal', value: 180, description: 'Total healing split among allies' }],
      },
      r: {
        id: 'proxy-r',
        name: 'Reverse Proxy',
        description:
          'Swap positions with an allied hero, granting both brief invulnerability for 1 cycle.',
        manaCost: 200,
        manaCostByLevel: [200, 300, 400],
        cooldownTicks: 50,
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
    lore: 'A memory allocator that grows in power the more resources it claims. Malloc scales relentlessly, converting scrip into raw destructive force.',
    difficulty: 'medium',
    openingCombo: ['q', 'e', 'w'],
    oneLineTip:
      'Buff with Allocate before you dash: E closes the gap and stuns, W finishes. Stack Overflow costs 20% of your current HP, so it is a closer, never an opener.',
    baseStats: {
      hp: 520,
      mp: 300,
      attack: 62,
      defense: 2,
      magicResist: 14,
    },
    growthPerLevel: {
      hp: 50,
      mp: 25,
      attack: 8,
      defense: 1,
      magicResist: 1,
    },
    passive: {
      id: 'malloc-passive',
      name: 'Heap Growth',
      description:
        'Gain +1 bonus attack damage for every 100 scrip currently held, up to +40 (at 4000 scrip).',
      manaCost: 0,
      cooldownTicks: 0,
      targetType: 'none',
      effects: [{ type: 'buff', value: 1, description: 'Attack per 100 scrip' }],
    },
    abilities: {
      q: {
        id: 'malloc-q',
        name: 'Allocate',
        description: 'Allocate additional resources, buffing attack damage by 25 for 3 cycles.',
        manaCost: 60,
        manaCostByLevel: [60, 80, 100, 120],
        cooldownTicks: 8,
        targetType: 'self',
        effects: [{ type: 'buff', value: 25, duration: 3, description: 'Bonus attack damage' }],
      },
      w: {
        id: 'malloc-w',
        name: 'Free()',
        description:
          'Deallocate a target, dealing physical damage. Deals 40% bonus damage if the target is below 30% HP.',
        manaCost: 70,
        manaCostByLevel: [70, 90, 110, 130],
        cooldownTicks: 7,
        targetType: 'hero',
        damageType: 'physical',
        effects: [
          { type: 'damage', value: 110, damageType: 'physical' },
          {
            type: 'damage',
            value: 44,
            damageType: 'physical',
            description: 'Bonus if target below 30% HP',
          },
        ],
      },
      e: {
        id: 'malloc-e',
        name: 'Pointer Dereference',
        description: 'Dash to a target enemy, closing the gap and stunning them for 1 cycle.',
        manaCost: 80,
        manaCostByLevel: [80, 100, 120, 140],
        cooldownTicks: 12,
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
          'Overflow the stack with raw power, dealing massive physical damage to all enemies in the zone. Costs 20% of current HP.',
        manaCost: 150,
        manaCostByLevel: [150, 250, 350],
        cooldownTicks: 50,
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
    difficulty: 'medium',
    openingCombo: ['w', 'q', 'r'],
    oneLineTip:
      "Land two basic attacks before you burst — each strips 2 defense, up to 4 stacks — and remember Encrypt's stealth breaks the instant you attack.",
    baseStats: {
      hp: 480,
      mp: 320,
      attack: 64,
      defense: 2,
      magicResist: 13,
    },
    growthPerLevel: {
      hp: 45,
      mp: 22,
      attack: 7,
      defense: 1,
      magicResist: 1,
    },
    passive: {
      id: 'cipher-passive',
      name: 'Encryption Key',
      description:
        "Each attack reduces the target's defense by 2 for 3 cycles, stacking up to 4 times.",
      manaCost: 0,
      cooldownTicks: 0,
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
          'Strike with an XOR-encoded blade, dealing bonus magical damage on top of the physical attack.',
        manaCost: 50,
        manaCostByLevel: [50, 65, 80, 95],
        cooldownTicks: 5,
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
          'Encrypt self, becoming invisible for 2 cycles. Taking damage or attacking breaks stealth.',
        manaCost: 80,
        manaCostByLevel: [80, 100, 120, 140],
        cooldownTicks: 14,
        targetType: 'self',
        effects: [{ type: 'buff', value: 1, duration: 2, description: 'Stealth' }],
      },
      e: {
        id: 'cipher-e',
        name: 'Decrypt',
        description:
          'Decrypt a target enemy, revealing them for 3 cycles and silencing them for 1 cycle.',
        manaCost: 90,
        manaCostByLevel: [90, 110, 130, 150],
        cooldownTicks: 12,
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
          'Unleash 6 rapid strikes of magical damage on a target, applying Encryption Key stacks (-2 defense each, max 4) for 3 cycles.',
        manaCost: 220,
        manaCostByLevel: [220, 320, 420],
        cooldownTicks: 45,
        targetType: 'hero',
        damageType: 'magical',
        effects: [
          { type: 'damage', value: 55, damageType: 'magical', description: 'Per hit (x6)' },
          { type: 'debuff', value: 2, duration: 3, description: '-2 defense per stack (max 4)' },
        ],
      },
    },
  },

  firewall: {
    id: 'firewall',
    name: 'Ablative Shell',
    role: 'tank',
    lore: 'A sentient packet filter that stands between allies and destruction. Firewall blocks, reflects, and punishes all who dare breach its perimeter.',
    difficulty: 'easy',
    openingCombo: ['w', 'e', 'q'],
    oneLineTip:
      'DMZ first, then taunt: the shield eats the damage Access Control pulls onto you, then explodes on everyone standing next to you.',
    baseStats: {
      hp: 720,
      mp: 270,
      attack: 48,
      defense: 7,
      magicResist: 22,
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
      description: 'Reflect 8% of all damage taken back to the attacker as magical damage.',
      manaCost: 0,
      cooldownTicks: 0,
      targetType: 'none',
      effects: [
        { type: 'damage', value: 8, damageType: 'magical', description: 'Damage reflect %' },
      ],
    },
    abilities: {
      q: {
        id: 'firewall-q',
        name: 'Port Block',
        description:
          "Block a target's ports, dealing physical damage and stunning them for 1 cycle.",
        manaCost: 70,
        manaCostByLevel: [70, 90, 110, 130],
        cooldownTicks: 8,
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
          'Create a demilitarized zone shield around self that absorbs damage for 3 cycles. When the shield expires or breaks, it explodes dealing magical damage to nearby enemies.',
        manaCost: 80,
        manaCostByLevel: [80, 100, 120, 140],
        cooldownTicks: 14,
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
          'Enforce access control in the zone, taunting all enemies to attack Firewall for 2 cycles.',
        manaCost: 60,
        manaCostByLevel: [60, 80, 100, 120],
        cooldownTicks: 16,
        targetType: 'none',
        effects: [{ type: 'taunt', value: 1, duration: 2 }],
      },
      r: {
        id: 'firewall-r',
        name: 'Deep Packet Inspection',
        description:
          'Perform deep inspection on all enemies in the zone, rooting them for 2 cycles and dealing magical damage over time.',
        manaCost: 250,
        manaCostByLevel: [250, 350, 450],
        cooldownTicks: 55,
        targetType: 'none',
        damageType: 'magical',
        effects: [
          { type: 'root', value: 1, duration: 2 },
          {
            type: 'dot',
            value: 120,
            duration: 3,
            damageType: 'magical',
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
    lore: 'A void reference that consumes all it touches. Null drains the essence from enemies, growing stronger with each deletion it causes.',
    difficulty: 'medium',
    openingCombo: ['q', 'e', 'r'],
    oneLineTip:
      'Lead with Void Bolt: its 5 magic-resist shred makes every spell after it hit harder, and Dereference adds 50% against anyone already under 25% HP.',
    baseStats: {
      hp: 440,
      mp: 420,
      attack: 38,
      defense: 1,
      magicResist: 16,
    },
    growthPerLevel: {
      hp: 42,
      mp: 40,
      attack: 3,
      defense: 1,
      magicResist: 1,
    },
    passive: {
      id: 'null_ref-passive',
      name: 'Void Drain',
      description: 'On kill, restore 15% max MP and reduce all ability cooldowns by 2 cycles.',
      manaCost: 0,
      cooldownTicks: 0,
      targetType: 'none',
      effects: [
        { type: 'heal', value: 15, description: 'MP restore % on kill' },
        { type: 'buff', value: 2, description: 'Cooldown reduction cycles' },
      ],
    },
    abilities: {
      q: {
        id: 'null_ref-q',
        name: 'Void Bolt',
        description:
          "Fire a bolt of void energy that deals magical damage and shreds the target's magic resistance by 5 for 3 cycles.",
        manaCost: 55,
        manaCostByLevel: [55, 70, 85, 100],
        cooldownTicks: 5,
        targetType: 'hero',
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
          'Silence a target enemy hero for 2 cycles, preventing them from casting abilities.',
        manaCost: 80,
        manaCostByLevel: [80, 95, 110, 125],
        cooldownTicks: 12,
        targetType: 'hero',
        effects: [{ type: 'silence', value: 1, duration: 2 }],
      },
      e: {
        id: 'null_ref-e',
        name: 'Void Zone',
        description:
          'Create a zone of null space, dealing magical damage over time to all enemies in the zone for 3 cycles and revealing them.',
        manaCost: 90,
        manaCostByLevel: [90, 105, 120, 135],
        cooldownTicks: 14,
        targetType: 'none',
        damageType: 'magical',
        effects: [
          {
            type: 'dot',
            value: 120,
            duration: 3,
            damageType: 'magical',
            description: 'Total damage over 3 cycles',
          },
          { type: 'reveal', value: 1, duration: 3 },
        ],
      },
      r: {
        id: 'null_ref-r',
        name: 'Dereference',
        description:
          'Unleash a devastating null dereference on all enemies in the zone, dealing massive magical damage. Enemies below 25% HP take 50% bonus damage.',
        manaCost: 280,
        manaCostByLevel: [280, 360, 440],
        cooldownTicks: 50,
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
    difficulty: 'hard',
    openingCombo: ['q', 'e', 'w', 'r'],
    oneLineTip:
      'Three casts inside four cycles arms Closure — only then press Reduce, which costs no mana, hits 30% harder and stuns.',
    baseStats: {
      hp: 460,
      mp: 400,
      attack: 40,
      defense: 1,
      magicResist: 17,
    },
    growthPerLevel: {
      hp: 38,
      mp: 38,
      attack: 3,
      defense: 1,
      magicResist: 1,
    },
    passive: {
      id: 'lambda-passive',
      name: 'Closure',
      description:
        'Casting 3 abilities within 4 cycles activates Closure: next ability costs no mana and deals 30% bonus damage.',
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
        description: 'Fire a quick bolt of functional energy, dealing magical damage to a target.',
        manaCost: 40,
        manaCostByLevel: [40, 50, 60, 70],
        cooldownTicks: 5,
        targetType: 'hero',
        damageType: 'magical',
        effects: [{ type: 'damage', value: 75, damageType: 'magical' }],
      },
      w: {
        id: 'lambda-w',
        name: 'Return',
        description: 'Mark current zone. After 2 cycles, teleport back to the marked zone.',
        manaCost: 70,
        manaCostByLevel: [70, 85, 100, 115],
        cooldownTicks: 14,
        targetType: 'self',
        effects: [{ type: 'teleport', value: 2, description: 'Delayed return after 2 cycles' }],
      },
      e: {
        id: 'lambda-e',
        name: 'Map',
        description:
          'Apply a slowing field to all enemies in the zone, reducing move speed for 2 cycles and dealing magical damage.',
        manaCost: 80,
        manaCostByLevel: [80, 95, 110, 125],
        cooldownTicks: 10,
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
          'Channel all accumulated function calls into a single target, dealing massive magical damage. Stuns for 1 cycle if Closure is active.',
        manaCost: 250,
        manaCostByLevel: [250, 350, 450],
        cooldownTicks: 50,
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
    difficulty: 'medium',
    openingCombo: ['q', 'e', 'r'],
    oneLineTip:
      'Stop moving: five cycles parked in one zone is +5 defense, +15 attack and a far bigger Priority Inversion — one step resets all of it.',
    baseStats: {
      hp: 680,
      mp: 260,
      attack: 55,
      defense: 6,
      magicResist: 20,
    },
    growthPerLevel: {
      hp: 70,
      mp: 20,
      attack: 6,
      defense: 2,
      magicResist: 1,
    },
    passive: {
      id: 'mutex-passive',
      name: 'Deadlock',
      description:
        'Gain +1 defense and +3 attack per cycle while remaining in the same zone, stacking up to 5 times. Moving resets stacks.',
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
          'Slam the target with a locking mechanism, dealing physical damage and rooting them for 1 cycle.',
        manaCost: 60,
        manaCostByLevel: [60, 75, 90, 105],
        cooldownTicks: 8,
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
          'Enter a critical section, gaining a shield and bonus defense for 2 cycles. Roots self during the duration.',
        manaCost: 70,
        manaCostByLevel: [70, 85, 100, 115],
        cooldownTicks: 12,
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
          'Rapidly strike enemies in the zone 3 times, each hit applying a stacking 10% slow for 2 cycles.',
        manaCost: 50,
        manaCostByLevel: [50, 65, 80, 95],
        cooldownTicks: 10,
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
          'Invert priority in the zone, fearing all enemies for 2 cycles and dealing physical damage. Bonus damage for each Deadlock stack.',
        manaCost: 200,
        manaCostByLevel: [200, 280, 360],
        cooldownTicks: 50,
        targetType: 'none',
        damageType: 'physical',
        effects: [
          {
            type: 'damage',
            value: 150,
            damageType: 'physical',
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
    lore: 'A relentless ICMP echo that probes enemy defenses from afar. Ping disrupts timing, delays responses, and controls space through persistent harassment.',
    difficulty: 'easy',
    openingCombo: ['q', 'w', 'r'],
    oneLineTip:
      'ICMP Echo reaches into an adjacent zone for 60% damage — harass from where they cannot answer, and only step in once Flood is up.',
    baseStats: {
      hp: 580,
      mp: 310,
      attack: 50,
      defense: 4,
      magicResist: 18,
    },
    growthPerLevel: {
      hp: 55,
      mp: 28,
      attack: 5,
      defense: 1,
      magicResist: 1,
    },
    passive: {
      id: 'ping-passive',
      name: 'Latency',
      description: "Basic attacks add +1 cycle to the target's next ability cooldown.",
      manaCost: 0,
      cooldownTicks: 0,
      targetType: 'none',
      effects: [{ type: 'debuff', value: 1, description: 'Cooldown increase per attack' }],
    },
    abilities: {
      q: {
        id: 'ping-q',
        name: 'ICMP Echo',
        description:
          'Send a probing ping that deals magical damage. Can target enemies in adjacent zones for 60% damage.',
        manaCost: 45,
        manaCostByLevel: [45, 60, 75, 90],
        cooldownTicks: 5,
        targetType: 'hero',
        damageType: 'magical',
        effects: [
          { type: 'damage', value: 80, damageType: 'magical' },
          {
            type: 'damage',
            value: 48,
            damageType: 'magical',
            description: 'Adjacent zone damage (60%)',
          },
        ],
      },
      w: {
        id: 'ping-w',
        name: 'Timeout',
        description:
          "Disrupt a target's connection, silencing them for 1 cycle and reducing their attack damage by 20% for 3 cycles.",
        manaCost: 75,
        manaCostByLevel: [75, 90, 105, 120],
        cooldownTicks: 12,
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
        manaCost: 60,
        manaCostByLevel: [60, 75, 90, 105],
        cooldownTicks: 14,
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
          'Flood the zone with packets, dealing magical damage over time for 3 cycles and slowing enemies who try to leave.',
        manaCost: 200,
        manaCostByLevel: [200, 280, 360],
        cooldownTicks: 50,
        targetType: 'none',
        damageType: 'magical',
        effects: [
          {
            type: 'dot',
            value: 180,
            duration: 3,
            damageType: 'magical',
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
    lore: 'A scheduled task daemon that executes healing protocols on a precise timer. Cron maintains the team with clockwork efficiency, cleansing corruption and rallying allies.',
    difficulty: 'easy',
    openingCombo: ['q', 'w', 'r'],
    oneLineTip:
      'Purge (W) is a cleanse, not just a shield — hold it for the stun or silence that would otherwise kill your carry.',
    baseStats: {
      hp: 620,
      mp: 380,
      attack: 42,
      defense: 5,
      magicResist: 22,
    },
    growthPerLevel: {
      hp: 60,
      mp: 30,
      attack: 3,
      defense: 1,
      magicResist: 1,
    },
    passive: {
      id: 'cron-passive',
      name: 'Scheduled Task',
      description:
        'Every 4th game cycle, automatically heal the lowest HP ally in the zone for 40 HP.',
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
          'Buff an allied hero, increasing their attack by 15 and defense by 5 for 3 cycles.',
        manaCost: 65,
        manaCostByLevel: [65, 80, 95, 110],
        cooldownTicks: 8,
        targetType: 'ally',
        effects: [
          { type: 'buff', value: 15, duration: 3, description: 'Bonus attack' },
          { type: 'buff', value: 5, duration: 3, description: 'Bonus defense' },
        ],
      },
      w: {
        id: 'cron-w',
        name: 'Purge',
        description:
          'Cleanse all debuffs from an allied hero and grant them a shield for 2 cycles.',
        manaCost: 90,
        manaCostByLevel: [90, 105, 120, 135],
        cooldownTicks: 12,
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
          'Send a kill signal to an enemy, dealing physical damage and taunting them for 1 cycle.',
        manaCost: 55,
        manaCostByLevel: [55, 70, 85, 100],
        cooldownTicks: 10,
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
          'Install a healing crontab for all allies in the zone, restoring HP and MP over 4 cycles.',
        manaCost: 250,
        manaCostByLevel: [250, 340, 430],
        cooldownTicks: 55,
        targetType: 'none',
        effects: [
          { type: 'heal', value: 300, description: 'Total HP restored over 4 cycles' },
          { type: 'buff', value: 60, description: 'Total MP restored over 4 cycles' },
        ],
      },
    },
  },

  traceroute: {
    id: 'traceroute',
    name: 'Traceroute',
    role: 'assassin',
    lore: 'A roaming hunter that traces the path between nodes, gaining momentum with each hop. Traceroute strikes hardest when targets are isolated and far from help.',
    difficulty: 'hard',
    openingCombo: ['e', 'w', 'q'],
    oneLineTip:
      'Arrive fresh: three zones of movement is +60% damage and it decays two cycles after you stop, so mark your escape with Next Hop, pin with TTL, then Probe.',
    baseStats: {
      hp: 470,
      mp: 290,
      attack: 62,
      defense: 2,
      magicResist: 14,
    },
    growthPerLevel: {
      hp: 44,
      mp: 22,
      attack: 7,
      defense: 1,
      magicResist: 1,
    },
    passive: {
      id: 'traceroute-passive',
      name: 'Hop Count',
      description:
        'Moving to a new zone grants +20% bonus damage per zone moved, stacking up to 3 times. Stacks decay after 2 cycles without moving.',
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
        manaCostByLevel: [50, 65, 80, 95],
        cooldownTicks: 8,
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
        description: 'Set a time-to-live trap on a target, rooting them for 2 cycles.',
        manaCost: 70,
        manaCostByLevel: [70, 85, 100, 115],
        cooldownTicks: 12,
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
        manaCost: 60,
        manaCostByLevel: [60, 75, 90, 105],
        cooldownTicks: 12,
        targetType: 'self',
        effects: [{ type: 'buff', value: 2, duration: 2, description: 'Return shadow duration' }],
      },
      r: {
        id: 'traceroute-r',
        name: 'Full Trace',
        description: 'Reveal all enemy heroes for 3 cycles and gain +50% damage for 2 cycles.',
        manaCost: 200,
        manaCostByLevel: [200, 280, 360],
        cooldownTicks: 60,
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
    lore: 'A parallel execution unit that multiplies its strikes across targets. Thread starts slow but becomes an unstoppable force in teamfights, weaving destruction through every enemy.',
    difficulty: 'easy',
    openingCombo: ['e', 'q', 'r'],
    oneLineTip:
      "Mark with Yield first: the 25% bonus damage taken applies to your whole team's damage, and Thread Pool turns every basic attack into a zone-wide hit.",
    baseStats: {
      hp: 530,
      mp: 270,
      attack: 60,
      defense: 3,
      magicResist: 15,
    },
    growthPerLevel: {
      hp: 52,
      mp: 24,
      attack: 8,
      defense: 1,
      magicResist: 1,
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
          'Fork a new thread of power, dealing physical damage to a target and buffing own attack by 20 for 3 cycles.',
        manaCost: 55,
        manaCostByLevel: [55, 70, 85, 100],
        cooldownTicks: 8,
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
        manaCostByLevel: [70, 85, 100, 115],
        cooldownTicks: 12,
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
        manaCost: 60,
        manaCostByLevel: [60, 75, 90, 105],
        cooldownTicks: 10,
        targetType: 'hero',
        effects: [{ type: 'debuff', value: 25, duration: 3, description: 'Bonus damage taken %' }],
      },
      r: {
        id: 'thread-r',
        name: 'Thread Pool',
        description:
          'Overclock all threads: for the next 4 cycles, basic attacks hit ALL enemies in the zone.',
        manaCost: 250,
        manaCostByLevel: [250, 340, 430],
        cooldownTicks: 55,
        targetType: 'self',
        effects: [{ type: 'buff', value: 4, duration: 4, description: 'AoE attacks duration' }],
      },
    },
  },

  cache: {
    id: 'cache',
    name: 'Cache',
    role: 'tank',
    lore: 'A memory cache that absorbs and stores incoming data. Cache converts the punishment it endures into explosive offensive power, punishing enemies who dare attack it.',
    difficulty: 'hard',
    openingCombo: ['e', 'q', 'r'],
    oneLineTip:
      'Cache has to take damage before it can deal any — Q, W and R all spend stored energy, so opening a fight at full HP with an empty cache does almost nothing.',
    baseStats: {
      hp: 700,
      mp: 260,
      attack: 45,
      defense: 7,
      magicResist: 24,
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
        manaCostByLevel: [55, 70, 85, 100],
        cooldownTicks: 8,
        targetType: 'hero',
        damageType: 'physical',
        effects: [
          { type: 'damage', value: 80, damageType: 'physical' },
          {
            type: 'damage',
            value: 50,
            damageType: 'physical',
            description: '% of cached energy as bonus',
          },
        ],
      },
      w: {
        id: 'cache-w',
        name: 'Flush',
        description:
          'Flush the cache, converting all stored energy into a shield that lasts 3 cycles.',
        manaCost: 60,
        manaCostByLevel: [60, 75, 90, 105],
        cooldownTicks: 12,
        targetType: 'self',
        effects: [
          { type: 'shield', value: 1, duration: 3, description: 'Shield equal to cached energy' },
        ],
      },
      e: {
        id: 'cache-e',
        name: 'Invalidate',
        description:
          "Invalidate a target's healing cache, dealing magical damage and applying anti-heal (50% reduced healing) for 3 cycles.",
        manaCost: 65,
        manaCostByLevel: [65, 80, 95, 110],
        cooldownTicks: 10,
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
        manaCostByLevel: [180, 250, 320],
        cooldownTicks: 50,
        targetType: 'none',
        damageType: 'pure',
        effects: [
          {
            type: 'damage',
            value: 1,
            damageType: 'pure',
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
