import type { PlayerState, TeamId } from '~~/shared/types/game'
import { XP_CATCHUP_MAX, XP_CATCHUP_PER_LEVEL } from '~~/shared/constants/balance'

/**
 * The ONE funnel for XP. Every grant — strip, presence (strip / wave-on-wave /
 * ICE), burn, Silt, hero kill, assist — goes through {@link catchupXp} (via
 * {@link awardXp} / {@link awardZoneXp}), so the individual catch-up rule
 * cannot be skipped by one path and honoured by another.
 */

/**
 * Individual catch-up multiplier for `playerId`: ×(1 + XP_CATCHUP_PER_LEVEL ×
 * levels behind their OWN team's average), capped at XP_CATCHUP_MAX, never
 * below 1. The average is over teammates only — the hero is excluded, the dead
 * are included — so one laggard is measured against the crew they are trying
 * to keep up with. Fractional gaps scale linearly.
 *
 * Reads only `level`, which changes once per cycle in checkLevelUps (after
 * every XP grant), so the order grants land in within a cycle cannot change the
 * outcome. Deterministic, no rng. 1 when the hero is alone on their team.
 */
export function xpCatchupMultiplier(
  players: Record<string, PlayerState>,
  playerId: string,
): number {
  const me = players[playerId]
  if (!me) return 1
  let sum = 0
  let count = 0
  for (const [id, p] of Object.entries(players)) {
    if (id === playerId || p.team !== me.team) continue
    sum += p.level
    count++
  }
  if (count === 0) return 1
  const behind = sum / count - me.level
  if (behind <= 0) return 1
  return Math.min(XP_CATCHUP_MAX, 1 + XP_CATCHUP_PER_LEVEL * behind)
}

/**
 * The XP `playerId` actually receives for a grant worth `baseXp`: the base ×
 * their catch-up multiplier, rounded. Exactly `baseXp` when they are not
 * behind. Exposed for the one caller (burn) that accumulates into a pending
 * update object rather than a players record.
 */
export function catchupXp(
  players: Record<string, PlayerState>,
  playerId: string,
  baseXp: number,
): number {
  const mult = xpCatchupMultiplier(players, playerId)
  return mult === 1 ? baseXp : Math.round(baseXp * mult)
}

/**
 * Pay one hero a grant worth `baseXp` (after catch-up). Immutable; returns the
 * SAME object when there is nothing to pay or no such hero.
 */
export function awardXp(
  players: Record<string, PlayerState>,
  playerId: string,
  baseXp: number,
): Record<string, PlayerState> {
  const player = players[playerId]
  if (!player || baseXp <= 0) return players
  return {
    ...players,
    [playerId]: { ...player, xp: player.xp + catchupXp(players, playerId, baseXp) },
  }
}

/**
 * Pay `xp` to every living hero of `team` standing in `zone`.
 *
 * The lane-presence half of wave XP: being there when a wave dies pays,
 * whoever — or whatever — landed the killing blow. Peer of ScripDistributor,
 * shared so the three callers that mean "a wave died here" (a hero last-hit in
 * ActionResolver, a wave-on-wave kill in WaveAI, an ICE kill in IceAI) cannot
 * drift apart. Each recipient gets their OWN catch-up multiplier.
 *
 * `excludePlayerIds` skips the hero(es) credited with the kill — the last-hit
 * path pays them their (possibly split) WAVE_XP itself, so they must not also
 * draw the share. A shared strip has several claimants, hence the array form.
 *
 * Returns the SAME object when nobody qualifies, which is the common case on a
 * per-cycle path — reference equality lets downstream diffs skip cheaply.
 */
export function awardZoneXp(
  players: Record<string, PlayerState>,
  zone: string,
  team: TeamId,
  xp: number,
  excludePlayerIds?: string | readonly string[],
): Record<string, PlayerState> {
  if (xp <= 0) return players

  const excluded =
    typeof excludePlayerIds === 'string' ? [excludePlayerIds] : (excludePlayerIds ?? [])
  let next = players
  for (const [id, player] of Object.entries(players)) {
    if (!player.alive || player.team !== team || player.zone !== zone) continue
    if (excluded.includes(id)) continue
    next = awardXp(next, id, xp)
  }
  return next
}
