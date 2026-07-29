import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useStartTutorial } from '../../../app/composables/useStartTutorial'

// The composable uses Nuxt auto-imports ($fetch, navigateTo) as globals — stub
// them the same way IndexPage.test.ts does.
const mockNavigateTo = vi.fn()
const mockFetch = vi.fn()

beforeEach(() => {
  mockNavigateTo.mockReset()
  mockFetch.mockReset()
  vi.stubGlobal('navigateTo', mockNavigateTo)
  vi.stubGlobal('$fetch', mockFetch)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useStartTutorial', () => {
  it('POSTs to the tutorial route and navigates to the returned game URL', async () => {
    mockFetch.mockResolvedValue({ url: '/play?gameId=g1&tutorial=1' })
    const { start, starting } = useStartTutorial()

    expect(starting.value).toBe(false)
    await start()

    expect(mockFetch).toHaveBeenCalledWith('/api/game/tutorial', { method: 'POST', body: {} })
    expect(mockNavigateTo).toHaveBeenCalledWith('/play?gameId=g1&tutorial=1')
    expect(starting.value).toBe(false) // reset in finally
  })

  it('routes to /login when not signed in (401), explaining why', async () => {
    mockFetch.mockRejectedValue({ statusCode: 401 })
    const { start, error } = useStartTutorial()

    await start()

    expect(mockNavigateTo).toHaveBeenCalledWith('/login')
    expect(error.value).toBeTruthy()
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
    mockFetch.mockResolvedValue({ url: '/play?gameId=g9&tutorial=1' })
    await start()

    expect(error.value).toBeNull()
    expect(mockNavigateTo).toHaveBeenCalledWith('/play?gameId=g9&tutorial=1')
  })

  it('ignores re-entrant calls while a start is already in flight', async () => {
    let resolve: (v: { url: string }) => void = () => {}
    mockFetch.mockReturnValue(
      new Promise<{ url: string }>((r) => {
        resolve = r
      }),
    )
    const { start, starting } = useStartTutorial()

    const first = start()
    expect(starting.value).toBe(true)
    await start() // re-entrant: should no-op while the first is pending

    expect(mockFetch).toHaveBeenCalledTimes(1)

    resolve({ url: '/play?gameId=g2' })
    await first
    expect(mockNavigateTo).toHaveBeenCalledTimes(1)
  })
})
