import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * Playtest 3, end to end on the client: a guest practice → the guest signs in on
 * another tab → [NEW PRACTICE]. The tab used to keep `guest_…` as its player,
 * open the new game on `game:<new>:p:guest_…` (Ably: 40160) and sit on "Cycle 0
 * · Waiting for the first cycle" forever. Drives the real game/lobby/auth
 * stores, the Ably channel composable, the practice launcher and /play's id
 * adoption — only the network and the Ably SDK are doubles.
 */

const { FakeRealtime } = vi.hoisted(() => {
  class FakeChannel {
    listener: ((m: { name: string; data: unknown }) => void) | null = null
    presence = { enter: vi.fn(async () => {}), leave: vi.fn(async () => {}) }
    constructor(public name: string) {}
    subscribe(l: (m: { name: string; data: unknown }) => void) {
      this.listener = l
      return Promise.resolve(null)
    }
    unsubscribe = vi.fn()
  }

  class FakeRealtime {
    static all: FakeRealtime[] = []
    channel: FakeChannel | null = null
    connection = { state: 'initialized', on: vi.fn(), ping: vi.fn(async () => 1) }
    channels = {
      get: (name: string) => (this.channel = this.channel ?? new FakeChannel(name)),
    }
    close = vi.fn()
    constructor() {
      FakeRealtime.all.push(this)
    }
  }
  return { FakeRealtime }
})

vi.mock('ably', () => ({ Realtime: FakeRealtime }))
vi.mock('vue', async () => ({ ...(await vi.importActual<object>('vue')), onUnmounted: vi.fn() }))

import { useGameChannel } from '~~/app/composables/useGameChannel'
import { useStartTutorial } from '~~/app/composables/useStartTutorial'
import { adoptPlayRoute } from '~~/app/utils/playRoute'
import { useGameStore } from '~~/app/stores/game'
import { useLobbyStore } from '~~/app/stores/lobby'

// The session cookie, as the SERVER sees it, and this tab's (stale) copy of it.
let cookieUser: { id: string; guest?: boolean }
const tabUser = { value: null as { id: string; guest?: boolean } | null }
const sessionFetch = vi.fn(async () => {
  tabUser.value = { ...cookieUser }
})
const navigateTo = vi.fn()

beforeEach(() => {
  setActivePinia(createPinia())
  FakeRealtime.all = []
  cookieUser = { id: 'guest_abc', guest: true }
  tabUser.value = { ...cookieUser }
  sessionFetch.mockClear()
  navigateTo.mockReset()
  vi.stubGlobal('useUserSession', () => ({ user: tabUser, fetch: sessionFetch }))
  vi.stubGlobal('navigateTo', navigateTo)
  vi.stubGlobal(
    '$fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/game/practice') return { gameId: 'g_new' }
      throw new Error(`unexpected ${url}`)
    }),
  )
  // The guest game's order endpoint refuses once the cookie names someone else.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/game/action') {
        return {
          ok: false,
          status: 409,
          json: async () => ({
            statusCode: 409,
            message: 'You signed in on another tab — this guest practice ended.',
            data: { code: 'GAME_SESSION_CHANGED' },
          }),
        }
      }
      return { ok: true, json: async () => ({}) }
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('guest game → session change → new practice', () => {
  it('opens the new game on the CURRENT player’s channel', async () => {
    const game = useGameStore()

    // 1. The guest practice, live.
    const guestTab = useGameChannel()
    guestTab.connect('g_guest', 'guest_abc')
    expect(FakeRealtime.all[0]!.channel!.name).toBe('game:g_guest:p:guest_abc')
    useLobbyStore().queueStatus = 'searching'

    // 2. Signed in on another tab: the cookie is a real user now; the next
    //    order is refused and the guest game ends here.
    cookieUser = { id: 'github_7' }
    guestTab.send({ type: 'action', command: { type: 'move', zone: 'coldstore-cross' } })
    await vi.waitFor(() => expect(game.sessionEndReason).toBe('changed'))
    expect(FakeRealtime.all[0]!.close).toHaveBeenCalled()

    // 3. [NEW PRACTICE].
    await useStartTutorial().start()
    expect(sessionFetch).toHaveBeenCalled()
    const url = navigateTo.mock.calls.at(-1)![0] as string
    expect(url).toBe('/play?gameId=g_new&tutorial=1&playerId=github_7')
    expect(game.sessionEnded).toBeNull()
    expect(useLobbyStore().queueStatus).toBe('idle')

    // 4. /play adopts the ids (same page instance — query change).
    const query = Object.fromEntries(new URL(url, 'http://x').searchParams)
    expect(adoptPlayRoute(game, query, tabUser.value?.id)).toBe(true)
    expect(game.gameId).toBe('g_new')
    expect(game.playerId).toBe('github_7')

    // 5. The remounted screen subscribes as the signed-in player and ticks.
    const freshTab = useGameChannel()
    freshTab.connect(game.gameId!, game.playerId!)
    const channel = FakeRealtime.all.at(-1)!.channel!
    expect(channel.name).toBe('game:g_new:p:github_7')
    channel.listener!({
      name: 'cycle_state',
      data: { cycle: 3, state: { cycle: 3, player: null, players: {}, zones: {}, events: [] } },
    })
    expect(game.cycle).toBe(3)
  })

  it('a URL that still names the guest is overruled by the refreshed session', async () => {
    cookieUser = { id: 'github_7' }
    await useStartTutorial().start()
    const game = useGameStore()
    adoptPlayRoute(
      game,
      { tutorial: '1', gameId: 'g_new', playerId: 'guest_abc' },
      tabUser.value?.id,
    )
    expect(game.playerId).toBe('github_7')
  })
})
