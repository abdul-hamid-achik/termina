<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useAuthStore } from '~/stores/auth'
import { useLobbyStore } from '~/stores/lobby'
import { useGameStore } from '~/stores/game'
import { useGameSocket } from '~/composables/useGameSocket'
import { useAudio } from '~/composables/useAudio'
import { useStartTutorial } from '~/composables/useStartTutorial'
import { lobbyLog } from '~/utils/logger'
import { mapIdForMode, zonesForMap } from '~~/shared/constants/maps'
import type { ServerMessage } from '~~/shared/types/protocol'

definePageMeta({ middleware: 'auth', ssr: false })

const authStore = useAuthStore()
const lobbyStore = useLobbyStore()
const gameStore = useGameStore()
const router = useRouter()

const { connect, connected, onMessage, disconnect, send } = useGameSocket()
const { playSound } = useAudio()

let removeHandler: (() => void) | null = null

function handleServerMessage(msg: ServerMessage) {
  lobbyLog.debug('WS message received', { type: msg.type })
  switch (msg.type) {
    case 'queue_update':
      lobbyStore.playersInQueue = msg.playersInQueue
      lobbyStore.estimatedWaitSeconds = msg.estimatedWaitSeconds
      break
    case 'queue_roster':
      lobbyStore.queueRoster = msg.players
      lobbyStore.matchSize = msg.total
      break
    case 'queue_filling':
      lobbyStore.botsFilling = true
      lobbyStore.botsCount = msg.botsCount
      break
    case 'announcement':
      // Surface lobby/draft announcements (player→bot swap, etc.) as a transient
      // toast instead of dropping them silently.
      lobbyStore.setAnnouncement(msg.message, msg.level)
      break
    case 'lobby_cancelled':
      // The forming lobby was torn down — reset back to the find-match screen so
      // a surviving drafter isn't frozen on draft/found/starting, then surface
      // the reason as a toast (setAnnouncement AFTER reset, which clears it).
      lobbyStore.reset()
      lobbyStore.setAnnouncement(msg.reason, 'warning')
      break
    case 'error':
      lobbyLog.warn('Server error during lobby', { code: msg.code, message: msg.message })
      // Surface the error inline instead of dying in the console, and undo
      // any optimistic hero pick the server just rejected.
      lobbyStore.rollbackPendingPick()
      lobbyStore.setError(msg.message || msg.code)
      break
    case 'hero_pick':
      lobbyLog.debug('Hero pick received', { playerId: msg.playerId, heroId: msg.heroId })
      lobbyStore.heroPicked(msg.playerId, msg.heroId)
      break
    case 'hero_ban':
      lobbyLog.debug('Hero ban received', { playerId: msg.playerId, heroId: msg.heroId })
      lobbyStore.heroBanned(msg.heroId)
      break
    case 'pick_turn':
      lobbyLog.debug('Pick turn received', { playerId: msg.playerId })
      lobbyStore.setPickTurn(msg.playerId, msg.username, msg.timeRemainingMs)
      break
    case 'ban_turn':
      lobbyLog.debug('Ban turn received', { playerId: msg.playerId })
      lobbyStore.setBanTurn(msg.playerId, msg.username, msg.timeRemainingMs)
      break
    case 'lobby_state':
      lobbyLog.info('Lobby state received', { lobbyId: msg.lobbyId, team: msg.team })
      lobbyStore.lobbyId = msg.lobbyId
      lobbyStore.setTeamInfo(
        msg.team,
        msg.players.map((p) => ({
          playerId: p.playerId,
          name: p.username ?? p.playerId,
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
      // Sync bans + the draft phase (banning vs picking) on (re)connect.
      for (const b of msg.bans ?? []) {
        lobbyStore.heroBanned(b)
      }
      lobbyStore.matchFound(msg.lobbyId)
      // Drive the draft phase from the server's authoritative phase so the
      // banning→picking transition lands when bans complete (matchFound only runs
      // the found-splash from a pre-match state). Don't clobber 'starting'.
      if (msg.phase === 'banning') {
        lobbyStore.queueStatus = 'banning'
      } else if (msg.phase === 'picking' && lobbyStore.queueStatus !== 'starting') {
        lobbyStore.queueStatus = 'picking'
      }
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

const joining = ref(false)

/** Matches the modes `/api/queue/join` accepts (and `leaveQueue` mirrors). */
type QueueMode = 'ranked_5v5' | 'quick_3v3' | '1v1'

const queueMode = ref<QueueMode>('ranked_5v5')

// Zone/lane counts are derived from the map each mode actually resolves to, so
// the toggles can't advertise a map size that a zone-set edit has since changed.
const modeOptions = (
  [
    { id: 'ranked_5v5', label: 'RANKED 5v5', players: 10, blurb: 'The full draft.' },
    { id: 'quick_3v3', label: 'QUICK 3v3', players: 6, blurb: 'Smaller map, smaller team.' },
    { id: '1v1', label: '1v1 DUEL', players: 2, blurb: 'One lane, one opponent.' },
  ] as const satisfies readonly { id: QueueMode; label: string; players: number; blurb: string }[]
).map((m) => {
  const zones = zonesForMap(mapIdForMode(m.id))
  return {
    ...m,
    zoneCount: zones.length,
    laneCount: new Set(zones.map((z) => z.lane).filter(Boolean)).size,
  }
})

// Practice vs bots — the same one-lane tutorial launcher the landing page uses.
// Queueing is the wrong first move for someone who has never played; the lobby
// is where they land from the header, so the escape hatch belongs here too.
const {
  starting: startingTutorial,
  error: tutorialError,
  start: startTutorial,
} = useStartTutorial()

async function handleJoinQueue() {
  if (joining.value) return
  joining.value = true
  lobbyLog.info('Joining queue', { mode: queueMode.value })
  try {
    await lobbyStore.joinQueue(queueMode.value)
  } catch (err) {
    // Store already set lastError for the inline panel — just log here
    lobbyLog.error('Join queue failed', err)
  } finally {
    joining.value = false
  }
}

async function handleLeaveQueue() {
  lobbyLog.info('Leaving queue')
  await lobbyStore.leaveQueue()
}

async function handleHeroPick(heroId: string) {
  if (!lobbyStore.lobbyId) return

  // Optimistically update local state (rolled back if the server rejects)
  if (authStore.user?.id) {
    lobbyStore.optimisticPick(authStore.user.id, heroId)
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
      lobbyStore.rollbackPendingPick()
      lobbyStore.setError('hero pick failed — try again')
    }
  }
}

async function handleHeroBan(heroId: string) {
  if (!lobbyStore.lobbyId) return

  if (connected.value) {
    send({ type: 'hero_ban', lobbyId: lobbyStore.lobbyId, heroId })
  } else {
    // HTTP fallback when WebSocket isn't connected
    try {
      await $fetch('/api/queue/ban', {
        method: 'POST',
        body: { lobbyId: lobbyStore.lobbyId, heroId },
      })
    } catch (err) {
      lobbyLog.error('HTTP hero ban failed', err)
      lobbyStore.setError('hero ban failed — try again')
    }
  }
}

// Audio cues for the three lobby moments a player can miss while looking at
// another tab: the match landing, their own draft turn, and the last seconds
// before the game takes over the screen.
watch(
  () => lobbyStore.queueStatus,
  (status, prev) => {
    if (status === 'found' && prev !== 'found') playSound('ready')
  },
)

// A draft turn is a 15s window that ends in an auto-random, so missing it is
// expensive — it gets the same cue as the match landing.
watch(
  () => {
    const me = authStore.user?.id
    if (!me) return false
    return lobbyStore.currentPicker?.playerId === me || lobbyStore.currentBanner?.playerId === me
  },
  (mine, wasMine) => {
    if (mine && !wasMine) playSound('ready')
  },
)

watch(
  () => lobbyStore.countdown,
  (seconds) => {
    if (seconds > 0 && seconds <= 3) playSound('tick')
  },
)

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
      (!wsConnected && status !== 'idle') || (status === 'starting' && lobbyStore.countdown <= 0)
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
  lobbyLog.info('Starting recovery poll', {
    connected: connected.value,
    status: lobbyStore.queueStatus,
  })
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
    <!-- Transient toast for server announcements during lobby/draft (match
         cancelled, a player replaced by a bot). Rendered at the page root so it
         shows over every phase (searching / found / picking / starting). -->
    <AnnouncementToast
      :text="lobbyStore.lastAnnouncement?.message ?? ''"
      :seq="lobbyStore.lastAnnouncement?.seq ?? 0"
      :level="lobbyStore.lastAnnouncement?.level ?? 'info'"
    />

    <!-- PICKING: Hero selection (full-width layout).
         The wrapper caps the picker at the visible viewport height (dvh) on
         phones so the hero grid scrolls internally and the sticky confirm
         bar stays pinned on-screen. -->
    <div
      v-if="lobbyStore.queueStatus === 'picking' || lobbyStore.queueStatus === 'banning'"
      class="flex min-h-0 flex-1 flex-col max-sm:max-h-[calc(100dvh-7.5rem)]"
    >
      <HeroPicker
        :mode="lobbyStore.queueStatus === 'banning' ? 'ban' : 'pick'"
        :team="lobbyStore.team ?? 'radiant'"
        :picked-heroes="lobbyStore.pickedHeroes"
        :banned-heroes="lobbyStore.bannedHeroes"
        :team-roster="lobbyStore.teamRoster"
        :current-picker="
          lobbyStore.queueStatus === 'banning' ? lobbyStore.currentBanner : lobbyStore.currentPicker
        "
        :pick-deadline="
          lobbyStore.queueStatus === 'banning' ? lobbyStore.banDeadline : lobbyStore.pickDeadline
        "
        :my-player-id="authStore.user?.id ?? null"
        :error-message="lobbyStore.lastError"
        :new-player="authStore.user?.tutorialCompleted === false"
        @pick="handleHeroPick"
        @ban="handleHeroBan"
      />
    </div>

    <!-- All other states: centered narrow layout -->
    <div v-else class="mx-auto flex flex-1 max-w-[500px] flex-col items-center justify-center">
      <!-- IDLE: Find Match -->
      <template v-if="lobbyStore.queueStatus === 'idle'">
        <div class="flex w-full flex-col justify-center gap-4">
          <TerminalPanel title="Matchmaking">
            <div class="flex flex-col items-center gap-4 p-6">
              <p class="text-base text-text-primary">&gt;_ ready to queue</p>
              <!-- Mode picker: the small maps exist and are the gentler entry —
                   without this the only reachable format is the 10-slot draft. -->
              <div
                class="flex w-full flex-col gap-1.5"
                role="radiogroup"
                aria-label="Game mode"
                data-testid="mode-select"
              >
                <button
                  v-for="m in modeOptions"
                  :key="m.id"
                  type="button"
                  role="radio"
                  :aria-checked="queueMode === m.id"
                  :data-testid="'mode-' + m.id"
                  :disabled="joining"
                  class="flex items-baseline justify-between gap-2 border px-2.5 py-1.5 text-left transition-colors disabled:opacity-40"
                  :class="
                    queueMode === m.id
                      ? 'border-radiant bg-radiant/10 text-radiant'
                      : 'border-border text-text-dim hover:border-border-glow'
                  "
                  @click="queueMode = m.id"
                >
                  <span class="text-[0.8rem] font-bold uppercase tracking-wide">
                    <span aria-hidden="true">{{ queueMode === m.id ? '>' : ' ' }}</span>
                    {{ m.label }}
                  </span>
                  <span class="text-[0.65rem] tabular-nums text-text-dim">
                    {{ m.players }} players · {{ m.laneCount }}
                    {{ m.laneCount === 1 ? 'lane' : 'lanes' }} · {{ m.zoneCount }} zones
                  </span>
                </button>
              </div>
              <p class="text-[0.8rem] text-text-dim" data-testid="mode-blurb">
                {{ modeOptions.find((m) => m.id === queueMode)?.blurb }}
                Radiant vs Dire.
              </p>
              <div
                v-if="lobbyStore.lastError"
                data-testid="queue-error"
                class="w-full border border-dire bg-dire/10 px-3 py-2 text-center text-[0.8rem] text-dire"
              >
                [ERR] {{ lobbyStore.lastError }} — retry
              </div>
              <AsciiButton
                :label="joining ? 'SEARCHING…' : 'FIND MATCH'"
                :disabled="joining"
                variant="primary"
                data-testid="find-match"
                @click="handleJoinQueue"
              />
              <div class="flex flex-col items-center gap-1">
                <AsciiButton
                  :label="startingTutorial ? 'STARTING…' : 'NEW? PRACTICE VS BOTS'"
                  :disabled="startingTutorial"
                  variant="ghost"
                  data-testid="lobby-practice"
                  @click="startTutorial"
                />
                <InlineError :message="tutorialError" />
              </div>
            </div>
          </TerminalPanel>
          <!-- Co-op with friends: party up and play vs bots (no rating on the line).
             Starting broadcasts lobby_state over WS, which drives the draft. -->
          <PartyPanel :my-player-id="authStore.user?.id ?? null" />
          <!-- Persistent guild/clan: create or join; the tag shows on the leaderboard. -->
          <GuildPanel :my-player-id="authStore.user?.id ?? null" />
        </div>
      </template>

      <!-- SEARCHING: Queue with live stats -->
      <template v-else-if="lobbyStore.queueStatus === 'searching'">
        <MatchQueue
          :players-in-queue="lobbyStore.playersInQueue"
          :estimated-wait-seconds="lobbyStore.estimatedWaitSeconds"
          :roster="lobbyStore.queueRoster"
          :match-size="lobbyStore.matchSize"
          :bots-filling="lobbyStore.botsFilling"
          :bots-count="lobbyStore.botsCount"
          @cancel="handleLeaveQueue"
        />
      </template>

      <!-- FOUND: Match found transition -->
      <template v-else-if="lobbyStore.queueStatus === 'found'">
        <TerminalPanel title="Matchmaking">
          <div class="flex flex-col items-center gap-4 p-6" role="status" aria-live="assertive">
            <p class="text-base font-bold text-radiant text-glow">
              <span aria-hidden="true">&gt;_</span> MATCH FOUND
            </p>
            <p class="text-[0.8rem] text-text-dim">Preparing hero selection...</p>
          </div>
        </TerminalPanel>
      </template>

      <!-- STARTING: Game countdown -->
      <template v-else-if="lobbyStore.queueStatus === 'starting'">
        <TerminalPanel title="Game Starting">
          <div class="flex flex-col items-center gap-4 p-6">
            <p
              class="text-base font-bold text-radiant text-glow"
              role="status"
              aria-live="assertive"
            >
              <span aria-hidden="true">&gt;_</span> GAME STARTING
            </p>
            <!-- aria-hidden: the per-second countdown would otherwise spam a
                 screen reader; the heading + status text below convey it.
                 The :key re-mounts the digit so anim-pop replays each second —
                 animate-blink used to leave it INVISIBLE for half of every
                 second, which reads as a broken countdown rather than urgency. -->
            <span
              v-if="lobbyStore.countdown > 0"
              :key="lobbyStore.countdown"
              data-testid="countdown-digit"
              aria-hidden="true"
              class="anim-pop text-4xl font-bold tabular-nums text-radiant"
              :class="{ 'text-dire': lobbyStore.countdown <= 3 }"
            >
              {{ lobbyStore.countdown }}
            </span>
            <p class="text-[0.8rem] text-text-dim" role="status" aria-live="polite">
              {{ lobbyStore.countdown > 0 ? 'Preparing match...' : 'Loading into match...' }}
            </p>
            <span aria-hidden="true" class="animate-blink text-2xl text-radiant">|</span>
          </div>
        </TerminalPanel>
      </template>
    </div>
  </div>
</template>
