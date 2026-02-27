import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface User {
  id: string
  name: string
  avatar?: string
  mmr: number
  gamesPlayed: number
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const loading = ref(false)

  const isAuthenticated = computed(() => !!user.value)

  async function fetchUser() {
    loading.value = true
    try {
      const data = await $fetch<User>('/api/player/stats')
      user.value = data
    } catch {
      user.value = null
    } finally {
      loading.value = false
    }
  }

  function login(provider: 'github' | 'discord' = 'github') {
    navigateTo(`/api/auth/${provider}`, { external: true })
  }

  async function logout() {
    try {
      await $fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      /* ignore */
    }
    user.value = null
    navigateTo('/')
  }

  return {
    user,
    loading,
    isAuthenticated,
    fetchUser,
    login,
    logout,
  }
})
