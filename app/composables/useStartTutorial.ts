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

  async function start() {
    if (starting.value) return
    starting.value = true
    error.value = null
    try {
      const res = await $fetch<{ url: string }>('/api/game/tutorial', { method: 'POST', body: {} })
      await navigateTo(res.url)
    } catch (err: unknown) {
      const e = err as { statusCode?: number; data?: { message?: string }; message?: string }
      const status = e?.statusCode
      if (status === 401) {
        error.value = 'Sign in first — practice games are saved to your profile.'
        await navigateTo('/login')
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
