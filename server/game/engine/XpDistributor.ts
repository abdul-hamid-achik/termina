import type { PlayerState, TeamId } from '~~/shared/types/game'

/**
 * Pay `xp` to every living hero of `team` standing in `zone`.
 *
 * The lane-presence half of wave XP: being there when a wave dies pays,
 * whoever — or whatever — landed the killing blow. Peer of ScripDistributor,
 * shared so the two callers that mean "a wave died here" (a hero last-hit in
 * ActionResolver, a wave-on-wave kill in WaveAI) cannot drift apart.
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
    next = { ...next, [id]: { ...player, xp: player.xp + xp } }
  }
  return next
}
