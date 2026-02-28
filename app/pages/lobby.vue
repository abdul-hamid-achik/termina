<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
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

const { connect, connected, onMessage, disconnect, send } = useGameSocket()

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
      // Sync any already-picked heroes (covers reconnect where picks happened before we joined)
      for (const p of msg.players) {
        if (p.heroId) {
          lobbyStore.heroPicked(p.playerId, p.heroId)
        }
      }
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

let joining = false

async function handleJoinQueue() {
  if (joining) return
  joining = true
  lobbyLog.info('Joining queue')
  try {
    await lobbyStore.joinQueue()
  } finally {
    joining = false
  }
}

async function handleLeaveQueue() {
  lobbyLog.info('Leaving queue')
  await lobbyStore.leaveQueue()
}

async function handleHeroPick(heroId: string) {
  if (!lobbyStore.lobbyId) return

  // Optimistically update local state
  if (authStore.user?.id) {
    lobbyStore.heroPicked(authStore.user.id, heroId)
  }

  if (connected.value) {
    send({ type: 'hero_pick', lobbyId: lobbyStore.lobbyId, heroId })
  } else {
    // HTTP fallback when WebSocket isn't connected
    try {
      await $fetch('/api/queue/pick', {
        method: 'POST',
        body: { lobbyId: lobbyStore.lobbyId, heroId },
      })
    } catch (err) {
      lobbyLog.error('HTTP hero pick failed', err)
    }
  }
}

// Connect WS eagerly on mount — always ready for server pushes.
// Recovery (page refresh) runs after the connection is established.
onMounted(async () => {
  if (!authStore.user?.id) return

  lobbyLog.info('Opening lobby WebSocket', { playerId: authStore.user.id })
  connect('lobby', authStore.user.id)
  removeHandler = onMessage(handleServerMessage)

  // Wait for connection before attempting recovery
  if (!connected.value) {
    await new Promise<void>((resolve) => {
      const stop = watch(connected, (val) => {
        if (val) {
          stop()
          resolve()
        }
      })
      setTimeout(() => {
        stop()
        resolve()
      }, 3000)
    })
  }

  // Recover state if we landed on /lobby after a page refresh
  if (lobbyStore.queueStatus === 'idle') {
    const recovered = await lobbyStore.recoverState()
    if (recovered) {
      lobbyLog.info('Recovered lobby state on mount', { status: recovered })
    }
  }
})

// Navigate to /play when game ID is set via WS game_starting
watch(
  () => gameStore.gameId,
  (gId) => {
    if (gId) {
      lobbyLog.info('Navigating to /play', { gameId: gId })
      if (!gameStore.playerId) gameStore.playerId = authStore.user?.id ?? null

      // Stop the recovery poll — we're navigating
      _stopRecoveryPoll()

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

// Polling fallback: when WS isn't connected or when stuck in 'starting',
// poll the status endpoint to drive state transitions via HTTP.
// This makes the game playable even if the WebSocket proxy chain fails.
let recoveryPollTimer: ReturnType<typeof setInterval> | null = null

// Start polling when WS fails to connect or when stuck in 'starting'
watch(
  [connected, () => lobbyStore.queueStatus],
  ([wsConnected, status]) => {
    if (gameStore.gameId) {
      _stopRecoveryPoll()
      return
    }
    // Poll when WS is not connected and we're in an active queue state
    const needsPoll =
      (!wsConnected && status !== 'idle') ||
      (status === 'starting' && lobbyStore.countdown <= 0)
    if (needsPoll) {
      _startRecoveryPoll()
    } else if (wsConnected && status !== 'starting') {
      _stopRecoveryPoll()
    }
  },
  { immediate: true },
)

function _startRecoveryPoll() {
  if (recoveryPollTimer) return
  lobbyLog.info('Starting recovery poll', { connected: connected.value, status: lobbyStore.queueStatus })
  recoveryPollTimer = setInterval(async () => {
    if (gameStore.gameId) {
      _stopRecoveryPoll()
      return
    }
    await lobbyStore.recoverState()
  }, 3000)
}

function _stopRecoveryPoll() {
  if (recoveryPollTimer) {
    clearInterval(recoveryPollTimer)
    recoveryPollTimer = null
  }
}

onUnmounted(() => {
  _stopRecoveryPoll()
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
