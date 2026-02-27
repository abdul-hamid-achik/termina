<script setup lang="ts">
import { onMounted } from 'vue'
import { useAuthStore } from '~/stores/auth'
import { useGameStore } from '~/stores/game'

definePageMeta({ layout: 'game' })

onMounted(() => {
  const authStore = useAuthStore()
  const gameStore = useGameStore()
  if (!authStore.isAuthenticated) navigateTo('/login')
  else if (!gameStore.gameId) navigateTo('/lobby')
})
</script>

<template>
  <GameScreen />
</template>
