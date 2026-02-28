import { defineStore } from 'pinia'

export const useAuthStore = defineStore('auth', () => {
  const { loggedIn, user, fetch: fetchSession, clear: clearSession } = useUserSession()

  const isAuthenticated = loggedIn

  async function fetchUser() {
    await fetchSession()
  }

  function loginOAuth(provider: 'github' | 'discord' = 'github') {
    navigateTo(`/api/auth/${provider}`, { external: true })
  }

  // Keep backward compat
  const login = loginOAuth

  async function loginWithCredentials(username: string, password: string) {
    const res = await $fetch('/api/auth/login', {
      method: 'POST',
      body: { username, password },
    })
    await fetchSession()
    return res
  }

  async function register(username: string, password: string) {
    const res = await $fetch('/api/auth/register', {
      method: 'POST',
      body: { username, password },
    })
    await fetchSession()
    return res
  }

  async function logout() {
    await clearSession()
    navigateTo('/')
  }

  return {
    user,
    isAuthenticated,
    fetchUser,
    login,
    loginOAuth,
    loginWithCredentials,
    register,
    logout,
  }
})
