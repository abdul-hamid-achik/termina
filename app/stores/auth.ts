import { defineStore } from 'pinia'

export const useAuthStore = defineStore('auth', () => {
  const { loggedIn, user, fetch: fetchSession, clear: clearSession } = useUserSession()

  const isAuthenticated = loggedIn

  async function fetchUser() {
    await fetchSession()
  }

  function login(provider: 'github' | 'discord' = 'github') {
    navigateTo(`/api/auth/${provider}`, { external: true })
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
    logout,
  }
})
