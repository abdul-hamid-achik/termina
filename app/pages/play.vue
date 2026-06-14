<script setup lang="ts">
import { onMounted } from 'vue'
import { useGameStore } from '~/stores/game'

definePageMeta({ layout: 'game', ssr: false, middleware: 'auth' })

const gameStore = useGameStore()
const route = useRoute()

onMounted(() => {
  // Dev-only entry: the BDD/e2e harness seeds a game via /api/test/new-game and
  // opens /play?gameId=…&playerId=…&dev=1 (no lobby). `import.meta.dev` is false
  // in a production build, so this block is dead code in prod.
  if (import.meta.dev && typeof route.query.gameId === 'string') {
    gameStore.gameId = route.query.gameId
    if (typeof route.query.playerId === 'string') gameStore.playerId = route.query.playerId
  }
  if (!gameStore.gameId || !gameStore.playerId) navigateTo('/lobby')
})
</script>

<template>
  <GameScreen v-if="gameStore.gameId && gameStore.playerId" />
  <div v-else class="flex h-screen h-dvh items-center justify-center bg-bg-primary">
    <p class="font-mono text-text-dim">&gt;_ connecting to game server...</p>
  </div>
</template>
