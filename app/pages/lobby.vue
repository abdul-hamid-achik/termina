<script setup lang="ts">
import { onUnmounted, watch } from 'vue'
import { useAuthStore } from '~/stores/auth'
import { useLobbyStore } from '~/stores/lobby'
import { useGameStore } from '~/stores/game'
import { useGameSocket } from '~/composables/useGameSocket'
import { lobbyLog } from '~/utils/logger'
import type { ServerMessage } from '~~/shared/types/protocol'

definePageMeta({ middleware: 'auth', ssr: false })

const authStore = useAuthStore()
const lobbyStore = useLobbyStore()
const gameStore = useGameStore()
const router = useRouter()

const { connect, onMessage, disconnect, send } = useGameSocket()

let removeHandler: (() => void) | null = null

function handleServerMessage(msg: ServerMessage) {
  lobbyLog.debug('WS message received', { type: msg.type })
  switch (msg.type) {
    case 'queue_update':
      lobbyStore.playersInQueue = msg.playersInQueue
      lobbyStore.estimatedWaitSeconds = msg.estimatedWaitSeconds
      break
    case 'announcement':
      break
    case 'error':
      lobbyLog.warn('Server error during lobby', { code: msg.code, message: msg.message })
      break
    case 'hero_pick':
      lobbyLog.debug('Hero pick received', { playerId: msg.playerId, heroId: msg.heroId })
      lobbyStore.heroPicked(msg.playerId, msg.heroId)
      break
    case 'lobby_state':
      lobbyLog.info('Lobby state received', { lobbyId: msg.lobbyId, team: msg.team })
      lobbyStore.lobbyId = msg.lobbyId
      lobbyStore.setTeamInfo(
        msg.team,
        msg.players.map((p) => ({
          playerId: p.playerId,
          name: p.playerId,
          heroId: p.heroId,
          team: p.team,
        })),
      )
      lobbyStore.matchFound(msg.lobbyId)
      break
    case 'game_countdown':
      lobbyLog.info('Game countdown received', { seconds: msg.seconds })
      lobbyStore.allPicksComplete()
      lobbyStore.startCountdown(msg.seconds)
      break
    case 'game_starting':
      lobbyLog.info('Game starting', { gameId: msg.gameId })
      gameStore.gameId = msg.gameId
      gameStore.playerId = authStore.user?.id ?? null
      break
  }
}

async function handleJoinQueue() {
  lobbyLog.info('Joining queue')
  await lobbyStore.joinQueue()

  // Do an immediate poll — if bots filled the queue instantly,
  // we may already have a game and don't need the lobby WS at all.
  await lobbyStore.pollQueueStatus()

  // Only open the lobby WS if we're still waiting (not already game_starting)
  if (!gameStore.gameId && !lobbyStore.gameId && authStore.user?.id) {
    lobbyLog.info('Opening lobby WebSocket', { playerId: authStore.user.id })
    connect('lobby', authStore.user.id)
    removeHandler = onMessage(handleServerMessage)
  }
}

async function handleLeaveQueue() {
  lobbyLog.info('Leaving queue')
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

// Navigate to /play when game ID is set (via WS game_starting or poll fallback)
watch(
  [() => gameStore.gameId, () => lobbyStore.gameId],
  () => {
    const gId = gameStore.gameId || lobbyStore.gameId
    if (gId) {
      lobbyLog.info('Navigating to /play', { gameId: gId })
      // Ensure gameStore has the ID for the play page
      if (!gameStore.gameId) gameStore.gameId = gId
      if (!gameStore.playerId) gameStore.playerId = authStore.user?.id ?? null

      // Disconnect the lobby WebSocket — GameScreen will open a new game connection
      disconnect()
      if (removeHandler) {
        removeHandler()
        removeHandler = null
      }
      router.push('/play')
    }
  },
)

onUnmounted(() => {
  disconnect()
  lobbyStore.$dispose()
  if (removeHandler) {
    removeHandler()
    removeHandler = null
  }
})
</script>

<template>
  <div class="flex flex-1 flex-col">
    <!-- PICKING: Hero selection (full-width layout) -->
    <HeroPicker
      v-if="lobbyStore.queueStatus === 'picking'"
      :team="lobbyStore.team ?? 'radiant'"
      :picked-heroes="lobbyStore.pickedHeroes"
      :team-roster="lobbyStore.teamRoster"
      @pick="handleHeroPick"
    />

    <!-- All other states: centered narrow layout -->
    <div
      v-else
      class="mx-auto flex flex-1 max-w-[500px] flex-col items-center justify-center"
    >
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

      <!-- STARTING: Game countdown -->
      <template v-else-if="lobbyStore.queueStatus === 'starting'">
        <TerminalPanel title="Game Starting">
          <div class="flex flex-col items-center gap-4 p-6">
            <p class="text-base font-bold text-radiant text-glow">&gt;_ GAME STARTING</p>
            <span
              v-if="lobbyStore.countdown > 0"
              class="text-4xl font-bold tabular-nums text-radiant"
              :class="{ 'animate-blink text-dire': lobbyStore.countdown <= 3 }"
            >
              {{ lobbyStore.countdown }}
            </span>
            <p class="text-[0.8rem] text-text-dim">
              {{ lobbyStore.countdown > 0 ? 'Preparing match...' : 'Loading into match...' }}
            </p>
            <span class="animate-blink text-2xl text-radiant">|</span>
          </div>
        </TerminalPanel>
      </template>
    </div>
  </div>
</template>
