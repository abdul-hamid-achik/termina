<script setup lang="ts">
import { onMounted } from 'vue'
import { useGameStore } from '~/stores/game'

definePageMeta({ layout: 'game', ssr: false, middleware: 'auth' })

const gameStore = useGameStore()
const route = useRoute()

onMounted(() => {
  // Tutorial entry: "Practice vs bots" seeds a game outside the lobby and opens
  // /play?gameId=…&playerId=…&tutorial=1, passing the ids via the query. Gate on
  // the explicit `tutorial=1` marker so /play can adopt those ids synchronously
  // instead of waiting on the async WS-join to populate the store before the
  // redirect check (a race that bounced to /lobby under load). Reading the query
  // is safe: the WS `join_game` still validates server-side that this player
  // belongs to the game.
  if (route.query.tutorial === '1' && typeof route.query.gameId === 'string') {
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
