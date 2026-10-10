/**
 * Guest ids (see server/api/auth/guest.post.ts) are `guest_<hex>` and never
 * back a `players` DB row. Every identity-touching path (queue join, tutorial
 * completion persistence, profile/settings) must check this before reading or
 * writing that row for a player id.
 */
export function isGuestId(playerId: string): boolean {
  return playerId.startsWith('guest_')
}

/**
 * The `secure` (server-only) session block to write when a session is swapped
 * for a real identity (register, password login, GitHub/Discord). When the
 * session being replaced was a GUEST, its id is carried over as
 * `formerGuestId`: that guest's practice game may still be open in another tab,
 * and its orders must be refused with "you signed in", not a bare 403 the
 * client reads as a network failure (playtest 2, Oct 2026). Undefined for any
 * other session — every replace sets `secure` explicitly so nothing stale
 * survives (see the replaceUserSession note in register.post.ts).
 */
export function upgradedSessionSecure(
  prior: { user?: { id?: string; guest?: boolean } } | null | undefined,
): { formerGuestId: string } | undefined {
  const id = prior?.user?.id
  return prior?.user?.guest && id && isGuestId(id) ? { formerGuestId: id } : undefined
}

/** The error code a former guest's order to their old practice game carries. */
export const GAME_SESSION_CHANGED = 'GAME_SESSION_CHANGED'

/** What the old tab should tell the player. */
export const GAME_SESSION_CHANGED_MESSAGE =
  'You signed in — this guest practice ended. Start a new one.'

/**
 * Whether a session that is NOT on `roster` used to be a guest that IS on it:
 * the guest signed in or registered (in this tab or another) while their
 * practice game was running. The game belongs to the guest id; the session no
 * longer carries it.
 */
export function isFormerGuestOf(
  session: { secure?: { formerGuestId?: string } } | null | undefined,
  roster: { players: ReadonlyArray<{ playerId: string }> },
): boolean {
  const former = session?.secure?.formerGuestId
  return !!former && roster.players.some((p) => p.playerId === former)
}
