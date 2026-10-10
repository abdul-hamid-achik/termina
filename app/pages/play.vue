<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useGameStore } from '~/stores/game'
import { adoptPlayRoute } from '~/utils/playRoute'

definePageMeta({ layout: 'game', ssr: false, middleware: 'auth' })

const gameStore = useGameStore()
const route = useRoute()
const { user } = useUserSession()

// Tutorial entry: "Practice vs bots" seeds a game outside the lobby and opens
// /play?gameId=…&playerId=…&tutorial=1. Gate on the explicit `tutorial=1`
// marker so /play can adopt those ids synchronously instead of waiting on the
// async join to populate the store before the redirect check (a race that
// bounced to /lobby under load). The server still checks the player belongs
// to the game.
//
// Re-read on every query change, not only on mount: [NEW PRACTICE] from the
// ended panel navigates /play → /play?gameId=<new>, which REUSES this page — an
// onMounted-only read kept the dead game's ids (playtest 3).
function adopt() {
  const ok = adoptPlayRoute(gameStore, route.query, user.value?.id)
  if (!ok) navigateTo('/lobby')
}

onMounted(adopt)
watch(() => route.query, adopt)

// One GameScreen per (game, player): a new pair unmounts the old screen (its
// channel disconnects) and mounts a fresh one that subscribes to the new
// player's channel. Without the key the screen kept its first subscription.
const screenKey = computed(() => `${gameStore.gameId}:${gameStore.playerId}`)
</script>

<template>
  <GameScreen v-if="gameStore.gameId && gameStore.playerId" :key="screenKey" />
  <div v-else class="flex h-screen h-dvh items-center justify-center bg-bg-primary">
    <p class="font-mono text-text-dim">&gt;_ opening a terminal on TERMINA...</p>
  </div>
</template>
