/**
 * Guest ids (see server/api/auth/guest.post.ts) are `guest_<hex>` and never
 * back a `players` DB row. Every identity-touching path (queue join, tutorial
 * completion persistence, profile/settings) must check this before reading or
 * writing that row for a player id.
 */
export function isGuestId(playerId: string): boolean {
  return playerId.startsWith('guest_')
}
