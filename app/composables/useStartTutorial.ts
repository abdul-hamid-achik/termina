import { ref } from 'vue'

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
    const res = await $fetch<{ url: string }>('/api/game/tutorial', {
      method: 'POST',
      body: typeof heroId === 'string' ? { heroSelf: heroId } : {},
    })
    await navigateTo(res.url)
  }

  async function start(heroId?: string | MouseEvent) {
    if (starting.value) return
    starting.value = true
    error.value = null
    try {
      await launch(heroId)
    } catch (err: unknown) {
      const e = err as { statusCode?: number; data?: { message?: string }; message?: string }
      if (e?.statusCode === 401) {
        // No account is not a dead end — an anonymous visitor gets a throwaway
        // guest session (server/api/auth/guest.post.ts: no DB row, nothing
        // persisted) and the launch retries once. Signing in is only needed to
        // KEEP progress, not to try the game — that's the whole point of the
        // funnel fix this composable exists for.
        try {
          await $fetch('/api/auth/guest', { method: 'POST' })
          // Refresh the reactive session so the header/store see the new
          // (guest) user immediately, same as any other login path.
          await useUserSession().fetch()
          await launch(heroId)
          return
        } catch (guestErr: unknown) {
          const ge = guestErr as {
            statusCode?: number
            data?: { message?: string }
            message?: string
          }
          error.value = ge?.data?.message ?? ge?.message ?? 'Could not start a guest practice game.'
          // `next` rather than `redirect`: there is no URL that starts a
          // practice game (the launcher POSTs), so login re-fires this call
          // once a real session exists instead of dropping the player on a
          // page. Skip the bounce on a rate limit — retrying login won't help
          // faster than just waiting out the guest-session limiter.
          if (ge?.statusCode !== 429) {
            await navigateTo({ path: '/login', query: { next: 'practice' } })
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
