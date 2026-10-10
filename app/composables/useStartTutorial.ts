import { ref } from 'vue'
import { useAuthStore } from '~/stores/auth'

/** Minting the guest session itself failed — reported as the guest path, not
 *  as a practice-start failure (login fallback, 429 stays put). */
class GuestSessionError extends Error {
  constructor(readonly inner: unknown) {
    super('guest session failed')
  }
}

/**
 * Shared "Practice vs bots" launcher. Spins up a guided one-lane tutorial vs
 * bots and jumps straight in, bypassing matchmaking. Lives in one place so the
 * landing page and the hero training console share a single learn → play code
 * path (and one set of tests) rather than duplicating the fetch/redirect dance.
 *
 * `$fetch` and `navigateTo` are Nuxt auto-imports (globals under the SFC/Nuxt
 * runtime); the unit test stubs them via `vi.stubGlobal`.
 */
export function useStartTutorial() {
  const starting = ref(false)
  /**
   * Why the last attempt didn't start a game, for the caller to display. A
   * silent redirect is indistinguishable from a broken button — the player
   * pressed "practice" and landed somewhere else with no idea why.
   */
  const error = ref<string | null>(null)

  /**
   * `heroId` is optional and widened to include the event because most call
   * sites are bare `@click="startTutorial"` handlers, which forward a MouseEvent
   * as the first argument — a `string`-only parameter fails to typecheck against
   * AsciiButton's `(e: MouseEvent)` click emit, and the `typeof` guard (not a
   * truthiness check) is what keeps the event out of the request body. An
   * unrecognised id is not rejected here: the server already falls back to a
   * default hero.
   */
  async function launch(heroId?: string | MouseEvent) {
    const body = typeof heroId === 'string' ? { heroSelf: heroId } : {}

    // The Neon/Workflow live-game route (practice.post.ts) is the one true
    // practice path — the DO-era in-process game server's tutorial.post.ts
    // (which returned a ready-made { url }) was deleted with the rest of the
    // DO/Redis stack, so the /play URL is built by hand from { gameId }.
    //
    // The session is re-read FIRST: the server keys the new game to the cookie,
    // and a tab whose guest signed in elsewhere still holds the guest id — the
    // /play URL then named the guest and Ably denied the channel (playtest 3).
    // Only after the game exists is the old game/lobby state dropped, so a
    // failed launch leaves the ended-session panel (and its error) on screen.
    const auth = useAuthStore()
    const knownBefore = auth.sessionUserId()
    await auth.fetchUser()
    // Signed out before AND after a fresh read: the practice POST is a known
    // 401 (it used to be fired anyway and retried — a red line in the console
    // on every first visit). Mint the guest first. Only when BOTH reads say
    // "no session": a tab that held a session and now reads none may just have
    // had the read fail, and minting a guest would overwrite a real sign-in —
    // that case keeps the old path, the practice 401 is its proof.
    if (!knownBefore && !auth.sessionUserId()) await mintGuest()
    const res = await $fetch<{ gameId: string; playerId?: string }>('/api/game/practice', {
      method: 'POST',
      body,
    })
    const sessionId = await auth.refreshIdentity({ fresh: true, refetch: false })
    const playerId = res.playerId ?? sessionId
    const params = new URLSearchParams({ gameId: res.gameId, tutorial: '1' })
    if (playerId) params.set('playerId', playerId)
    await navigateTo(`/play?${params.toString()}`)
  }

  /** A throwaway guest session (server/api/auth/guest.post.ts), then the
   *  reactive session refresh so the header/store see the guest at once. */
  async function mintGuest() {
    try {
      await $fetch('/api/auth/guest', { method: 'POST' })
      await useUserSession().fetch()
    } catch (err: unknown) {
      throw new GuestSessionError(err)
    }
  }

  /** A guest session could not be minted: say why, and offer the login page
   *  unless it is only the guest limiter (retrying login won't beat it). */
  async function guestFailed(guestErr: unknown) {
    const ge = guestErr as { statusCode?: number; data?: { message?: string }; message?: string }
    error.value = ge?.data?.message ?? ge?.message ?? 'Could not start a guest practice game.'
    // `next` rather than `redirect`: there is no URL that starts a practice
    // game (the launcher POSTs), so login re-fires this call once a real
    // session exists instead of dropping the player on a page.
    if (ge?.statusCode !== 429) {
      await navigateTo({ path: '/login', query: { next: 'practice' } })
    }
  }

  async function start(heroId?: string | MouseEvent) {
    if (starting.value) return
    starting.value = true
    error.value = null
    try {
      await launch(heroId)
    } catch (err: unknown) {
      if (err instanceof GuestSessionError) {
        await guestFailed(err.inner)
        return
      }
      const e = err as { statusCode?: number; data?: { message?: string }; message?: string }
      if (e?.statusCode === 401) {
        // No account is not a dead end — an anonymous visitor gets a throwaway
        // guest session (no DB row, nothing persisted) and the launch retries
        // once. Signing in is only needed to KEEP progress, not to try the
        // game. A signed-out tab mints the guest up front (launch); this is
        // the backstop for a session that vanished between the read and the
        // POST.
        try {
          await mintGuest()
          await launch(heroId)
        } catch (retryErr: unknown) {
          if (retryErr instanceof GuestSessionError) await guestFailed(retryErr.inner)
          else {
            const r = retryErr as { data?: { message?: string }; message?: string }
            error.value = r?.data?.message ?? r?.message ?? 'Could not start a guest practice game.'
          }
        }
        return
      }
      // Surface the server's reason (already in a match, rate limited, server
      // still warming up) instead of dumping the player somewhere unexplained.
      error.value =
        e?.data?.message ??
        e?.message ??
        'Could not start a practice game. Give it a moment and try again.'
    } finally {
      starting.value = false
    }
  }

  return { starting, error, start }
}
