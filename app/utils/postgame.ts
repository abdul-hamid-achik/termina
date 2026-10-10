/**
 * Post-game MVP selection — a pure, transparent "impact" score used only to crown
 * one standout player on the end screen. Takedowns weigh most, hero/ice damage
 * add, deaths cost a little. Deliberately simple and unit-tested so the crown is
 * explainable, not a black box.
 */

export interface MvpInput {
  id: string
  team: string
  kills: number
  deaths: number
  assists: number
  heroDamage: number
  iceDamage?: number
}

/**
 * Transparent impact score: takedowns weigh most per unit, damage contribution
 * adds (scaled so a full game's ~30k hero damage is comparable to ~12 kills, not
 * dominant), deaths cost a little.
 */
export function impactScore(p: MvpInput): number {
  return (
    p.kills * 4 +
    p.assists * 2 +
    Math.round(p.heroDamage / 500) +
    Math.round((p.iceDamage ?? 0) / 500) -
    p.deaths * 2
  )
}

/**
 * The match MVP: the highest-impact player ON THE WINNING TEAM. Crowning a bot
 * from the losing side over a CHAFF VICTORY read as the screen contradicting
 * itself (playtest 3). Without a known winner (or a winner with nobody listed)
 * the whole roster is eligible, and a score tie still prefers the winner.
 * Returns null for an empty roster.
 */
export function computeMvp<T extends MvpInput>(
  players: T[],
  winner?: string,
): (T & { score: number }) | null {
  const winners = winner == null ? [] : players.filter((p) => p.team === winner)
  const pool = winners.length > 0 ? winners : players
  let best: (T & { score: number }) | null = null
  for (const p of pool) {
    const score = impactScore(p)
    const better =
      best === null ||
      score > best.score ||
      (score === best.score && winner != null && p.team === winner && best.team !== winner)
    if (better) best = { ...p, score }
  }
  return best
}

/** A name that is really an id: `bot_…`, `guest_…`, `local_<uuid>`, an OAuth
 *  `github_123`, or the player id itself. */
const RAW_ID_NAME = /^(bot|guest|local|github|google|discord|gitlab)_/i

export interface DisplayName {
  /** What to print in a "player" slot. */
  name: string
  /** True when `name` is a label standing in for a raw id ("bot", "you"…), so a
   *  headline should lead with the hero handle instead. */
  stand_in: boolean
}

/**
 * The end screen's name for a roster entry. Server rosters carry raw ids as
 * names for bots, guests and some accounts ("BOT_ENEMY1_PRAC_1791623981819_5O2ABC",
 * "local_cff6baeb-…" — playtest2 37.png); those read as a stand-in label —
 * bot / you / guest / the hero handle — never as the id.
 */
export function displayPlayerName(
  p: { id: string; name: string; heroName?: string },
  currentPlayerId: string,
): DisplayName {
  const raw = !p.name || p.name.toLowerCase() === p.id.toLowerCase() || RAW_ID_NAME.test(p.name)
  if (!raw) return { name: p.name, stand_in: false }
  if (p.id.startsWith('bot_')) return { name: 'bot', stand_in: true }
  if (p.id === currentPlayerId) return { name: 'you', stand_in: true }
  if (p.id.startsWith('guest_')) return { name: 'guest', stand_in: true }
  return { name: p.heroName ?? 'operator', stand_in: true }
}

/** The end-of-match numbers the advice reads (PlayerEndStats' shape). */
export interface AdviceStats {
  kills: number
  deaths: number
  assists: number
  /** UNSPENT scrip at the final cycle. */
  scrip: number
  heroDamage: number
  lastHits?: number
  burns?: number
  items?: readonly (string | null)[]
}

export interface AdviceContext {
  /** Last hits per minute, or null when the match length is unknown/short. */
  csPerMinute: number | null
  /** An enemy hero's handle (hero id) — `breach <handle>` must name a real one. */
  enemyHandle?: string
  /** The item to name in the shop advice (affordable with the unspent scrip). */
  shopItem?: string
}

export interface Advice {
  id: 'unspent' | 'deaths' | 'no-hero-damage' | 'last-hits' | 'burns' | 'next'
  /** What the number was — quoted back so the advice is evidently about them. */
  observation: string
  /** The literal command to type next game. */
  command: string
  /** A second command that completes the first (breach → cast). */
  followUp?: string
  detail: string
}

/** Unspent scrip worth a line: about one real item's worth. */
const UNSPENT_ADVICE_FLOOR = 500

/**
 * "What to work on" — at most three items, built from what THIS player's end
 * stats say, worst problem first. The old list tested burns/last-hits first and
 * a player with 0 hero damage, 2 deaths and 1,724 scrip unspent was told to
 * `attack wave:0` and `burn wave:0` (playtest 3). Order: scrip rotting in the
 * pocket, dying, never touching a hero, then farm. Never empty: a clean game
 * still gets one next thing to try, because an empty panel reads as broken.
 */
export function deriveAdvice(s: AdviceStats, ctx: AdviceContext): Advice[] {
  const out: Advice[] = []
  const cs = s.lastHits ?? 0
  const rate = ctx.csPerMinute

  if (s.scrip >= UNSPENT_ADVICE_FLOOR) {
    out.push({
      id: 'unspent',
      observation: `You finished holding ${s.scrip.toLocaleString('en-US')} unspent scrip`,
      command: `buy ${ctx.shopItem ?? 'edge_kit'}`,
      detail:
        'Scrip in your pocket does nothing. Walk home (base or anchor — the shop works from both) the moment you can afford your next item, and buy it.',
    })
  }

  // Dying is a problem when it outweighs what the deaths bought, or when it is
  // simply a lot of respawn timers.
  if (s.deaths >= 6 || (s.deaths >= 2 && s.deaths > s.kills + s.assists)) {
    out.push({
      id: 'deaths',
      observation: `You died ${s.deaths} time${s.deaths === 1 ? '' : 's'}${s.kills === 0 ? ' without a kill' : ''}`,
      command: 'move terminal',
      detail:
        'Read the hop line before you commit: when it says DANGER — outnumbered, low, or under their ICE with their wave — walk back. Retreating costs one cycle; dying costs the respawn and pays the enemy.',
    })
  }

  if (s.heroDamage === 0) {
    const handle = ctx.enemyHandle ?? '<hero>'
    out.push({
      id: 'no-hero-damage',
      observation: 'You dealt 0 damage to enemy heroes',
      command: `breach ${handle}`,
      followUp: 'cast q',
      detail:
        'Code and control bounce off a CLOSED hero. Breach the enemy in your zone first, then cast while the five-cycle opening lasts.',
    })
  }

  if ((rate !== null && rate < 2) || (rate === null && cs < 20)) {
    out.push({
      id: 'last-hits',
      observation:
        rate !== null
          ? `You stripped ${cs} wave unit${cs === 1 ? '' : 's'} (${rate.toFixed(1)}/min)`
          : `You stripped ${cs} wave unit${cs === 1 ? '' : 's'}`,
      command: 'attack wave:0',
      detail:
        'Only the killing blow pays. Wait until an enemy unit is inside the strip window (the ActionRow says STRIP, the stream names its wave:N), then swing at THAT index — swinging every cycle pays nothing.',
    })
  } else if ((s.burns ?? 0) === 0) {
    // Burns only once the farm itself is fine: they are the refinement, and
    // "burned 0" is true of nearly every new player's game.
    out.push({
      id: 'burns',
      observation: 'You burned 0 of your own units',
      command: 'burn wave:0',
      detail:
        'When one of YOUR units drops to half INTEG, burn it (the index the stream names): the enemy gets nothing for it.',
    })
  }

  if (out.length === 0) {
    out.push({
      id: 'next',
      observation: 'Clean game — nothing obvious to fix',
      command: 'tap coldstore-cross',
      detail:
        'Next step up is map control: a camtap on the crossing shows you the enemy before they arrive, which is what turns good farm into won fights.',
    })
  }

  return out.slice(0, 3)
}
