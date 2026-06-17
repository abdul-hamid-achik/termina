/**
 * Post-game MVP selection — a pure, transparent "impact" score used only to crown
 * one standout player on the end screen. Takedowns weigh most, hero/tower damage
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
  towerDamage?: number
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
    Math.round((p.towerDamage ?? 0) / 500) -
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
