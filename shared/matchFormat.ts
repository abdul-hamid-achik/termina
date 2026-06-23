// Pure presentation helpers for match data (mode labels + per-player result).
// Kept in shared/ so both the profile UI and any future server-rendered summary
// format identically. No engine state here — display only.

export const GAME_MODE_LABELS = {
  ranked_5v5: 'Ranked 5v5',
  quick_3v3: 'Quick 3v3',
  '1v1': '1v1 Duel',
} as const

export type GameMode = keyof typeof GAME_MODE_LABELS

/**
 * Human label for a game mode. Known modes map to a friendly label; an unknown
 * or legacy value degrades gracefully to its underscores-as-spaces form rather
 * than leaking a raw enum like `ranked_5v5`.
 */
export function formatGameMode(mode: string): string {
  return (GAME_MODE_LABELS as Record<string, string>)[mode] ?? mode.replace(/_/g, ' ')
}

export type MatchResult = 'Victory' | 'Defeat' | 'In Progress'

/**
 * Result from a player's own perspective, given the match `winner` and the
 * player's `team` in that match. A null winner = still in progress; a missing
 * team (shouldn't happen for a player's own history) can't be attributed, so it
 * also reads as in progress rather than guessing.
 */
export function matchResult(
  winner: 'radiant' | 'dire' | null | undefined,
  playerTeam: 'radiant' | 'dire' | null | undefined,
): MatchResult {
  if (!winner || !playerTeam) return 'In Progress'
  return winner === playerTeam ? 'Victory' : 'Defeat'
}
