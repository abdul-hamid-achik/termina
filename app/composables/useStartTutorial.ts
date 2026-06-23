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

  async function start() {
    if (starting.value) return
    starting.value = true
    try {
      const res = await $fetch<{ url: string }>('/api/game/tutorial', { method: 'POST', body: {} })
      await navigateTo(res.url)
    } catch (err: unknown) {
      const status = (err as { statusCode?: number })?.statusCode
      // 401 = not signed in → login. Anything else (already in a game, server
      // warming up) routes to the lobby, which surfaces the right next step.
      await navigateTo(status === 401 ? '/login' : '/lobby')
    } finally {
      starting.value = false
    }
  }

  return { starting, start }
}
