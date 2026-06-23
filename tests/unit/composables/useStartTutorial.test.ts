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

  it('routes to /login when not signed in (401)', async () => {
    mockFetch.mockRejectedValue({ statusCode: 401 })
    const { start } = useStartTutorial()

    await start()

    expect(mockNavigateTo).toHaveBeenCalledWith('/login')
  })

  it('routes to /lobby on any other failure', async () => {
    mockFetch.mockRejectedValue({ statusCode: 409 })
    const { start } = useStartTutorial()

    await start()

    expect(mockNavigateTo).toHaveBeenCalledWith('/lobby')
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
