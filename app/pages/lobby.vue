<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useAuthStore } from '~/stores/auth'
import { useLobbyStore } from '~/stores/lobby'
import { useGameStore } from '~/stores/game'
import { useQueuePolling } from '~/composables/useQueuePolling'
import { useAudio } from '~/composables/useAudio'
import { useStartTutorial } from '~/composables/useStartTutorial'
import { lobbyLog } from '~/utils/logger'
import { mapIdForMode, zonesForMap } from '~~/shared/constants/maps'

definePageMeta({ middleware: 'auth', ssr: false })

const authStore = useAuthStore()
const lobbyStore = useLobbyStore()
const gameStore = useGameStore()
const router = useRouter()

const { playSound } = useAudio()

// All-Vercel: quick-match queue state is driven entirely over HTTP polling
// (queueNeon + status-neon, via useQueuePolling below) — there is no WS push
// anymore (the DO-era WS lobby/draft route is gone). A formed quick-match
// jumps straight from 'searching' to a running game, bots autofilled and
// heroes auto-assigned — see server/game/matchmaking/matchStart.ts's doc
// comment. The 5v5 draft/ban flow (HeroPicker, lobbyStore's picking/banning/
// found/starting states, hero pick/ban HTTP endpoints) was NOT ported to
// this path; it's a real follow-up feature, not wired here.
const queuePolling = useQueuePolling()

const joining = ref(false)

/** Matches the modes /api/queue/join-neon accepts (and leave-neon mirrors). */
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

/** Once a quick-match (or a party co-op game) is found/started there is no
 *  draft to enter — set gameStore.gameId/playerId directly; the gameStore.
 *  gameId watcher below handles navigating to /play from there. */
function onMatchFound(gameId: string) {
  queuePolling.stop()
  gameStore.gameId = gameId
  gameStore.playerId = authStore.user?.id ?? null
}

async function joinQueue() {
  lobbyStore.clearError()
  try {
    const res = await $fetch<{ success: boolean; queueSize: number; gameId?: string }>(
      '/api/queue/join-neon',
      { method: 'POST', body: { mode: queueMode.value } },
    )
    if (res.gameId) {
      onMatchFound(res.gameId)
      return
    }
    lobbyStore.playersInQueue = res.queueSize
    lobbyStore.queueStatus = 'searching'
    lobbyStore.queueTime = 0
    queuePolling.start({
      onFound: onMatchFound,
      onSearching: ({ queueSize, botFillDue }) => {
        lobbyStore.playersInQueue = queueSize
        lobbyStore.botsFilling = botFillDue
      },
    })
  } catch (err: unknown) {
    lobbyLog.error('Queue join failed', err)
    const e = err as { data?: { message?: string }; message?: string }
    lobbyStore.setError(
      `could not join queue — ${e?.data?.message ?? e?.message ?? 'unknown error'}`,
    )
    throw err
  }
}

async function leaveQueue() {
  queuePolling.stop()
  try {
    await $fetch('/api/queue/leave-neon', { method: 'POST' })
  } catch {
    // Ignore errors on leave — best-effort.
  }
  lobbyStore.reset()
}

async function handleJoinQueue() {
  if (joining.value) return
  joining.value = true
  lobbyLog.info('Joining queue', { mode: queueMode.value })
  try {
    await joinQueue()
  } catch (err) {
    // Store already set lastError for the inline panel — just log here
    lobbyLog.error('Join queue failed', err)
  } finally {
    joining.value = false
  }
}

async function handleLeaveQueue() {
  lobbyLog.info('Leaving queue')
  await leaveQueue()
}

// Audio cue for the countdown-to-game-start moment (kept for when a future
// Neon-backed draft/countdown wires lobbyStore.startCountdown again — a
// quick-match today jumps straight into a running game with no countdown).
watch(
  () => lobbyStore.countdown,
  (seconds) => {
    if (seconds > 0 && seconds <= 3) playSound('cycle')
  },
)

// Recover queue state if we landed on /lobby after a page refresh: check
// status-neon once and resume polling if still searching.
onMounted(async () => {
  if (!authStore.user?.id) return
  if (lobbyStore.queueStatus === 'idle') {
    await recoverQueueState()
  }
})

async function recoverQueueState() {
  try {
    const res = await $fetch<{
      status: 'idle' | 'searching' | 'found'
      queueSize?: number
      botFillDue?: boolean
      gameId?: string
    }>('/api/queue/status-neon')
    if (res.status === 'found' && res.gameId) {
      onMatchFound(res.gameId)
    } else if (res.status === 'searching') {
      lobbyStore.queueStatus = 'searching'
      lobbyStore.playersInQueue = res.queueSize ?? 0
      lobbyStore.botsFilling = res.botFillDue ?? false
      queuePolling.start({
        onFound: onMatchFound,
        onSearching: ({ queueSize, botFillDue }) => {
          lobbyStore.playersInQueue = queueSize
          lobbyStore.botsFilling = botFillDue
        },
      })
    }
  } catch (err) {
    lobbyLog.warn('Queue status recovery failed', err)
  }
}

// Navigate to /play once a game ID is set (quick-match found, or a party
// co-op game started).
watch(
  () => gameStore.gameId,
  (gId) => {
    if (gId) {
      lobbyLog.info('Navigating to /play', { gameId: gId })
      if (!gameStore.playerId) gameStore.playerId = authStore.user?.id ?? null
      router.push('/play')
    }
  },
)

onUnmounted(() => {
  queuePolling.stop()
  lobbyStore.$dispose()
})
</script>

<template>
  <div class="flex flex-1 flex-col">
    <!-- Transient toast for lobby announcements. -->
    <AnnouncementToast
      :text="lobbyStore.lastAnnouncement?.message ?? ''"
      :seq="lobbyStore.lastAnnouncement?.seq ?? 0"
      :level="lobbyStore.lastAnnouncement?.level ?? 'info'"
    />

    <div class="mx-auto flex flex-1 max-w-[500px] flex-col items-center justify-center">
      <!-- IDLE: Find Match -->
      <template v-if="lobbyStore.queueStatus === 'idle'">
        <div class="flex w-full flex-col justify-center gap-4">
          <TerminalPanel title="Matchmaking">
            <div class="flex flex-col items-center gap-4 p-6">
              <p class="text-base text-text-primary">&gt;_ ready to work a route</p>
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
                      ? 'border-chaff bg-chaff/10 text-chaff'
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
                    {{ m.laneCount === 1 ? 'route' : 'lanes' }} · {{ m.zoneCount }} zones
                  </span>
                </button>
              </div>
              <p class="text-[0.8rem] text-text-dim" data-testid="mode-blurb">
                {{ modeOptions.find((m) => m.id === queueMode)?.blurb }}
                Two crews. Five each.
              </p>
              <div
                v-if="lobbyStore.lastError"
                data-testid="queue-error"
                class="w-full border border-audit bg-audit/10 px-3 py-2 text-center text-[0.8rem] text-audit"
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
          <!-- Co-op with friends: party up and play vs bots (no rating on the line). -->
          <PartyPanel :my-player-id="authStore.user?.id ?? null" @started="onMatchFound" />
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
    </div>
  </div>
</template>
