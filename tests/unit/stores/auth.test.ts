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
import { useAuthStore } from '../../../app/stores/auth'

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

  describe('logout', () => {
    it('clears session and navigates to home', async () => {
      mockClearSession.mockResolvedValue(undefined)
      const store = useAuthStore()

      await store.logout()

      expect(mockClearSession).toHaveBeenCalled()
      expect(mockNavigateTo).toHaveBeenCalledWith('/')
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
})
