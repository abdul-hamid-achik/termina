import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useStartTutorial } from '~~/app/composables/useStartTutorial'
import { useGameStore } from '~~/app/stores/game'
import { useLobbyStore } from '~~/app/stores/lobby'

// The composable uses Nuxt auto-imports ($fetch, navigateTo, useUserSession)
// as globals — stub them the same way IndexPage.test.ts does.
const mockNavigateTo = vi.fn()
const mockFetch = vi.fn()

beforeEach(() => {
  setActivePinia(createPinia())
  mockNavigateTo.mockReset()
  mockFetch.mockReset()
  vi.stubGlobal('navigateTo', mockNavigateTo)
  vi.stubGlobal('$fetch', mockFetch)
  vi.stubGlobal('useUserSession', () => ({ user: { value: { id: 'p1' } }, fetch: vi.fn() }))
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useStartTutorial', () => {
  it('POSTs /api/game/practice and navigates to /play with the returned gameId + session playerId', async () => {
    mockFetch.mockResolvedValue({ gameId: 'g1' })
    const { start, starting } = useStartTutorial()

    expect(starting.value).toBe(false)
    await start()

    expect(mockFetch).toHaveBeenCalledWith('/api/game/practice', { method: 'POST', body: {} })
    expect(mockNavigateTo).toHaveBeenCalledWith('/play?gameId=g1&tutorial=1&playerId=p1')
    expect(starting.value).toBe(false) // reset in finally
  })

  it('forwards a chosen hero as heroSelf', async () => {
    mockFetch.mockResolvedValue({ gameId: 'g2' })
    const { start } = useStartTutorial()

    await start('daemon')

    expect(mockFetch).toHaveBeenCalledWith('/api/game/practice', {
      method: 'POST',
      body: { heroSelf: 'daemon' },
    })
  })

  it('ignores a non-string argument — the bare @click call sites pass a MouseEvent', async () => {
    // `@click="startTutorial"` on five pages hands the handler its event. Without
    // the typeof guard that event is posted as `heroSelf` and the server silently
    // falls back to its default hero, so the bug would be invisible in the UI.
    mockFetch.mockResolvedValue({ gameId: 'g4' })
    const { start } = useStartTutorial()

    // A DOM-free stand-in for the event (this project runs unit tests in node).
    await start({ type: 'click', isTrusted: true } as unknown as MouseEvent)

    expect(mockFetch).toHaveBeenCalledWith('/api/game/practice', { method: 'POST', body: {} })
  })

  it('omits playerId from the URL when no session user id is available', async () => {
    vi.stubGlobal('useUserSession', () => ({ user: { value: null }, fetch: vi.fn() }))
    mockFetch.mockResolvedValue({ gameId: 'g3' })
    const { start } = useStartTutorial()

    await start()

    expect(mockNavigateTo).toHaveBeenCalledWith('/play?gameId=g3&tutorial=1')
  })

  it('mints a guest session and retries the launch when not signed in (401)', async () => {
    // Guest funnel (server/api/auth/guest.post.ts): the first /api/game/practice
    // call 401s (no session), so the composable mints a guest session and
    // retries the SAME launch once — no login wall for a first-time visitor.
    const mockSessionFetch = vi.fn()
    vi.stubGlobal('useUserSession', () => ({
      user: { value: { id: 'guest_abc123' } },
      fetch: mockSessionFetch,
    }))
    let calls = 0
    mockFetch.mockImplementation((url: string) => {
      if (url === '/api/game/practice') {
        calls += 1
        if (calls === 1) return Promise.reject({ statusCode: 401 })
        return Promise.resolve({ gameId: 'g5' })
      }
      if (url === '/api/auth/guest') {
        return Promise.resolve({ user: { id: 'guest_abc123', guest: true } })
      }
      throw new Error(`unexpected $fetch call: ${url}`)
    })
    const { start, error } = useStartTutorial()

    await start()

    expect(mockFetch).toHaveBeenCalledWith('/api/auth/guest', { method: 'POST' })
    // The reactive session must refresh so the header/store see the new
    // (guest) user immediately — same as any other login path.
    const guestCall = mockFetch.mock.calls.findIndex(([url]) => url === '/api/auth/guest')
    const guestOrder = mockFetch.mock.invocationCallOrder[guestCall]!
    expect(mockSessionFetch.mock.invocationCallOrder.some((o) => o > guestOrder)).toBe(true)
    expect(calls).toBe(2)
    expect(mockNavigateTo).toHaveBeenCalledWith('/play?gameId=g5&tutorial=1&playerId=guest_abc123')
    expect(error.value).toBeNull()
  })

  it('falls back to /login when guest-session minting itself fails', async () => {
    vi.stubGlobal('useUserSession', () => ({ user: { value: null }, fetch: vi.fn() }))
    mockFetch.mockImplementation((url: string) => {
      if (url === '/api/game/practice') return Promise.reject({ statusCode: 401 })
      if (url === '/api/auth/guest') return Promise.reject({ statusCode: 503 })
      throw new Error(`unexpected $fetch call: ${url}`)
    })
    const { start, error } = useStartTutorial()

    await start()

    // `next` rather than `redirect`: there is no URL that starts a practice
    // game (the launcher POSTs), so login re-fires this call once a real
    // session exists instead of dropping the player on a page.
    expect(mockNavigateTo).toHaveBeenCalledWith({ path: '/login', query: { next: 'practice' } })
    expect(error.value).toBeTruthy()
  })

  it('does not bounce to /login when guest-session minting is only rate limited', async () => {
    // A 429 means "try again shortly", not "you need an account" — sending the
    // player to a login wall for a transient rate limit would recreate the
    // exact dead end this feature exists to remove.
    vi.stubGlobal('useUserSession', () => ({ user: { value: null }, fetch: vi.fn() }))
    mockFetch.mockImplementation((url: string) => {
      if (url === '/api/game/practice') return Promise.reject({ statusCode: 401 })
      if (url === '/api/auth/guest') {
        return Promise.reject({
          statusCode: 429,
          data: { message: 'Too many guest sessions — try again shortly' },
        })
      }
      throw new Error(`unexpected $fetch call: ${url}`)
    })
    const { start, error } = useStartTutorial()

    await start()

    expect(mockNavigateTo).not.toHaveBeenCalled()
    expect(error.value).toBe('Too many guest sessions — try again shortly')
  })

  it('surfaces the failure instead of silently redirecting', async () => {
    // REGRESSION: any non-401 failure used to navigateTo('/lobby') with no
    // message. The common case was a 409 from a previous practice game the
    // player had abandoned — they pressed "practice", landed on the lobby, and
    // reasonably concluded the button was broken.
    mockFetch.mockRejectedValue({ statusCode: 409, data: { message: "You're already in a match" } })
    const { start, error } = useStartTutorial()

    await start()

    expect(error.value).toBe("You're already in a match")
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })

  it('falls back to a readable message when the server sends no reason', async () => {
    mockFetch.mockRejectedValue({ statusCode: 503 })
    const { start, error } = useStartTutorial()

    await start()

    expect(error.value).toBeTruthy()
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })

  it('clears a previous error when a later attempt succeeds', async () => {
    mockFetch.mockRejectedValue({ statusCode: 503 })
    const { start, error } = useStartTutorial()
    await start()
    expect(error.value).toBeTruthy()

    mockFetch.mockReset()
    mockFetch.mockResolvedValue({ gameId: 'g9' })
    await start()

    expect(error.value).toBeNull()
    expect(mockNavigateTo).toHaveBeenCalledWith('/play?gameId=g9&tutorial=1&playerId=p1')
  })

  it('ignores re-entrant calls while a start is already in flight', async () => {
    let resolve: (v: { gameId: string }) => void = () => {}
    mockFetch.mockReturnValue(
      new Promise<{ gameId: string }>((r) => {
        resolve = r
      }),
    )
    const { start, starting } = useStartTutorial()

    const first = start()
    expect(starting.value).toBe(true)
    await start() // re-entrant: should no-op while the first is pending
    await new Promise((r) => setTimeout(r, 0)) // the session re-read runs first

    expect(mockFetch).toHaveBeenCalledTimes(1)

    resolve({ gameId: 'g2' })
    await first
    expect(mockNavigateTo).toHaveBeenCalledTimes(1)
  })

  // Playtest 3: a guest practice ended because the guest signed in on another
  // tab. [NEW PRACTICE] built the /play URL from the tab's STALE session (the
  // guest), so the new game was opened on `game:<id>:p:guest_…` — denied.
  describe('session changed under the tab', () => {
    function staleSession(fresh: string) {
      const user = { value: { id: 'guest_old' } as { id: string } | null }
      const fetch = vi.fn(async () => {
        user.value = { id: fresh }
      })
      vi.stubGlobal('useUserSession', () => ({ user, fetch }))
      return fetch
    }

    it('re-reads the session BEFORE asking for a game and names the current player', async () => {
      const sessionFetch = staleSession('github_7')
      mockFetch.mockResolvedValue({ gameId: 'g_new' })

      await useStartTutorial().start()

      expect(sessionFetch).toHaveBeenCalled()
      expect(sessionFetch.mock.invocationCallOrder[0]!).toBeLessThan(
        mockFetch.mock.invocationCallOrder[0]!,
      )
      expect(mockNavigateTo).toHaveBeenCalledWith('/play?gameId=g_new&tutorial=1&playerId=github_7')
    })

    it('drops the dead game and its lobby state, keying the store to the current player', async () => {
      staleSession('github_7')
      const game = useGameStore()
      game.gameId = 'g_dead'
      game.playerId = 'guest_old'
      game.endSession('You signed in on another tab — this guest practice ended.', 'changed')
      useLobbyStore().queueStatus = 'searching'
      mockFetch.mockResolvedValue({ gameId: 'g_new' })

      await useStartTutorial().start()

      expect(game.sessionEnded).toBeNull()
      expect(game.gameId).toBeNull() // /play adopts g_new from the URL
      expect(game.playerId).toBe('github_7')
      expect(useLobbyStore().queueStatus).toBe('idle')
    })

    it('starts clean even for the same player (a finished practice, a stale queue)', async () => {
      const game = useGameStore()
      game.gameId = 'g_done'
      game.playerId = 'p1'
      game.endSession('This game has finished — it is no longer running.', 'finished')
      useLobbyStore().queueStatus = 'searching'
      mockFetch.mockResolvedValue({ gameId: 'g_next' })

      await useStartTutorial().start()

      expect(game.sessionEnded).toBeNull()
      expect(game.gameId).toBeNull()
      expect(useLobbyStore().queueStatus).toBe('idle')
    })

    it('keeps the ended panel when the new practice could not start', async () => {
      staleSession('github_7')
      const game = useGameStore()
      game.gameId = 'g_dead'
      game.playerId = 'guest_old'
      game.endSession('ended', 'changed')
      mockFetch.mockRejectedValue({ statusCode: 503, data: { message: 'warming up' } })

      const { start, error } = useStartTutorial()
      await start()

      expect(error.value).toBe('warming up')
      expect(game.sessionEnded).toBe('ended')
    })
  })
})
