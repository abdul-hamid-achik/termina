<script setup lang="ts">
import { onMounted } from 'vue'
import { useGameStore } from '~/stores/game'

definePageMeta({ layout: 'game', ssr: false, middleware: 'auth' })

const gameStore = useGameStore()

onMounted(() => {
  if (!gameStore.gameId || !gameStore.playerId) navigateTo('/lobby')
})
</script>

<template>
  <GameScreen v-if="gameStore.gameId && gameStore.playerId" />
  <div v-else class="flex h-screen items-center justify-center bg-bg-primary">
    <p class="font-mono text-text-dim">&gt;_ connecting to game server...</p>
  </div>
</template>
