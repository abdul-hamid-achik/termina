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
 * The single highest-impact player across the roster. On a score tie the winning
 * team's player is preferred (don't crown the loser when it's even). Returns null
 * for an empty roster.
 */
export function computeMvp<T extends MvpInput>(
  players: T[],
  winner?: string,
): (T & { score: number }) | null {
  let best: (T & { score: number }) | null = null
  for (const p of players) {
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
