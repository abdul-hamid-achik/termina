<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { HEROES } from '~~/shared/constants/heroes'
import type { PlayerState, PlayerVisibleState } from '~~/shared/types/game'

definePageMeta({ ssr: false })

const route = useRoute()
const gameId = computed(() => String(route.params.gameId))

type ConnState = 'connecting' | 'connected' | 'closed' | 'error'

const conn = ref<ConnState>('connecting')
const ackedGameId = ref<string | null>(null)
const lastTick = ref<number>(0)
const visibleState = ref<PlayerVisibleState | null>(null)
const errorMessage = ref<string | null>(null)

let ws: WebSocket | null = null

async function connect() {
  if (!import.meta.client) return

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

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = ticket
    ? `${protocol}//${window.location.host}/ws?ticket=${encodeURIComponent(ticket)}`
    : `${protocol}//${window.location.host}/ws`

  ws = new WebSocket(url)

  ws.onopen = () => {
    conn.value = 'connected'
    ws?.send(JSON.stringify({ type: 'spectate', gameId: gameId.value }))
  }

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data)
      if (msg.type === 'spectator_ack') {
        ackedGameId.value = msg.gameId
      } else if (msg.type === 'spectator_tick') {
        lastTick.value = msg.tick
        visibleState.value = msg.state as PlayerVisibleState
      } else if (msg.type === 'error') {
        errorMessage.value = `${msg.code}: ${msg.message}`
      }
    } catch {
      /* drop unparseable */
    }
  }

  ws.onerror = () => {
    conn.value = 'error'
  }

  ws.onclose = () => {
    conn.value = 'closed'
  }
}

onMounted(() => {
  void connect()
})

onUnmounted(() => {
  if (ws && ws.readyState === ws.OPEN) {
    try {
      ws.send(JSON.stringify({ type: 'unspectate' }))
    } catch {
      /* ignore */
    }
  }
  ws?.close()
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

function gameTime(tick: number): string {
  const totalSeconds = tick * 4
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
</script>

<template>
  <div class="min-h-screen bg-bg-primary p-4 text-text-primary">
    <div class="mx-auto flex max-w-6xl flex-col gap-4">
      <!-- Header -->
      <div class="flex flex-wrap items-baseline justify-between gap-3 border-b border-border pb-3">
        <div>
          <div class="t-caption">// spectator · live</div>
          <h1 class="t-h1 text-glow-sm t-mono-num">{{ gameId }}</h1>
        </div>
        <div class="flex items-center gap-3 t-caption t-mono-num">
          <span
            :class="
              conn === 'connected'
                ? 'text-radiant text-glow-sm'
                : conn === 'connecting'
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

      <!-- Status when no state yet -->
      <div v-if="!visibleState && !errorMessage" class="border border-border p-4 t-caption">
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
          <div class="border-r border-border p-3 text-center bloom-radiant">
            <div class="t-h3 text-radiant text-glow-radiant">RADIANT</div>
            <div class="t-display t-mono-num text-radiant text-glow-radiant">
              {{ visibleState.teams.radiant.kills }}
            </div>
            <div class="t-caption">{{ visibleState.teams.radiant.towerKills }} towers</div>
          </div>
          <div class="flex flex-col items-center justify-center p-3">
            <div class="t-caption">tick · {{ visibleState.timeOfDay }}</div>
            <div class="t-h1 t-mono-num text-glow-sm">{{ lastTick }}</div>
            <div class="t-caption mt-1">{{ gameTime(lastTick) }}</div>
          </div>
          <div class="border-l border-border p-3 text-center bloom-dire">
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
            <table class="w-full t-mono-num text-xs">
              <thead>
                <tr class="text-text-muted">
                  <th class="px-2 py-1 text-left t-caption">Hero</th>
                  <th class="px-2 py-1 text-left t-caption">Lv</th>
                  <th class="px-2 py-1 text-left t-caption">HP</th>
                  <th class="px-2 py-1 text-left t-caption">K/D/A</th>
                  <th class="px-2 py-1 text-left t-caption">Gold</th>
                  <th class="px-2 py-1 text-left t-caption">Zone</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="p in radiantPlayers"
                  :key="p.id"
                  class="border-t border-border/50"
                  :class="{ 'opacity-50': !p.alive }"
                >
                  <td class="px-2 py-1">{{ heroName(p.heroId) }}</td>
                  <td class="px-2 py-1 text-gold">{{ 'level' in p ? p.level : '?' }}</td>
                  <td class="px-2 py-1">
                    <span v-if="'hp' in p && 'maxHp' in p"
                      >{{ p.hp }}<span class="text-text-muted">/{{ p.maxHp }}</span></span
                    >
                    <span v-else class="text-text-muted">?</span>
                  </td>
                  <td class="px-2 py-1">
                    <span v-if="'kills' in p">
                      <span class="text-radiant">{{ p.kills }}</span
                      ><span class="text-text-muted">/</span
                      ><span class="text-dire">{{ p.deaths }}</span
                      ><span class="text-text-muted">/</span
                      ><span class="text-text-dim">{{ p.assists }}</span>
                    </span>
                  </td>
                  <td class="px-2 py-1 text-gold">
                    {{ 'gold' in p ? p.gold.toLocaleString() : '?' }}
                  </td>
                  <td class="px-2 py-1 text-zone t-caption">{{ 'zone' in p ? p.zone : '???' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="border border-dire/40 bg-bg-panel">
            <div
              class="t-h3 border-b border-border bg-bg-secondary px-3 py-1.5 text-dire text-glow-dire"
            >
              DIRE
            </div>
            <table class="w-full t-mono-num text-xs">
              <thead>
                <tr class="text-text-muted">
                  <th class="px-2 py-1 text-left t-caption">Hero</th>
                  <th class="px-2 py-1 text-left t-caption">Lv</th>
                  <th class="px-2 py-1 text-left t-caption">HP</th>
                  <th class="px-2 py-1 text-left t-caption">K/D/A</th>
                  <th class="px-2 py-1 text-left t-caption">Gold</th>
                  <th class="px-2 py-1 text-left t-caption">Zone</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="p in direPlayers"
                  :key="p.id"
                  class="border-t border-border/50"
                  :class="{ 'opacity-50': !p.alive }"
                >
                  <td class="px-2 py-1">{{ heroName(p.heroId) }}</td>
                  <td class="px-2 py-1 text-gold">{{ 'level' in p ? p.level : '?' }}</td>
                  <td class="px-2 py-1">
                    <span v-if="'hp' in p && 'maxHp' in p"
                      >{{ p.hp }}<span class="text-text-muted">/{{ p.maxHp }}</span></span
                    >
                    <span v-else class="text-text-muted">?</span>
                  </td>
                  <td class="px-2 py-1">
                    <span v-if="'kills' in p">
                      <span class="text-radiant">{{ p.kills }}</span
                      ><span class="text-text-muted">/</span
                      ><span class="text-dire">{{ p.deaths }}</span
                      ><span class="text-text-muted">/</span
                      ><span class="text-text-dim">{{ p.assists }}</span>
                    </span>
                  </td>
                  <td class="px-2 py-1 text-gold">
                    {{ 'gold' in p ? p.gold.toLocaleString() : '?' }}
                  </td>
                  <td class="px-2 py-1 text-zone t-caption">{{ 'zone' in p ? p.zone : '???' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
