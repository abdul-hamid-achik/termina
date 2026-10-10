import { defineStore } from 'pinia'
import { useGameStore } from '~/stores/game'
import { useLobbyStore } from '~/stores/lobby'

export const useAuthStore = defineStore('auth', () => {
  const { loggedIn, user, fetch: fetchSession, clear: clearSession } = useUserSession()

  const isAuthenticated = loggedIn

  async function fetchUser() {
    await fetchSession()
  }

  /** The tab's current session player id (null when signed out). Read off the
   *  session ref itself — the store unwraps `user`, so callers can't. */
  function sessionUserId(): string | null {
    return typeof user.value?.id === 'string' ? user.value.id : null
  }

  /**
   * Make the tab agree with the CURRENT session before anything is keyed by a
   * player id. The session cookie changes under a tab: a guest who signs in on
   * another tab is a different player, and this tab's `useUserSession()` keeps
   * the guest until it is refetched. A practice/queue started on that stale id
   * subscribed to `game:<id>:p:guest_…` — denied by Ably (40160) — and sat on
   * "Waiting for the first cycle" forever (playtest 3).
   *
   * - `refetch` (default true): re-read the session first.
   * - `fresh`: a NEW game is about to be adopted — drop all game/lobby state.
   *   Otherwise state is dropped only when it belongs to a different player.
   *
   * Returns the current session's player id (null when signed out); the game
   * store's playerId is set to it.
   */
  async function refreshIdentity(
    opts: { fresh?: boolean; refetch?: boolean } = {},
  ): Promise<string | null> {
    if (opts.refetch !== false) {
      try {
        await fetchSession()
      } catch {
        // Keep the last known session — the caller's own request will say if
        // it is really gone.
      }
    }
    const id = sessionUserId()
    const game = useGameStore()
    if (opts.fresh || (game.playerId !== null && game.playerId !== id)) {
      game.reset()
      useLobbyStore().reset()
    }
    game.playerId = id
    return id
  }

  function loginOAuth(provider: 'github' | 'discord' = 'github') {
    // Carry ?redirect= across the OAuth round trip (provider handlers cannot
    // see the originating page query). Cookie is short-lived and same-site.
    if (import.meta.client) {
      const route = useRoute()
      const raw = typeof route.query.redirect === 'string' ? route.query.redirect : ''
      // Must start with a single slash — same guard as login.vue safeRedirect.
      if (raw.startsWith('/') && !(raw.length > 1 && (raw[1] === '/' || raw[1] === '\\'))) {
        const cookie = useCookie('termina_oauth_redirect', {
          maxAge: 600,
          sameSite: 'lax',
          path: '/',
        })
        cookie.value = raw
      }
    }
    navigateTo(`/api/auth/${provider}`, { external: true })
  }

  // Keep backward compat
  const login = loginOAuth

  /**
   * A guest who signs in or registers becomes a DIFFERENT player id (the guest
   * exists only in its session cookie — no DB row). Whatever game/lobby state
   * the tab holds is keyed by the guest id and would read as someone else's, so
   * drop it exactly as logout does. No-op for a non-guest (a real user logging
   * in over a real session keeps their behaviour).
   */
  function dropGuestState(wasGuest: boolean) {
    if (!wasGuest) return
    const game = useGameStore()
    game.reset()
    game.playerId = null
    useLobbyStore().reset()
  }

  async function loginWithCredentials(username: string, password: string) {
    const wasGuest = user.value?.guest === true
    const res = await $fetch('/api/auth/login', {
      method: 'POST',
      body: { username, password },
    })
    await fetchSession()
    dropGuestState(wasGuest)
    return res
  }

  async function register(username: string, password: string, email?: string) {
    const wasGuest = user.value?.guest === true
    const res = await $fetch('/api/auth/register', {
      method: 'POST',
      body: { username, password, email: email || undefined },
    })
    await fetchSession()
    dropGuestState(wasGuest)
    return res
  }

  /** Request a password-reset email. Always resolves (no account enumeration). */
  async function forgotPassword(username: string) {
    return $fetch('/api/auth/forgot-password', { method: 'POST', body: { username } })
  }

  /** Complete a password reset with the token from the email link. */
  async function resetPassword(token: string, password: string) {
    return $fetch('/api/auth/reset-password', { method: 'POST', body: { token, password } })
  }

  /** Confirm an email address with the token from the verification link. */
  async function verifyEmail(token: string) {
    return $fetch('/api/auth/verify-email', { method: 'POST', body: { token } })
  }

  async function logout() {
    // Drop the prior session's in-memory game/lobby state BEFORE clearing the
    // session, so it can't leak into the next user on a shared tab (the SPA
    // logout does no page reload, so the Pinia singletons otherwise survive).
    // reset() deliberately keeps playerId (for PostGame "play again"), so clear
    // it explicitly here — on logout it's the departing user's id.
    const game = useGameStore()
    game.reset()
    game.playerId = null
    useLobbyStore().reset()
    await clearSession()
    navigateTo('/')
  }

  return {
    user,
    isAuthenticated,
    fetchUser,
    sessionUserId,
    refreshIdentity,
    login,
    loginOAuth,
    loginWithCredentials,
    register,
    forgotPassword,
    resetPassword,
    verifyEmail,
    logout,
  }
})
