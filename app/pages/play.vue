<script setup lang="ts">
import { onMounted } from 'vue'
import { useGameStore } from '~/stores/game'

definePageMeta({ layout: 'game', ssr: false, middleware: 'auth' })

const gameStore = useGameStore()
const route = useRoute()

onMounted(() => {
  // Harness entry: the BDD/e2e harness seeds a game via /api/test/new-game and
  // opens /play?gameId=…&playerId=…&dev=1 (no lobby). Gate on the explicit `dev=1`
  // marker, NOT `import.meta.dev` — e2e now runs against a PRODUCTION preview build
  // where `import.meta.dev` is false, which left this block dead and forced /play
  // to depend on the async WS-join populating the store before the redirect check
  // (a race that redirected to /lobby under load). Reading the query is safe: the
  // WS `join_game` still validates server-side that this player belongs to the game.
  // `tutorial=1` is the production tutorial's equivalent of the harness `dev=1`
  // marker: both seed a game outside the lobby and pass the ids via the query
  // (the WS `join_game` still validates the player belongs to the game).
  if (
    (route.query.dev === '1' || route.query.tutorial === '1') &&
    typeof route.query.gameId === 'string'
  ) {
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
