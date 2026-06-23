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

  async function register(username: string, password: string, email?: string) {
    const res = await $fetch('/api/auth/register', {
      method: 'POST',
      body: { username, password, email: email || undefined },
    })
    await fetchSession()
    return res
  }

  /** Request a password-reset email. Always resolves (no account enumeration). */
  async function forgotPassword(username: string) {
    return $fetch('/api/auth/forgot-password', { method: 'POST', body: { username } })
  }

  /** Complete a password reset with the token from the email link. */
  async function resetPassword(token: string, password: string) {
    return $fetch('/api/auth/reset-password', { method: 'POST', body: { token, password } })
  }

  /** Confirm an email address with the token from the verification link. */
  async function verifyEmail(token: string) {
    return $fetch('/api/auth/verify-email', { method: 'POST', body: { token } })
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
    forgotPassword,
    resetPassword,
    verifyEmail,
    logout,
  }
})
