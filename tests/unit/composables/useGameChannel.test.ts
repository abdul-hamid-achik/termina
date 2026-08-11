import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// ── Mock the Ably SDK ─────────────────────────────────────────────
//
// useGameChannel talks to Ably via `new Ably.Realtime({ authCallback })`,
// `client.connection.on(listener)`, and `client.channels.get(name).subscribe`.
// This fake reproduces just enough of that surface to drive the composable
// deterministically: a channel that records its name + subscribed listener,
// and a connection whose state the test can flip by calling `_setState`.

class MockChannel {
  name: string
  listener: ((message: { name: string; data: unknown }) => void) | null = null
  unsubscribe = vi.fn()

  constructor(name: string) {
    this.name = name
  }

  subscribe(listener: (message: { name: string; data: unknown }) => void) {
    this.listener = listener
    return Promise.resolve(null)
  }

  _receive(name: string, data: unknown) {
    this.listener?.({ name, data })
  }
}

class MockConnection {
  state = 'initialized'
  listeners: Array<(change: { current: string; previous: string }) => void> = []
  ping = vi.fn(() => Promise.resolve(42))

  on(listener: (change: { current: string; previous: string }) => void) {
    this.listeners.push(listener)
  }

  _setState(state: string) {
    const previous = this.state
    this.state = state
    for (const l of this.listeners) l({ current: state, previous })
  }
}

class MockRealtime {
  static last: MockRealtime | null = null
  options: { authCallback?: (...args: unknown[]) => void }
  connection = new MockConnection()
  channel: MockChannel | undefined
  channels = {
    get: (name: string) => {
      this.channel = this.channel ?? new MockChannel(name)
      return this.channel
    },
  }
  close = vi.fn()

  constructor(options: { authCallback?: (...args: unknown[]) => void }) {
    this.options = options
    MockRealtime.last = this
  }
}

vi.mock('ably', () => ({
  Realtime: MockRealtime,
}))

vi.mock('vue', async () => {
  const actual = await vi.importActual('vue')
  return {
    ...(actual as object),
    onUnmounted: vi.fn(),
  }
})

// ── Tests ─────────────────────────────────────────────────────────

describe('useGameChannel', () => {
  // oxlint-disable-next-line typescript/consistent-type-imports -- the module is dynamically re-imported per test (vi.resetModules); typeof import() is the idiomatic way to type it
  let useGameChannel: typeof import('../../../app/composables/useGameChannel').useGameChannel
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.resetModules()
    MockRealtime.last = null

    vi.stubGlobal('window', {
      location: { protocol: 'http:', host: 'localhost:3000', href: '' },
    })

    // Default fetch stub: ably-token succeeds, action POSTs accept. Individual
    // tests override this to exercise other response shapes.
    fetchMock = vi.fn((url: string) => {
      if (url === '/api/auth/ably-token') {
        return Promise.resolve({ ok: true, json: async () => ({ token: 'fake-token-request' }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({ accepted: true }) })
    })
    vi.stubGlobal('fetch', fetchMock)

    vi.doMock('ably', () => ({ Realtime: MockRealtime }))
    vi.doMock('vue', async () => {
      const actual = await vi.importActual('vue')
      return {
        ...(actual as object),
        onUnmounted: vi.fn(),
      }
    })

    const mod = await import('../../../app/composables/useGameChannel')
    useGameChannel = mod.useGameChannel
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe('connect', () => {
    it('subscribes to the per-player game channel', () => {
      const { connect } = useGameChannel()
      connect('game-1', 'player-1')

      expect(MockRealtime.last?.channel?.name).toBe('game:game-1:p:player-1')
    })

    it('sets gameId and playerId on the game store', async () => {
      const { useGameStore } = await import('../../../app/stores/game')
      const gameStore = useGameStore()

      const { connect } = useGameChannel()
      connect('game-1', 'player-1')

      expect(gameStore.gameId).toBe('game-1')
      expect(gameStore.playerId).toBe('player-1')
    })

    it('flips connected on when the Ably connection reports connected', () => {
      const { connect, connected } = useGameChannel()
      connect('game-1', 'player-1')

      expect(connected.value).toBe(false)
      MockRealtime.last!.connection._setState('connected')
      expect(connected.value).toBe(true)
    })
  })

  describe('message routing to game store', () => {
    it('routes an Ably cycle_state message to updateFromCycle', async () => {
      const { useGameStore } = await import('../../../app/stores/game')
      const store = useGameStore()
      const spy = vi.spyOn(store, 'updateFromCycle').mockImplementation(() => {})

      const { connect } = useGameChannel()
      connect('game-1', 'player-1')
      MockRealtime.last!.connection._setState('connected')

      MockRealtime.last!.channel!._receive('cycle_state', { cycle: 5, state: {} })

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'cycle_state', cycle: 5, state: {} }),
      )
    })

    it('feeds state.events from a cycle_state message into addEvents (the Ably path has no separate events message)', async () => {
      const { useGameStore } = await import('../../../app/stores/game')
      const store = useGameStore()
      vi.spyOn(store, 'updateFromCycle').mockImplementation(() => {})
      const addEventsSpy = vi.spyOn(store, 'addEvents').mockImplementation(() => {})

      const { connect } = useGameChannel()
      connect('game-1', 'player-1')
      MockRealtime.last!.connection._setState('connected')

      const events = [{ _tag: 'damage', sourceId: 'player-1', targetId: 'wave-1', amount: 10 }]
      MockRealtime.last!.channel!._receive('cycle_state', { cycle: 5, state: { events } })

      expect(addEventsSpy).toHaveBeenCalledWith(events)
    })

    it('feeds an empty array into addEvents when the cycle_state payload has no events field', async () => {
      const { useGameStore } = await import('../../../app/stores/game')
      const store = useGameStore()
      vi.spyOn(store, 'updateFromCycle').mockImplementation(() => {})
      const addEventsSpy = vi.spyOn(store, 'addEvents').mockImplementation(() => {})

      const { connect } = useGameChannel()
      connect('game-1', 'player-1')
      MockRealtime.last!.connection._setState('connected')

      MockRealtime.last!.channel!._receive('cycle_state', { cycle: 5, state: {} })

      expect(addEventsSpy).toHaveBeenCalledWith([])
    })

    it('routes an Ably game_over message to setGameOver (the tick workflow publishes it in the final batch)', async () => {
      const { useGameStore } = await import('../../../app/stores/game')
      const store = useGameStore()
      const spy = vi.spyOn(store, 'setGameOver').mockImplementation(() => {})

      const { connect } = useGameChannel()
      connect('game-1', 'player-1')
      MockRealtime.last!.connection._setState('connected')

      const stats = { 'player-1': { kills: 1, deaths: 0, assists: 2 } }
      MockRealtime.last!.channel!._receive('game_over', {
        winner: 'chaff',
        stats,
        ranked: false,
        durationCycles: 60,
      })

      expect(spy).toHaveBeenCalledWith('chaff', stats, undefined, false, 60)
    })
  })

  describe('send (action ingress)', () => {
    it('stamps forCycle/clientSeq and POSTs /api/game/action, and an accepted ack marks order committed', async () => {
      const { useGameStore } = await import('../../../app/stores/game')
      const store = useGameStore()
      store.cycle = 17
      const commitSpy = vi.spyOn(store, 'markOrderCommitted')

      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (url === '/api/game/action') {
          return Promise.resolve({
            ok: true,
            json: async () => ({ accepted: true, cycle: 17, slot: 'main' }),
            _body: init?.body,
          })
        }
        return Promise.resolve({ ok: true, json: async () => ({}) })
      })

      const { connect, send } = useGameChannel()
      connect('game-1', 'player-1')
      MockRealtime.last!.connection._setState('connected')

      const sent = send({ type: 'action', command: { type: 'move', zone: 'coldstore' } })
      expect(sent).toBe(true)

      // Let the fire-and-forget POST resolve.
      await vi.waitFor(() => {
        expect(commitSpy).toHaveBeenCalled()
      })

      const call = fetchMock.mock.calls.find((c) => c[0] === '/api/game/action')
      expect(call).toBeDefined()
      const body = JSON.parse(call![1].body as string)
      expect(body).toMatchObject({
        gameId: 'game-1',
        forCycle: 17,
        clientSeq: 1,
      })
    })

    it('a rejected "late" ack calls markOrderRejected and surfaces a warning announcement', async () => {
      const { useGameStore } = await import('../../../app/stores/game')
      const store = useGameStore()
      store.cycle = 9
      const commitSpy = vi.spyOn(store, 'markOrderCommitted')
      const rejectSpy = vi.spyOn(store, 'markOrderRejected')
      const toastSpy = vi.spyOn(store, 'addAnnouncement')

      fetchMock.mockImplementation((url: string) => {
        if (url === '/api/game/action') {
          return Promise.resolve({
            ok: true,
            json: async () => ({ accepted: false, reason: 'late', cycle: 9 }),
          })
        }
        return Promise.resolve({ ok: true, json: async () => ({}) })
      })

      const { connect, send } = useGameChannel()
      connect('game-1', 'player-1')
      MockRealtime.last!.connection._setState('connected')

      send({ type: 'action', command: { type: 'move', zone: 'coldstore' } })

      await vi.waitFor(() => {
        expect(rejectSpy).toHaveBeenCalled()
      })

      expect(commitSpy).not.toHaveBeenCalled()
      expect(toastSpy).toHaveBeenCalledWith(
        expect.stringContaining('after the batch committed'),
        'warning',
      )
    })

    it('returns false when there is no active game to send to', () => {
      const { send } = useGameChannel()
      expect(send({ type: 'action', command: { type: 'move', zone: 'coldstore' } })).toBe(false)
    })
  })

  describe('disconnect', () => {
    it('sets connected to false and closes the Ably client', () => {
      const { connect, disconnect, connected } = useGameChannel()
      connect('game-1', 'player-1')
      MockRealtime.last!.connection._setState('connected')
      expect(connected.value).toBe(true)

      const client = MockRealtime.last!
      disconnect()

      expect(connected.value).toBe(false)
      expect(client.close).toHaveBeenCalled()
    })
  })
})
