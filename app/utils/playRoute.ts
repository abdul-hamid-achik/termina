import type { LocationQuery } from 'vue-router'

/** What a tab whose guest practice ended under a sign-in elsewhere reads. */
export const GUEST_SESSION_CHANGED_MESSAGE =
  'You signed in on another tab — this guest practice ended.'
/** The same, for a signed-in player whose session no longer owns the game. */
export const SESSION_CHANGED_MESSAGE =
  'This match is no longer tied to your session — it ended here.'

/** The ended-session panel's text for a game that belonged to `playerId`. */
export function sessionChangedMessage(playerId: string | null | undefined): string {
  return playerId?.startsWith('guest_') ? GUEST_SESSION_CHANGED_MESSAGE : SESSION_CHANGED_MESSAGE
}

/** The slice of the game store /play adopts its ids into. */
interface PlayIds {
  gameId: string | null
  playerId: string | null
  reset: () => void
  endSession: (message: string, reason?: 'finished' | 'changed') => void
}

/**
 * Adopt /play's ids. A `tutorial=1` URL names the game to open AND the player
 * it was started for; the launchers (useStartTutorial) build it from the
 * session the game was created under. The session is the player:
 *
 * - URL player == session player (or no session id yet): open it.
 * - URL player != session player: the game is someone else's — an old guest
 *   practice reloaded after signing in elsewhere. Subscribing the account's
 *   channel to it hung silently on "waiting for the first cycle" (round-4
 *   review), so the session ends as 'changed' at once and the panel offers a
 *   new practice / the lobby. Nothing connects (GameScreen skips the channel
 *   for an ended session).
 *
 * Opening a different game drops the old one's state first. Returns false when
 * there is nothing to open (the caller sends the player to the lobby).
 */
export function adoptPlayRoute(
  store: PlayIds,
  query: LocationQuery,
  sessionPlayerId: string | null | undefined,
): boolean {
  if (query.tutorial === '1' && typeof query.gameId === 'string' && query.gameId) {
    if (store.gameId !== null && store.gameId !== query.gameId) store.reset()
    store.gameId = query.gameId
    const fromUrl = typeof query.playerId === 'string' && query.playerId ? query.playerId : null
    store.playerId = sessionPlayerId || fromUrl
    if (sessionPlayerId && fromUrl && fromUrl !== sessionPlayerId) {
      store.endSession(sessionChangedMessage(fromUrl), 'changed')
    }
  } else if (sessionPlayerId && store.gameId && store.playerId !== sessionPlayerId) {
    // A lobby-found game opened under a stale (or missing) id: the session is
    // the truth.
    store.playerId = sessionPlayerId
  }
  return !!store.gameId && !!store.playerId
}
