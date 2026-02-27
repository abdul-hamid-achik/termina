<script setup lang="ts">
import { onUnmounted, watch } from 'vue'
import { useAuthStore } from '~/stores/auth'
import { useLobbyStore } from '~/stores/lobby'
import { useGameStore } from '~/stores/game'
import { useGameSocket } from '~/composables/useGameSocket'
import type { ServerMessage } from '~~/shared/types/protocol'

const authStore = useAuthStore()
const lobbyStore = useLobbyStore()
const gameStore = useGameStore()
const router = useRouter()

const { connect, onMessage, disconnect, send, connected } = useGameSocket()

let removeHandler: (() => void) | null = null

function handleServerMessage(msg: ServerMessage) {
  switch (msg.type) {
    case 'queue_update':
      lobbyStore.playersInQueue = msg.playersInQueue
      lobbyStore.estimatedWaitSeconds = msg.estimatedWaitSeconds
      break
    case 'announcement':
      break
    case 'hero_pick':
      lobbyStore.heroPicked(msg.playerId, msg.heroId)
      break
    case 'lobby_state':
      lobbyStore.lobbyId = msg.lobbyId
      lobbyStore.setTeamInfo(
        msg.team,
        msg.players.map((p) => ({ playerId: p.playerId, name: p.playerId, heroId: p.heroId })),
      )
      lobbyStore.matchFound(msg.lobbyId)
      break
    case 'game_starting':
      gameStore.gameId = msg.gameId
      lobbyStore.allPicksComplete()
      send({ type: 'join_game', gameId: msg.gameId })
      break
  }
}

async function handleJoinQueue() {
  await lobbyStore.joinQueue()
  // Connect WebSocket for live updates
  if (authStore.user?.id) {
    connect('lobby', authStore.user.id)
    removeHandler = onMessage(handleServerMessage)
  }
}

async function handleLeaveQueue() {
  await lobbyStore.leaveQueue()
  disconnect()
  if (removeHandler) {
    removeHandler()
    removeHandler = null
  }
}

function handleHeroPick(heroId: string) {
  if (!lobbyStore.lobbyId) return
  send({ type: 'hero_pick', lobbyId: lobbyStore.lobbyId, heroId })
  if (authStore.user?.id) {
    lobbyStore.heroPicked(authStore.user.id, heroId)
  }
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Navigate to /play when game is starting
watch(
  () => lobbyStore.queueStatus,
  (status) => {
    if (status === 'starting') {
      setTimeout(() => {
        router.push('/play')
      }, 2000)
    }
  },
)

onUnmounted(() => {
  if (removeHandler) {
    removeHandler()
    removeHandler = null
  }
})
</script>

<template>
  <div class="mx-auto mt-10 max-w-[500px]">
    <!-- IDLE: Find Match -->
    <template v-if="lobbyStore.queueStatus === 'idle'">
      <TerminalPanel title="Matchmaking">
        <div class="flex flex-col items-center gap-4 p-6">
          <p class="text-base text-text-primary">&gt;_ ready to queue</p>
          <p class="text-[0.8rem] text-text-dim">Find a match (5v5 — Radiant vs Dire)</p>
          <AsciiButton label="FIND MATCH" variant="primary" @click="handleJoinQueue" />
        </div>
      </TerminalPanel>
    </template>

    <!-- SEARCHING: Queue with live stats -->
    <template v-else-if="lobbyStore.queueStatus === 'searching'">
      <MatchQueue
        :players-in-queue="lobbyStore.playersInQueue"
        :estimated-wait-seconds="lobbyStore.estimatedWaitSeconds"
        @cancel="handleLeaveQueue"
      />
    </template>

    <!-- FOUND: Match found transition -->
    <template v-else-if="lobbyStore.queueStatus === 'found'">
      <TerminalPanel title="Matchmaking">
        <div class="flex flex-col items-center gap-4 p-6">
          <p class="text-base font-bold text-radiant text-glow">&gt;_ MATCH FOUND</p>
          <p class="text-[0.8rem] text-text-dim">Preparing hero selection...</p>
        </div>
      </TerminalPanel>
    </template>

    <!-- PICKING: Hero selection -->
    <template v-else-if="lobbyStore.queueStatus === 'picking'">
      <HeroPicker
        :team="lobbyStore.team ?? 'radiant'"
        :picked-heroes="lobbyStore.pickedHeroes"
        :team-roster="lobbyStore.teamRoster"
        @pick="handleHeroPick"
      />
    </template>

    <!-- STARTING: Game launching -->
    <template v-else-if="lobbyStore.queueStatus === 'starting'">
      <TerminalPanel title="Game Starting">
        <div class="flex flex-col items-center gap-4 p-6">
          <p class="text-base font-bold text-radiant text-glow">&gt;_ GAME STARTING</p>
          <p class="text-[0.8rem] text-text-dim">Loading into match...</p>
          <span class="animate-blink text-2xl text-radiant">|</span>
        </div>
      </TerminalPanel>
    </template>
  </div>
</template>
