<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { HEROES } from '~~/shared/constants/heroes'
import { reconnectDelay } from '~/utils/reconnect'
import { parseSpectatorMessage } from '~/utils/spectatorMessage'
import { formatTickClock } from '~/utils/gameClock'
import type { PlayerState, PlayerVisibleState } from '~~/shared/types/game'
import type { PlayerScoreRow } from '~/components/game/PlayerScoreTable.vue'

definePageMeta({ ssr: false })

const route = useRoute()
const gameId = computed(() => String(route.params.gameId))

type ConnState = 'connecting' | 'connected' | 'closed' | 'reconnecting' | 'error'

const conn = ref<ConnState>('connecting')
const ackedGameId = ref<string | null>(null)
const lastTick = ref<number>(0)
const visibleState = ref<PlayerVisibleState | null>(null)
const errorMessage = ref<string | null>(null)

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectAttempts = 0
const MAX_RECONNECT_ATTEMPTS = 10
let disposed = false

async function connect() {
  if (!import.meta.client || disposed) return

  // Best-effort ticket fetch — auth still required for WS in this app.
  let ticket = ''
  try {
    const res = await fetch('/api/auth/ws-ticket')
    if (res.ok) {
      const data = await res.json()
      ticket = (data?.ticket as string) ?? ''
    }
  } catch {
    /* ignore */
  }

  const wsBase = useWsOrigin()
  const url = ticket ? `${wsBase}/ws?ticket=${encodeURIComponent(ticket)}` : `${wsBase}/ws`

  ws = new WebSocket(url)

  ws.onopen = () => {
    conn.value = 'connected'
    reconnectAttempts = 0
    ws?.send(JSON.stringify({ type: 'spectate', gameId: gameId.value }))
  }

  ws.onmessage = (ev) => {
    // Parse + classify is unit-tested in spectatorMessage; this only applies it.
    const msg = parseSpectatorMessage(ev.data)
    if (msg.type === 'ack') {
      ackedGameId.value = msg.gameId
    } else if (msg.type === 'tick') {
      lastTick.value = msg.tick
      visibleState.value = msg.state
    } else if (msg.type === 'error') {
      errorMessage.value = msg.message
    }
  }

  ws.onerror = () => {
    if (conn.value !== 'closed') conn.value = 'error'
  }

  ws.onclose = () => {
    if (disposed) {
      conn.value = 'closed'
      return
    }
    // Exponential backoff reconnect (same pattern as useGameSocket, but
    // simpler — spectator is read-only, no missed-event replay needed).
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      conn.value = 'reconnecting'
      const delay = reconnectDelay(reconnectAttempts)
      reconnectAttempts++
      reconnectTimer = setTimeout(() => void connect(), delay)
    } else {
      conn.value = 'closed'
    }
  }
}

onMounted(() => {
  void connect()
})

onUnmounted(() => {
  disposed = true
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (ws) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'unspectate' }))
      } catch {
        /* ignore */
      }
    }
    ws.onclose = null
    ws.close()
    ws = null
  }
})

// The spectator stream is fogless, so every entry is a full PlayerState.
const allPlayers = computed<PlayerState[]>(() => {
  if (!visibleState.value) return []
  return Object.values(visibleState.value.players) as PlayerState[]
})
const radiantPlayers = computed(() => allPlayers.value.filter((p) => p.team === 'radiant'))
const direPlayers = computed(() => allPlayers.value.filter((p) => p.team === 'dire'))

function heroName(id: string | null | undefined): string {
  if (!id) return '???'
  return HEROES[id]?.name ?? id
}

// Normalise into the shared PlayerScoreTable row shape (live state is fogless,
// so every entry is a full PlayerState).
function toRow(p: PlayerState): PlayerScoreRow {
  return {
    id: p.id,
    heroName: heroName(p.heroId),
    level: p.level,
    hp: p.hp,
    maxHp: p.maxHp,
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    gold: p.gold,
    zone: p.zone,
    alive: p.alive,
    aiControlled: p.aiControlled,
  }
}
const radiantRows = computed(() => radiantPlayers.value.map(toRow))
const direRows = computed(() => direPlayers.value.map(toRow))

// Padded MM:SS game clock from a tick count (shared tick→clock helper).
function gameTime(tick: number): string {
  return formatTickClock(tick, true)
}
</script>

<template>
  <div class="min-h-screen bg-bg-primary p-4 text-text-primary">
    <div class="mx-auto flex max-w-6xl flex-col gap-4">
      <!-- Header -->
      <div class="flex flex-wrap items-baseline justify-between gap-3 border-b border-border pb-3">
        <div class="min-w-0">
          <div class="t-caption">// spectator · live</div>
          <h1 class="t-h1 text-glow-sm t-mono-num break-all">{{ gameId }}</h1>
        </div>
        <div class="flex items-center gap-3 t-caption t-mono-num">
          <span
            :class="
              conn === 'connected'
                ? 'text-radiant text-glow-sm'
                : conn === 'connecting' || conn === 'reconnecting'
                  ? 'text-warn animate-pulse'
                  : 'text-dire text-glow-dire'
            "
          >
            [{{ conn.toUpperCase() }}]
          </span>
          <NuxtLink
            to="/"
            class="border border-border px-2 py-1 hover:text-text-primary hover:border-border-glow"
          >
            [exit]
          </NuxtLink>
        </div>
      </div>

      <!-- Connection given up (game likely ended) and nothing ever streamed -->
      <div
        v-if="!visibleState && !errorMessage && conn === 'closed'"
        class="border border-border p-4 t-caption"
      >
        &gt;_ this game is no longer live (it may have ended).
        <div class="mt-1">
          <NuxtLink to="/leaderboard" class="text-zone hover:text-text-primary">
            [back to leaderboard]
          </NuxtLink>
        </div>
      </div>

      <!-- Status when no state yet -->
      <div v-else-if="!visibleState && !errorMessage" class="border border-border p-4 t-caption">
        &gt;_ waiting for first tick from game server...
        <div v-if="ackedGameId" class="mt-1">subscription confirmed for {{ ackedGameId }}</div>
      </div>

      <div v-if="errorMessage" class="border border-dire bloom-dire p-4">
        <div class="t-h3 text-dire text-glow-dire">SPECTATOR ERROR</div>
        <div class="t-caption mt-1">{{ errorMessage }}</div>
      </div>

      <template v-if="visibleState">
        <!-- Score banner -->
        <div class="grid grid-cols-3 items-stretch border border-border bg-bg-panel">
          <div
            class="border-r border-border p-3 text-center bloom-radiant"
            data-testid="spectator-score-radiant"
          >
            <div class="t-h3 text-radiant text-glow-radiant">RADIANT</div>
            <div class="t-display t-mono-num text-radiant text-glow-radiant">
              {{ visibleState.teams.radiant.kills }}
            </div>
            <div class="t-caption">{{ visibleState.teams.radiant.towerKills }} towers</div>
          </div>
          <div class="flex flex-col items-center justify-center p-3">
            <div class="t-caption">tick · {{ visibleState.timeOfDay }}</div>
            <div class="t-h1 t-mono-num text-glow-sm" data-testid="spectator-tick">
              {{ lastTick }}
            </div>
            <div class="t-caption mt-1">{{ gameTime(lastTick) }}</div>
          </div>
          <div
            class="border-l border-border p-3 text-center bloom-dire"
            data-testid="spectator-score-dire"
          >
            <div class="t-h3 text-dire text-glow-dire">DIRE</div>
            <div class="t-display t-mono-num text-dire text-glow-dire">
              {{ visibleState.teams.dire.kills }}
            </div>
            <div class="t-caption">{{ visibleState.teams.dire.towerKills }} towers</div>
          </div>
        </div>

        <!-- Per-team breakdown -->
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="border border-radiant/40 bg-bg-panel">
            <div
              class="t-h3 border-b border-border bg-bg-secondary px-3 py-1.5 text-radiant text-glow-radiant"
            >
              RADIANT
            </div>
            <PlayerScoreTable caption="Radiant players" :rows="radiantRows" />
          </div>

          <div class="border border-dire/40 bg-bg-panel">
            <div
              class="t-h3 border-b border-border bg-bg-secondary px-3 py-1.5 text-dire text-glow-dire"
            >
              DIRE
            </div>
            <PlayerScoreTable caption="Dire players" :rows="direRows" />
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
