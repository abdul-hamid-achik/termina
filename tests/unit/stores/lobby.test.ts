import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useLobbyStore } from '../../../app/stores/lobby'

// ── Mocks ─────────────────────────────────────────────────────────

// Mock $fetch globally for Nuxt's auto-imported fetch
const mockFetch = vi.fn()
vi.stubGlobal('$fetch', mockFetch)

// ── Tests ─────────────────────────────────────────────────────────

describe('Lobby Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    mockFetch.mockReset()
  })

  afterEach(() => {
    const store = useLobbyStore()
    store.$dispose()
    vi.useRealTimers()
  })

  describe('initial state', () => {
    it('has correct defaults', () => {
      const store = useLobbyStore()

      expect(store.queueStatus).toBe('idle')
      expect(store.queueTime).toBe(0)
      expect(store.playersInQueue).toBe(0)
      expect(store.estimatedWaitSeconds).toBe(0)
      expect(store.lobbyId).toBeNull()
      expect(store.gameId).toBeNull()
      expect(store.team).toBeNull()
      expect(store.pickedHeroes).toEqual({})
      expect(store.teamRoster).toEqual([])
      expect(store.countdown).toBe(0)
    })
  })

  describe('joinQueue', () => {
    it('sets status to searching on success', async () => {
      mockFetch.mockResolvedValue({ success: true, queueSize: 3 })
      const store = useLobbyStore()

      await store.joinQueue()

      expect(store.queueStatus).toBe('searching')
      expect(store.playersInQueue).toBe(3)
      expect(store.queueTime).toBe(0)
    })

    it('calls correct API endpoint with mode', async () => {
      mockFetch.mockResolvedValue({ success: true, queueSize: 1 })
      const store = useLobbyStore()

      await store.joinQueue('quick_3v3')

      expect(mockFetch).toHaveBeenCalledWith('/api/queue/join', {
        method: 'POST',
        body: { mode: 'quick_3v3' },
      })
    })

    it('defaults to ranked_5v5 mode', async () => {
      mockFetch.mockResolvedValue({ success: true, queueSize: 1 })
      const store = useLobbyStore()

      await store.joinQueue()

      expect(mockFetch).toHaveBeenCalledWith('/api/queue/join', {
        method: 'POST',
        body: { mode: 'ranked_5v5' },
      })
    })

    it('throws on API failure', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))
      const store = useLobbyStore()

      await expect(store.joinQueue()).rejects.toThrow('Network error')
    })

    it('sets lastError with the failure reason and stays idle', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))
      const store = useLobbyStore()

      await expect(store.joinQueue()).rejects.toThrow()

      expect(store.lastError).toBe('could not join queue — Network error')
      expect(store.queueStatus).toBe('idle')
    })

    it('extracts the server message from $fetch error data', async () => {
      mockFetch.mockRejectedValue(
        Object.assign(new Error('500 Internal'), {
          data: { message: 'Already in queue' },
        }),
      )
      const store = useLobbyStore()

      await expect(store.joinQueue()).rejects.toThrow()

      expect(store.lastError).toBe('could not join queue — Already in queue')
    })

    it('recovers into the active game (no dead-end error) on a 409', async () => {
      const store = useLobbyStore()
      // join is refused: the player is already in an active game
      mockFetch.mockRejectedValueOnce(
        Object.assign(new Error('Conflict'), {
          statusCode: 409,
          data: { message: 'Already in an active game' },
        }),
      )
      // the recovery status endpoint then reports that active game
      mockFetch.mockResolvedValueOnce({ status: 'game_starting', gameId: 'game-live' })

      // Should NOT throw — the 409 is turned into a rejoin, not an error
      await store.joinQueue()

      expect(store.gameId).toBe('game-live')
      expect(store.lastError).toBeNull()
    })

    it('still surfaces a non-409 error normally', async () => {
      const store = useLobbyStore()
      mockFetch.mockRejectedValue(
        Object.assign(new Error('boom'), { statusCode: 500, data: { message: 'server down' } }),
      )
      await expect(store.joinQueue()).rejects.toThrow()
      expect(store.lastError).toBe('could not join queue — server down')
    })

    it('clears lastError when retrying', async () => {
      const store = useLobbyStore()
      mockFetch.mockRejectedValue(new Error('boom'))
      await expect(store.joinQueue()).rejects.toThrow()
      expect(store.lastError).not.toBeNull()

      mockFetch.mockResolvedValue({ success: true, queueSize: 1 })
      await store.joinQueue()

      expect(store.lastError).toBeNull()
      expect(store.queueStatus).toBe('searching')
    })

    it('starts queue timer that increments queueTime', async () => {
      mockFetch.mockResolvedValue({ success: true, queueSize: 1 })
      const store = useLobbyStore()

      await store.joinQueue()
      expect(store.queueTime).toBe(0)

      vi.advanceTimersByTime(3000)
      expect(store.queueTime).toBe(3)
    })
  })

  describe('leaveQueue', () => {
    it('resets state after leaving', async () => {
      mockFetch.mockResolvedValue({ success: true, queueSize: 1 })
      const store = useLobbyStore()

      await store.joinQueue()
      store.matchFound('lobby-1')

      mockFetch.mockResolvedValue({})
      await store.leaveQueue()

      expect(store.queueStatus).toBe('idle')
      expect(store.queueTime).toBe(0)
      expect(store.lobbyId).toBeNull()
    })

    it('resets even if API call fails', async () => {
      mockFetch.mockResolvedValue({ success: true, queueSize: 1 })
      const store = useLobbyStore()
      await store.joinQueue()

      mockFetch.mockRejectedValue(new Error('fail'))
      await store.leaveQueue()

      expect(store.queueStatus).toBe('idle')
    })
  })

  describe('matchFound', () => {
    it('sets status to found and stores lobbyId', () => {
      const store = useLobbyStore()

      store.matchFound('lobby-123')

      expect(store.queueStatus).toBe('found')
      expect(store.lobbyId).toBe('lobby-123')
    })

    it('transitions to picking after 1500ms', () => {
      const store = useLobbyStore()

      store.matchFound('lobby-123')
      expect(store.queueStatus).toBe('found')

      vi.advanceTimersByTime(1500)
      expect(store.queueStatus).toBe('picking')
    })
  })

  describe('heroPicked', () => {
    it('stores hero pick by player', () => {
      const store = useLobbyStore()

      store.heroPicked('player-1', 'echo')

      expect(store.pickedHeroes).toEqual({ 'player-1': 'echo' })
    })

    it('updates team roster with hero', () => {
      const store = useLobbyStore()
      store.setTeamInfo('radiant', [
        { playerId: 'player-1', name: 'Player1', heroId: null, team: 'radiant' },
        { playerId: 'player-2', name: 'Player2', heroId: null, team: 'radiant' },
      ])

      store.heroPicked('player-1', 'daemon')

      const p1 = store.teamRoster.find((m) => m.playerId === 'player-1')
      expect(p1!.heroId).toBe('daemon')

      // Other players unchanged
      const p2 = store.teamRoster.find((m) => m.playerId === 'player-2')
      expect(p2!.heroId).toBeNull()
    })

    it('tracks multiple picks', () => {
      const store = useLobbyStore()

      store.heroPicked('p1', 'echo')
      store.heroPicked('p2', 'kernel')

      expect(store.pickedHeroes).toEqual({ p1: 'echo', p2: 'kernel' })
    })
  })

  describe('optimisticPick / rollbackPendingPick', () => {
    it('applies the pick locally and tracks it as pending', () => {
      const store = useLobbyStore()
      store.setTeamInfo('radiant', [{ playerId: 'me', name: 'Me', heroId: null, team: 'radiant' }])

      store.optimisticPick('me', 'echo')

      expect(store.pickedHeroes).toEqual({ me: 'echo' })
      expect(store.teamRoster[0]!.heroId).toBe('echo')
      expect(store.pendingPick).toEqual({ playerId: 'me', heroId: 'echo' })
    })

    it('rolls back a rejected optimistic pick', () => {
      const store = useLobbyStore()
      store.setTeamInfo('radiant', [{ playerId: 'me', name: 'Me', heroId: null, team: 'radiant' }])
      store.heroPicked('p2', 'kernel')
      store.optimisticPick('me', 'echo')

      store.rollbackPendingPick()

      expect(store.pickedHeroes).toEqual({ p2: 'kernel' }) // others untouched
      expect(store.teamRoster[0]!.heroId).toBeNull()
      expect(store.pendingPick).toBeNull()
    })

    it('server hero_pick broadcast confirms the pending pick', () => {
      const store = useLobbyStore()
      store.optimisticPick('me', 'echo')

      // Server echoes the pick back → no longer pending
      store.heroPicked('me', 'echo')
      expect(store.pendingPick).toBeNull()

      // A later unrelated error must NOT undo the confirmed pick
      store.rollbackPendingPick()
      expect(store.pickedHeroes).toEqual({ me: 'echo' })
    })

    it('rollback is a no-op when nothing is pending', () => {
      const store = useLobbyStore()
      store.heroPicked('p1', 'echo')

      store.rollbackPendingPick()

      expect(store.pickedHeroes).toEqual({ p1: 'echo' })
    })

    it('clears lastError when making a new pick attempt', () => {
      const store = useLobbyStore()
      store.setError('Not your turn to pick')

      store.optimisticPick('me', 'echo')

      expect(store.lastError).toBeNull()
    })
  })

  describe('setError / clearError', () => {
    it('stores and clears the error message', () => {
      const store = useLobbyStore()
      expect(store.lastError).toBeNull()

      store.setError('Hero already picked')
      expect(store.lastError).toBe('Hero already picked')

      store.clearError()
      expect(store.lastError).toBeNull()
    })

    it('is reset on leaveQueue', async () => {
      const store = useLobbyStore()
      store.setError('boom')
      store.optimisticPick('me', 'echo')

      mockFetch.mockResolvedValue({})
      await store.leaveQueue()

      expect(store.lastError).toBeNull()
      expect(store.pendingPick).toBeNull()
    })
  })

  describe('setAnnouncement', () => {
    it('stores the message + level and bumps a monotonic seq', () => {
      const store = useLobbyStore()
      expect(store.lastAnnouncement).toBeNull()

      store.setAnnouncement('Match cancelled. Returning to queue...', 'warning')
      expect(store.lastAnnouncement?.message).toBe('Match cancelled. Returning to queue...')
      expect(store.lastAnnouncement?.level).toBe('warning')
      expect(store.lastAnnouncement?.seq).toBe(1)

      // A repeated identical message still re-fires the toast (seq increments)
      store.setAnnouncement('Match cancelled. Returning to queue...', 'warning')
      expect(store.lastAnnouncement?.seq).toBe(2)
    })

    it('defaults the level to info', () => {
      const store = useLobbyStore()
      store.setAnnouncement('alice has been replaced by a bot.')
      expect(store.lastAnnouncement?.level).toBe('info')
    })

    it('is reset on leaveQueue', async () => {
      const store = useLobbyStore()
      store.setAnnouncement('boom', 'warning')

      mockFetch.mockResolvedValue({})
      await store.leaveQueue()

      expect(store.lastAnnouncement).toBeNull()
    })
  })

  describe('allPicksComplete', () => {
    it('sets status to starting', () => {
      const store = useLobbyStore()

      store.allPicksComplete()

      expect(store.queueStatus).toBe('starting')
    })
  })

  describe('setTeamInfo', () => {
    it('sets team and roster', () => {
      const store = useLobbyStore()

      const roster = [
        { playerId: 'p1', name: 'Player1', heroId: 'echo', team: 'radiant' as const },
        { playerId: 'p2', name: 'Player2', heroId: null, team: 'radiant' as const },
      ]

      store.setTeamInfo('radiant', roster)

      expect(store.team).toBe('radiant')
      expect(store.teamRoster).toEqual(roster)
    })
  })

  describe('startCountdown', () => {
    it('sets countdown and decrements every second', () => {
      const store = useLobbyStore()

      store.startCountdown(5)
      expect(store.countdown).toBe(5)

      vi.advanceTimersByTime(1000)
      expect(store.countdown).toBe(4)

      vi.advanceTimersByTime(2000)
      expect(store.countdown).toBe(2)

      vi.advanceTimersByTime(2000)
      expect(store.countdown).toBe(0)
    })

    it('does not go below 0', () => {
      const store = useLobbyStore()

      store.startCountdown(2)
      vi.advanceTimersByTime(5000)

      expect(store.countdown).toBe(0)
    })

    it('replaces previous countdown', () => {
      const store = useLobbyStore()

      store.startCountdown(10)
      vi.advanceTimersByTime(3000)
      expect(store.countdown).toBe(7)

      // Replace with new countdown
      store.startCountdown(3)
      expect(store.countdown).toBe(3)

      vi.advanceTimersByTime(2000)
      expect(store.countdown).toBe(1)
    })
  })

  describe('recoverState', () => {
    it('resets a stuck pre-game store when the server reports idle (cancelled lobby)', async () => {
      const store = useLobbyStore()
      // Simulate being frozen on the draft screen after a missed cancel.
      store.matchFound('lobby-x') // → 'found'
      store.allPicksComplete?.()
      expect(store.queueStatus).not.toBe('idle')

      mockFetch.mockResolvedValue({ status: 'idle' })
      await store.recoverState()

      expect(store.queueStatus).toBe('idle')
      expect(store.lobbyId).toBeNull()
    })

    it('recovers searching state from server', async () => {
      const store = useLobbyStore()

      mockFetch.mockResolvedValue({
        status: 'searching',
        playersInQueue: 7,
        estimatedWaitSeconds: 30,
      })

      const result = await store.recoverState()

      expect(result).toBe('searching')
      expect(store.queueStatus).toBe('searching')
      expect(store.playersInQueue).toBe(7)
      expect(store.estimatedWaitSeconds).toBe(30)
    })

    it('recovers lobby state by calling matchFound', async () => {
      const store = useLobbyStore()

      mockFetch.mockResolvedValue({
        status: 'lobby',
        lobbyId: 'lobby-abc',
        team: 'dire',
        players: [{ playerId: 'p1', team: 'dire', heroId: null }],
        phase: 'picking',
      })

      const result = await store.recoverState()

      expect(result).toBe('lobby')
      expect(store.lobbyId).toBe('lobby-abc')
      expect(store.team).toBe('dire')
      expect(store.queueStatus).toBe('found')
    })

    it('uses usernames (not raw playerIds) for the recovered roster', async () => {
      const store = useLobbyStore()

      mockFetch.mockResolvedValue({
        status: 'lobby',
        lobbyId: 'lobby-abc',
        team: 'radiant',
        players: [
          { playerId: 'github_7379966', username: 'alice', team: 'radiant', heroId: null },
          // No username (e.g. a bot or pre-username record) → falls back to playerId
          { playerId: 'bot_1', team: 'radiant', heroId: null },
        ],
        phase: 'picking',
      })

      await store.recoverState()

      expect(store.teamRoster[0]!.name).toBe('alice')
      expect(store.teamRoster[0]!.name).not.toBe('github_7379966')
      expect(store.teamRoster[1]!.name).toBe('bot_1')
    })

    it('recovers game_starting state', async () => {
      const store = useLobbyStore()

      mockFetch.mockResolvedValue({
        status: 'game_starting',
        gameId: 'game-xyz',
      })

      const result = await store.recoverState()

      expect(result).toBe('game_starting')
      expect(store.gameId).toBe('game-xyz')
      expect(store.queueStatus).toBe('starting')
    })

    it('returns null on errors silently', async () => {
      const store = useLobbyStore()

      mockFetch.mockRejectedValue(new Error('Network error'))

      const result = await store.recoverState()

      expect(result).toBeNull()
      expect(store.queueStatus).toBe('idle')
    })
  })

  describe('$dispose', () => {
    it('stops all timers', async () => {
      mockFetch.mockResolvedValue({ success: true, queueSize: 1 })
      const store = useLobbyStore()

      await store.joinQueue()
      store.startCountdown(5)

      store.$dispose()

      const queueTimeBefore = store.queueTime
      const countdownBefore = store.countdown

      vi.advanceTimersByTime(5000)

      // Timers should be stopped - values should NOT change
      // Note: queueTime timer stopped but pinia may still hold old value
      expect(store.queueTime).toBe(queueTimeBefore)
      expect(store.countdown).toBe(countdownBefore)
    })
  })

  describe('queue roster', () => {
    it('has empty roster by default', () => {
      const store = useLobbyStore()
      expect(store.queueRoster).toEqual([])
    })

    it('can set roster array', () => {
      const store = useLobbyStore()
      store.queueRoster = [
        { username: 'player1', mmrBracket: 'gold' },
        { username: 'player2', mmrBracket: 'silver' },
      ]

      expect(store.queueRoster).toHaveLength(2)
      expect(store.queueRoster[0]!.username).toBe('player1')
      expect(store.queueRoster[1]!.mmrBracket).toBe('silver')
    })
  })

  describe('bot filling state', () => {
    it('has botsFilling false and botsCount 0 by default', () => {
      const store = useLobbyStore()
      expect(store.botsFilling).toBe(false)
      expect(store.botsCount).toBe(0)
    })

    it('can set botsFilling and botsCount', () => {
      const store = useLobbyStore()
      store.botsFilling = true
      store.botsCount = 3

      expect(store.botsFilling).toBe(true)
      expect(store.botsCount).toBe(3)
    })
  })

  describe('matchSize', () => {
    it('defaults to 10', () => {
      const store = useLobbyStore()
      expect(store.matchSize).toBe(10)
    })

    it('can be updated', () => {
      const store = useLobbyStore()
      store.matchSize = 6
      expect(store.matchSize).toBe(6)
    })
  })

  describe('_reset clears new queue state', () => {
    it('resets queueRoster, botsFilling, botsCount, matchSize on leaveQueue', async () => {
      mockFetch.mockResolvedValue({ success: true, queueSize: 1 })
      const store = useLobbyStore()

      await store.joinQueue()
      store.queueRoster = [{ username: 'p1', mmrBracket: 'gold' }]
      store.botsFilling = true
      store.botsCount = 3
      store.matchSize = 6

      mockFetch.mockResolvedValue({})
      await store.leaveQueue()

      expect(store.queueRoster).toEqual([])
      expect(store.botsFilling).toBe(false)
      expect(store.botsCount).toBe(0)
      expect(store.matchSize).toBe(10)
    })
  })

  describe('full queue lifecycle', () => {
    it('flows from idle → searching → found → picking → starting', async () => {
      mockFetch.mockResolvedValue({ success: true, queueSize: 2 })
      const store = useLobbyStore()

      expect(store.queueStatus).toBe('idle')

      // Join queue
      await store.joinQueue()
      expect(store.queueStatus).toBe('searching')

      // Match found
      store.matchFound('lobby-1')
      expect(store.queueStatus).toBe('found')

      // After 1500ms, transitions to picking
      vi.advanceTimersByTime(1500)
      expect(store.queueStatus).toBe('picking')

      // Set team info
      store.setTeamInfo('radiant', [{ playerId: 'p1', name: 'P1', heroId: null, team: 'radiant' }])
      expect(store.team).toBe('radiant')

      // Hero picked
      store.heroPicked('p1', 'echo')
      expect(store.pickedHeroes).toEqual({ p1: 'echo' })

      // All picks complete
      store.allPicksComplete()
      expect(store.queueStatus).toBe('starting')

      // Countdown
      store.startCountdown(5)
      vi.advanceTimersByTime(5000)
      expect(store.countdown).toBe(0)
    })
  })

  describe('recoverState (one-shot page-refresh recovery)', () => {
    it('returns null and changes nothing when the server reports idle', async () => {
      mockFetch.mockResolvedValue({ status: 'idle' })
      const store = useLobbyStore()
      const result = await store.recoverState()
      expect(result).toBeNull()
      expect(store.queueStatus).toBe('idle')
    })

    it('recovers a game_starting status into the starting countdown', async () => {
      mockFetch.mockResolvedValue({ status: 'game_starting', gameId: 'game_42' })
      const store = useLobbyStore()
      await store.recoverState()
      expect(store.gameId).toBe('game_42')
      expect(store.queueStatus).toBe('starting')
      expect(store.countdown).toBeGreaterThan(0)
    })

    it('recovers a lobby already in the starting phase (picks + countdown)', async () => {
      mockFetch.mockResolvedValue({
        status: 'lobby',
        lobbyId: 'lobby_1',
        team: 'radiant',
        players: [{ playerId: 'p1', team: 'radiant', heroId: 'echo' }],
        phase: 'starting',
      })
      const store = useLobbyStore()
      await store.recoverState()
      expect(store.queueStatus).toBe('starting')
      expect(store.pickedHeroes['p1']).toBe('echo')
    })

    it('recovers a lobby still picking via matchFound', async () => {
      mockFetch.mockResolvedValue({
        status: 'lobby',
        lobbyId: 'lobby_2',
        team: 'dire',
        players: [{ playerId: 'p2', team: 'dire', heroId: null }],
        phase: 'picking',
      })
      const store = useLobbyStore()
      await store.recoverState()
      expect(store.lobbyId).toBe('lobby_2')
      expect(store.queueStatus).toBe('found') // matchFound, pre-1500ms transition
    })

    it('does not bounce a drafting player back to found on a repeat recovery poll', async () => {
      mockFetch.mockResolvedValue({
        status: 'lobby',
        lobbyId: 'lobby_3',
        team: 'dire',
        players: [{ playerId: 'p2', team: 'dire', heroId: null }],
        phase: 'picking',
      })
      const store = useLobbyStore()
      store.queueStatus = 'picking' // already in the draft (past the found splash)

      await store.recoverState() // the 3s recovery poll fires again

      // matchFound is idempotent — the player stays drafting, not reset to found
      expect(store.queueStatus).toBe('picking')
      expect(store.lobbyId).toBe('lobby_3')
    })

    it('recovers a searching status back into the queue', async () => {
      mockFetch.mockResolvedValue({
        status: 'searching',
        playersInQueue: 4,
        estimatedWaitSeconds: 12,
      })
      const store = useLobbyStore()
      await store.recoverState()
      expect(store.queueStatus).toBe('searching')
      expect(store.playersInQueue).toBe(4)
      expect(store.estimatedWaitSeconds).toBe(12)
    })
  })
})
