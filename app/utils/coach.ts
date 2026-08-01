/**
 * The coach — situational teaching, in the STREAM.
 *
 * The tutorial teaches VERBS: move, attack, cast, buy. A player finishes it
 * able to type and unable to decide. Nothing then explains *why* you last-hit
 * rather than swing every cycle, why scrip left unspent is scrip wasted, or why
 * being two hops deep with no vision and no allies is how you die.
 *
 * Three deliberate choices about the shape:
 *
 * 1. **It lives in the feed, not over it.** A library tour with cutouts and
 *    arrows floating above the HUD fights a terminal aesthetic and covers the
 *    one surface the player is reading. The STREAM is already where the game
 *    talks; a `[COACH]` line there is in-world and hides nothing.
 *
 * 2. **It fires on SITUATIONS, never on steps.** "Step 4 of 7" teaches an order
 *    the match does not follow. Every tip below is a predicate over live state:
 *    it appears when the thing is actually true of this player right now, which
 *    is the only moment the advice means anything.
 *
 * 3. **It stops when the player demonstrates the behaviour** — not on a counter
 *    and not on a dismiss button. Someone who last-hits is never told about
 *    last-hitting again, in this match or any later one.
 *
 * Pure: no store, no DOM, no time. Every decision is a function of the snapshot
 * it is handed, which is what makes the whole thing testable without a browser.
 */

/** A tip's stable id. Doubles as the key under which "learned" is remembered. */
export type CoachTipId =
  | 'last_hit'
  | 'spend_scrip'
  | 'leave_base'
  | 'use_abilities'
  | 'retreat'
  | 'overextended'
  | 'push_ice'
  | 'buy_vision'

export interface CoachTip {
  id: CoachTipId
  /** The line as it appears in the feed. States the WHY, not just the what. */
  text: string
  /** The exact command to type. Shown verbatim so nothing has to be translated. */
  command?: string
  /** Higher wins when several tips are true at once. */
  priority: number
}

/** The snapshot a decision is made from. Deliberately flat and primitive. */
export interface CoachInput {
  cycle: number
  alive: boolean
  /** 0..1 */
  hpFraction: number
  scrip: number
  level: number
  /** Cumulative last-hits this match. */
  lastHits: number
  /** Items currently held (nulls are empty slots). */
  items: (string | null)[]
  /** True when standing in a base or anchor — i.e. able to shop. */
  inShopZone: boolean
  /** True when standing on one of the three routes. */
  onRoute: boolean
  /** Hop depth along the current route, 0-based. -1 when off-route. */
  hopIndex: number
  /** Total hops on the current route. */
  hopTotal: number
  /** Enemy heroes visible in the player's zone. */
  enemiesHere: number
  /** Allied heroes in the player's zone, NOT counting the player. */
  alliesHere: number
  /** Hostile wave units in the zone that are low enough to be worth a swing. */
  strippableWaves: number
  /** An enemy ICE stands in this zone and is currently attackable. */
  attackableIce: boolean
  /** Abilities the player has cast this match. */
  castsMade: number
  /** How many of the player's own zones the team currently has vision on. */
  routeVision: number
  /** Zones on the current route. */
  routeTotal: number
}

/** What the player has already proved they know. Persisted across matches. */
export type CoachLearned = Partial<Record<CoachTipId, true>>

/** When a tip last fired, by id — so one cannot repeat every single cycle. */
export type CoachHistory = Partial<Record<CoachTipId, number>>

/**
 * Cycles a tip stays quiet after firing.
 *
 * Long on purpose. A coach that speaks every few seconds is noise the player
 * learns to skip, and skipping the coach means skipping the feed — which is the
 * game. Better to say one useful thing a minute than five ignorable ones.
 */
export const COACH_COOLDOWN_CYCLES = 20

/** The player is judged to know a thing once they have done it this many times. */
const PROOF = {
  lastHits: 3,
  casts: 3,
  items: 2,
} as const

/**
 * Everything the coach could say, most urgent first.
 *
 * `when` decides whether it is true right now. `proven` decides whether the
 * player has already shown they know it — a tip whose `proven` returns true is
 * retired permanently, not merely skipped.
 */
const TIPS: Array<{
  id: CoachTipId
  priority: number
  when: (s: CoachInput) => boolean
  proven: (s: CoachInput) => boolean
  text: (s: CoachInput) => string
  command?: (s: CoachInput) => string
}> = [
  {
    // Survival first: nothing else matters to a corpse, and a new player reads
    // "I still have health" instead of "I have less than one exchange left".
    id: 'retreat',
    priority: 100,
    when: (s) => s.alive && s.hpFraction < 0.3 && s.enemiesHere > 0,
    proven: () => false, // never retired — it is situational, not a lesson
    text: (s) =>
      `[COACH] You are under a third INTEG with ${s.enemiesHere} hostile${s.enemiesHere === 1 ? '' : 's'} on you. There is no regen out here — walking back costs a few cycles, dying costs the walk plus the respawn plus what they take off your ICE.`,
    command: () => 'move anchor',
  },
  {
    // Deep, alone, blind. The single most common way a new player feeds.
    id: 'overextended',
    priority: 90,
    when: (s) =>
      s.alive &&
      s.onRoute &&
      s.hopIndex >= Math.ceil(s.hopTotal / 2) &&
      s.alliesHere === 0 &&
      s.routeVision <= 1,
    proven: () => false,
    text: () =>
      `[COACH] You are past halfway on this route, alone, with no feed on it. Anything standing between you and home is something you cannot see. Either buy sight or pull back to your own ICE.`,
    command: () => 'tap',
  },
  {
    id: 'leave_base',
    priority: 80,
    when: (s) => s.alive && !s.onRoute && s.inShopZone && s.cycle > 4,
    proven: (s) => s.onRoute,
    text: () =>
      `[COACH] Nothing happens in your base. Scrip and levels come from the routes — pick one and go stand behind your own ICE.`,
    command: () => 'move coldstore',
  },
  {
    // The economy. A player who swings every cycle earns almost nothing and
    // cannot understand why the enemy is two items ahead.
    id: 'last_hit',
    priority: 70,
    when: (s) => s.alive && s.strippableWaves > 0 && s.lastHits < PROOF.lastHits,
    proven: (s) => s.lastHits >= PROOF.lastHits,
    text: () =>
      `[COACH] Only the killing blow on a wave pays scrip — chipping it every cycle pays nothing. Wait until one is nearly down, then take it.`,
    command: () => 'attack wave:0',
  },
  {
    id: 'spend_scrip',
    priority: 60,
    when: (s) => s.alive && s.inShopZone && s.scrip >= 600,
    proven: (s) => s.items.filter(Boolean).length >= PROOF.items,
    text: (s) =>
      `[COACH] You are standing in a shop with ${s.scrip}sc unspent. Scrip does nothing in your pocket — a hero with items beats a hero with savings.`,
    command: () => 'buy edge_kit',
  },
  {
    id: 'use_abilities',
    priority: 50,
    when: (s) => s.alive && s.enemiesHere > 0 && s.castsMade < PROOF.casts && s.level >= 1,
    proven: (s) => s.castsMade >= PROOF.casts,
    text: () =>
      `[COACH] You have abilities and an enemy in your zone. Your basic attack is the weakest thing you own — the kit is what wins the exchange.`,
    command: () => 'cast q',
  },
  {
    // Vision is the least obvious purchase and the one that changes most.
    id: 'buy_vision',
    priority: 40,
    when: (s) =>
      s.alive &&
      s.onRoute &&
      s.routeVision < s.routeTotal / 2 &&
      s.scrip >= 75 &&
      !s.items.includes('camtap'),
    proven: (s) => s.items.includes('camtap'),
    text: () =>
      `[COACH] You have no feed on most of this route. A CAMTAP is 75sc and shows you a gank before it arrives — it is the cheapest thing that stops you dying.`,
    command: () => 'buy camtap',
  },
  {
    // The objective. Players farm forever and never push.
    id: 'push_ice',
    priority: 30,
    when: (s) => s.alive && s.attackableIce && s.enemiesHere === 0 && s.lastHits >= PROOF.lastHits,
    proven: () => false,
    text: () =>
      `[COACH] The ICE in front of you is open and nobody is defending it. Farming does not win — razing a route to its T3 is what exposes their Terminal.`,
    command: () => 'attack ice',
  },
]

/**
 * Decide what, if anything, the coach should say this cycle.
 *
 * Returns `null` far more often than not: silence is the default, and a tip has
 * to be true, unlearned, and off cooldown to earn a line in the feed.
 */
export function evaluateCoach(
  input: CoachInput,
  learned: CoachLearned,
  history: CoachHistory,
): CoachTip | null {
  if (!input.alive) return null

  const candidates = TIPS.filter((tip) => {
    if (learned[tip.id]) return false
    if (tip.proven(input)) return false
    if (!tip.when(input)) return false
    const last = history[tip.id]
    return last === undefined || input.cycle - last >= COACH_COOLDOWN_CYCLES
  })
  if (candidates.length === 0) return null

  const best = candidates.reduce((a, b) => (a.priority >= b.priority ? a : b))
  return {
    id: best.id,
    text: best.text(input),
    command: best.command?.(input),
    priority: best.priority,
  }
}

/**
 * Ids the player has just demonstrated. Folded into `learned` after every cycle,
 * so a lesson retires the moment it is shown rather than the next time it would
 * have fired.
 */
export function newlyLearned(input: CoachInput, learned: CoachLearned): CoachTipId[] {
  return TIPS.filter((tip) => !learned[tip.id] && tip.proven(input)).map((tip) => tip.id)
}

/** Every tip id, for the settings screen and for tests that must stay exhaustive. */
export const COACH_TIP_IDS: CoachTipId[] = TIPS.map((t) => t.id)
