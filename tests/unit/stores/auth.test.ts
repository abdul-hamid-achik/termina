import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'

// ── Mocks ─────────────────────────────────────────────────────────

const mockFetch = vi.fn()
vi.stubGlobal('$fetch', mockFetch)

const mockNavigateTo = vi.fn()
vi.stubGlobal('navigateTo', mockNavigateTo)

const mockLoggedIn = ref(false)
const mockUser = ref<Record<string, unknown> | null>(null)
const mockFetchSession = vi.fn()
const mockClearSession = vi.fn()

vi.stubGlobal('useUserSession', () => ({
  loggedIn: mockLoggedIn,
  user: mockUser,
  fetch: mockFetchSession,
  clear: mockClearSession,
}))

// eslint-disable-next-line import/first
import { useAuthStore } from '~~/app/stores/auth'
// eslint-disable-next-line import/first
import { useGameStore } from '~~/app/stores/game'

// ── Tests ─────────────────────────────────────────────────────────

describe('Auth Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockFetch.mockReset()
    mockNavigateTo.mockReset()
    mockFetchSession.mockReset()
    mockClearSession.mockReset()
    mockLoggedIn.value = false
    mockUser.value = null
  })

  describe('initial state', () => {
    it('has null user and loggedIn false', () => {
      const store = useAuthStore()

      expect(store.user).toBeNull()
      expect(store.isAuthenticated).toBe(false)
    })
  })

  describe('loginWithCredentials', () => {
    it('calls $fetch with correct endpoint and refreshes session', async () => {
      mockFetch.mockResolvedValue({ success: true })
      mockFetchSession.mockResolvedValue(undefined)
      const store = useAuthStore()

      const result = await store.loginWithCredentials('testuser', 'password123')

      expect(mockFetch).toHaveBeenCalledWith('/api/auth/login', {
        method: 'POST',
        body: { username: 'testuser', password: 'password123' },
      })
      expect(mockFetchSession).toHaveBeenCalled()
      expect(result).toEqual({ success: true })
    })

    it('throws on 401 failure', async () => {
      mockFetch.mockRejectedValue({ statusCode: 401, message: 'Invalid credentials' })
      const store = useAuthStore()

      await expect(store.loginWithCredentials('wrong', 'bad')).rejects.toMatchObject({
        statusCode: 401,
      })
    })
  })

  describe('register', () => {
    it('calls $fetch with correct endpoint and refreshes session', async () => {
      mockFetch.mockResolvedValue({ success: true, userId: 'u1' })
      mockFetchSession.mockResolvedValue(undefined)
      const store = useAuthStore()

      const result = await store.register('newuser', 'password123')

      expect(mockFetch).toHaveBeenCalledWith('/api/auth/register', {
        method: 'POST',
        body: { username: 'newuser', password: 'password123' },
      })
      expect(mockFetchSession).toHaveBeenCalled()
      expect(result).toEqual({ success: true, userId: 'u1' })
    })

    it('throws on 409 duplicate username', async () => {
      mockFetch.mockRejectedValue({ statusCode: 409, message: 'Username already taken' })
      const store = useAuthStore()

      await expect(store.register('taken', 'pass')).rejects.toMatchObject({
        statusCode: 409,
      })
    })
  })

  describe('a guest who signs in or registers', () => {
    const guest = { id: 'guest_a1b2c3d4e5f6', username: 'GUEST-A1B2', guest: true }
    const real = { id: 'local_9f2c1e', username: 'newplayer' }

    /** The session as the SERVER now reports it after the POST (cookie replaced). */
    function serverReplacesSession() {
      mockFetchSession.mockImplementation(async () => {
        mockUser.value = real
        mockLoggedIn.value = true
      })
    }

    it('register: the nav-facing user is the registered one right after the POST, not the cached guest', async () => {
      mockUser.value = guest
      mockLoggedIn.value = true
      mockFetch.mockResolvedValue({ user: real })
      serverReplacesSession()
      const store = useAuthStore()

      await store.register('newplayer', 'longenough1')

      expect(mockFetchSession).toHaveBeenCalledTimes(1)
      expect(store.user).toEqual(real)
      expect((store.user as { guest?: boolean }).guest).toBeUndefined()
    })

    it('register: the guest id the game store was keyed by is dropped (it is a different player now)', async () => {
      mockUser.value = guest
      mockFetch.mockResolvedValue({ user: real })
      serverReplacesSession()
      const game = useGameStore()
      game.gameId = 'prac_1'
      game.playerId = guest.id

      await useAuthStore().register('newplayer', 'longenough1')

      expect(game.gameId).toBeNull()
      expect(game.playerId).toBeNull()
    })

    it('login: same — the guest state does not leak into the signed-in player', async () => {
      mockUser.value = guest
      mockFetch.mockResolvedValue({ user: real })
      serverReplacesSession()
      const game = useGameStore()
      game.gameId = 'prac_1'
      game.playerId = guest.id

      await useAuthStore().loginWithCredentials('newplayer', 'longenough1')

      expect(game.gameId).toBeNull()
      expect(game.playerId).toBeNull()
    })

    it('a REAL user logging in keeps their game state (only a guest switch resets it)', async () => {
      mockUser.value = real
      mockFetch.mockResolvedValue({ user: real })
      mockFetchSession.mockResolvedValue(undefined)
      const game = useGameStore()
      game.gameId = 'g1'
      game.playerId = real.id

      await useAuthStore().loginWithCredentials('newplayer', 'longenough1')

      expect(game.gameId).toBe('g1')
      expect(game.playerId).toBe(real.id)
    })

    it('a failed register leaves the guest (and their game) untouched', async () => {
      mockUser.value = guest
      mockFetch.mockRejectedValue({ statusCode: 409, message: 'Username already taken' })
      const game = useGameStore()
      game.gameId = 'prac_1'
      game.playerId = guest.id

      await expect(useAuthStore().register('taken', 'longenough1')).rejects.toBeDefined()

      expect(mockFetchSession).not.toHaveBeenCalled()
      expect(game.gameId).toBe('prac_1')
    })
  })

  describe('logout', () => {
    it('clears session and navigates to home', async () => {
      mockClearSession.mockResolvedValue(undefined)
      const store = useAuthStore()

      await store.logout()

      expect(mockClearSession).toHaveBeenCalled()
      expect(mockNavigateTo).toHaveBeenCalledWith('/')
    })

    it('resets the game store so prior-session state cannot leak on a shared tab', async () => {
      mockClearSession.mockResolvedValue(undefined)
      const game = useGameStore()
      game.gameId = 'g1'
      game.playerId = 'p1'

      await useAuthStore().logout()

      expect(game.gameId).toBeNull()
      expect(game.playerId).toBeNull()
    })
  })

  describe('loginOAuth', () => {
    it('navigates to OAuth endpoint', () => {
      const store = useAuthStore()

      store.loginOAuth('github')

      expect(mockNavigateTo).toHaveBeenCalledWith('/api/auth/github', { external: true })
    })

    it('defaults to github provider', () => {
      const store = useAuthStore()

      store.loginOAuth()

      expect(mockNavigateTo).toHaveBeenCalledWith('/api/auth/github', { external: true })
    })
  })

  // Playtest 3: the cookie changes under a tab (a guest signs in elsewhere).
  describe('refreshIdentity', () => {
    it('re-reads the session and re-keys a stale game to the current player', async () => {
      mockUser.value = { id: 'guest_old', guest: true }
      mockFetchSession.mockImplementation(async () => {
        mockUser.value = { id: 'github_7' }
      })
      const game = useGameStore()
      game.gameId = 'g_dead'
      game.playerId = 'guest_old'

      const id = await useAuthStore().refreshIdentity()

      expect(mockFetchSession).toHaveBeenCalledOnce()
      expect(id).toBe('github_7')
      expect(game.gameId).toBeNull()
      expect(game.playerId).toBe('github_7')
    })

    it('leaves the same player’s live game alone', async () => {
      mockUser.value = { id: 'github_7' }
      const game = useGameStore()
      game.gameId = 'g_live'
      game.playerId = 'github_7'

      await useAuthStore().refreshIdentity()

      expect(game.gameId).toBe('g_live')
    })

    it('`fresh` drops the game even for the same player (a new one is coming)', async () => {
      mockUser.value = { id: 'github_7' }
      const game = useGameStore()
      game.gameId = 'g_old'
      game.playerId = 'github_7'

      await useAuthStore().refreshIdentity({ fresh: true, refetch: false })

      expect(mockFetchSession).not.toHaveBeenCalled()
      expect(game.gameId).toBeNull()
      expect(game.playerId).toBe('github_7')
    })
  })
})
