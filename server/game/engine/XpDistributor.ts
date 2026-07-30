import type { PlayerState, TeamId } from '~~/shared/types/game'

/**
 * Pay `xp` to every living hero of `team` standing in `zone`.
 *
 * The lane-presence half of wave XP: being there when a wave dies pays,
 * whoever — or whatever — landed the killing blow. Peer of GoldDistributor,
 * shared so the two callers that mean "a wave died here" (a hero last-hit in
 * ActionResolver, a wave-on-wave kill in WaveAI) cannot drift apart.
 *
 * `excludePlayerId` skips the hero credited with the kill — the last-hit path
 * pays them the full WAVE_XP itself, so they must not also draw the share.
 *
 * Returns the SAME object when nobody qualifies, which is the common case on a
 * per-tick path and keeps StateDelta's reference-equality diff quiet.
 */
export function awardZoneXp(
  players: Record<string, PlayerState>,
  zone: string,
  team: TeamId,
  xp: number,
  excludePlayerId?: string,
): Record<string, PlayerState> {
  if (xp <= 0) return players

  let next = players
  for (const [id, player] of Object.entries(players)) {
    if (!player.alive || player.team !== team || player.zone !== zone) continue
    if (id === excludePlayerId) continue
    next = { ...next, [id]: { ...player, xp: player.xp + xp } }
  }
  return next
}
