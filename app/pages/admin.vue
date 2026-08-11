<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'

/**
 * Operator panel — session-gated server-side by requireAdmin (env
 * allow-lists TERMINA_ADMIN_EMAILS / TERMINA_ADMIN_PLAYER_IDS). The page
 * itself just polls /api/admin/overview; a 401/403 bounces to the landing
 * page, so non-admins never see anything but a redirect.
 */
definePageMeta({ middleware: 'auth', ssr: false })

interface AdminGame {
  gameId: string
  mode: string
  mapId: string | null
  cycle: number
  updatedAt: string
  stalledMs: number
  humans: string[]
  botCount: number
}
interface AdminQueueEntry {
  playerId: string
  username: string
  mode: string
  mmr: number
  joinedAt: string
}
interface AdminMatch {
  id: string
  mode: string
  winner: string | null
  durationCycles: number
  endedAt: string | null
}
interface Overview {
  games: AdminGame[]
  queue: AdminQueueEntry[]
  recentMatches: AdminMatch[]
}

const overview = ref<Overview | null>(null)
const error = ref<string | null>(null)
const busy = ref<string | null>(null)
const lastRefresh = ref<number | null>(null)
let timer: ReturnType<typeof setInterval> | null = null

async function refresh() {
  try {
    overview.value = await $fetch<Overview>('/api/admin/overview')
    lastRefresh.value = Date.now()
    error.value = null
  } catch (err) {
    const status = (err as { statusCode?: number })?.statusCode
    if (status === 401 || status === 403) {
      // Not an operator — nothing to see here.
      await navigateTo('/')
      return
    }
    error.value = `overview fetch failed (${status ?? 'network'})`
  }
}

async function haltGame(gameId: string) {
  if (!window.confirm(`HALT ${gameId}? Players are sent back to the lobby.`)) return
  busy.value = gameId
  try {
    await $fetch('/api/admin/halt-game', { method: 'POST', body: { gameId } })
    await refresh()
  } catch {
    error.value = `halt ${gameId} failed`
  } finally {
    busy.value = null
  }
}

async function haltAll() {
  const count = overview.value?.games.length ?? 0
  if (count === 0) return
  if (!window.confirm(`HALT ALL ${count} live game(s)? Every player is sent back to the lobby.`))
    return
  busy.value = 'all'
  try {
    await $fetch('/api/admin/halt-game', { method: 'POST', body: { all: true } })
    await refresh()
  } catch {
    error.value = 'halt all failed'
  } finally {
    busy.value = null
  }
}

async function clearQueue() {
  if (!window.confirm('Flush the matchmaking queue?')) return
  busy.value = 'queue'
  try {
    await $fetch('/api/admin/clear-queue', { method: 'POST' })
    await refresh()
  } catch {
    error.value = 'queue flush failed'
  } finally {
    busy.value = null
  }
}

const stalledCount = computed(
  () => overview.value?.games.filter((g) => g.stalledMs > 8000).length ?? 0,
)

function fmtAge(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`
}

onMounted(() => {
  void refresh()
  timer = setInterval(() => void refresh(), 5000)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 py-6 font-mono text-text-primary">
    <div class="mb-4 flex items-baseline justify-between border-b border-border pb-2">
      <h1 class="text-lg font-bold uppercase tracking-widest text-chaff text-glow-sm">
        &gt;_ Operator Panel
      </h1>
      <span class="text-[0.7rem] text-text-dim" data-testid="admin-refresh">
        {{ lastRefresh ? `refreshed ${new Date(lastRefresh).toLocaleTimeString()}` : 'loading…' }}
      </span>
    </div>

    <p v-if="error" class="mb-3 border border-audit/60 bg-audit/10 px-2 py-1 text-audit">
      [ERROR] {{ error }}
    </p>

    <!-- Live games -->
    <section class="mb-6">
      <div class="mb-1 flex items-center justify-between">
        <h2 class="text-sm font-bold uppercase tracking-wider text-text-dim">
          Live games ({{ overview?.games.length ?? 0 }})
          <span v-if="stalledCount" class="text-audit"> · {{ stalledCount }} stalled</span>
        </h2>
        <button
          v-if="(overview?.games.length ?? 0) > 0"
          class="cursor-pointer border border-audit px-2 py-0.5 text-[0.7rem] uppercase text-audit hover:bg-audit/15 disabled:opacity-50"
          :disabled="busy !== null"
          data-testid="admin-halt-all"
          @click="haltAll"
        >
          [HALT ALL]
        </button>
      </div>
      <div v-if="!overview?.games.length" class="text-[0.75rem] text-text-dim">
        No live games — the grid is quiet.
      </div>
      <div v-else class="overflow-x-auto">
        <table class="w-full border-collapse text-[0.75rem]">
          <thead>
            <tr class="border-b border-border text-left text-text-dim">
              <th class="py-1 pr-3">game</th>
              <th class="py-1 pr-3">mode</th>
              <th class="py-1 pr-3">cycle</th>
              <th class="py-1 pr-3">last tick</th>
              <th class="py-1 pr-3">humans</th>
              <th class="py-1 pr-3">bots</th>
              <th class="py-1"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="g in overview.games"
              :key="g.gameId"
              class="border-b border-border/40"
              :data-testid="`admin-game-${g.gameId}`"
            >
              <td class="py-1 pr-3">{{ g.gameId }}</td>
              <td class="py-1 pr-3">{{ g.mode }}{{ g.mapId ? ` · ${g.mapId}` : '' }}</td>
              <td class="py-1 pr-3 tabular-nums">{{ g.cycle }}</td>
              <td class="py-1 pr-3 tabular-nums" :class="g.stalledMs > 8000 ? 'text-audit' : ''">
                {{ fmtAge(g.stalledMs) }} ago
              </td>
              <td class="py-1 pr-3">{{ g.humans.join(', ') || '—' }}</td>
              <td class="py-1 pr-3 tabular-nums">{{ g.botCount }}</td>
              <td class="py-1 text-right">
                <button
                  class="cursor-pointer border border-audit px-2 py-0.5 text-[0.7rem] uppercase text-audit hover:bg-audit/15 disabled:opacity-50"
                  :disabled="busy !== null"
                  :data-testid="`admin-halt-${g.gameId}`"
                  @click="haltGame(g.gameId)"
                >
                  {{ busy === g.gameId ? '…' : '[HALT]' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Queue -->
    <section class="mb-6">
      <div class="mb-1 flex items-center justify-between">
        <h2 class="text-sm font-bold uppercase tracking-wider text-text-dim">
          Matchmaking queue ({{ overview?.queue.length ?? 0 }})
        </h2>
        <button
          v-if="(overview?.queue.length ?? 0) > 0"
          class="cursor-pointer border border-audit px-2 py-0.5 text-[0.7rem] uppercase text-audit hover:bg-audit/15 disabled:opacity-50"
          :disabled="busy !== null"
          data-testid="admin-clear-queue"
          @click="clearQueue"
        >
          [FLUSH]
        </button>
      </div>
      <div v-if="!overview?.queue.length" class="text-[0.75rem] text-text-dim">Queue empty.</div>
      <table v-else class="w-full border-collapse text-[0.75rem]">
        <thead>
          <tr class="border-b border-border text-left text-text-dim">
            <th class="py-1 pr-3">player</th>
            <th class="py-1 pr-3">mode</th>
            <th class="py-1 pr-3">mmr</th>
            <th class="py-1">joined</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="q in overview.queue" :key="q.playerId" class="border-b border-border/40">
            <td class="py-1 pr-3">{{ q.username }}</td>
            <td class="py-1 pr-3">{{ q.mode }}</td>
            <td class="py-1 pr-3 tabular-nums">{{ q.mmr }}</td>
            <td class="py-1">{{ new Date(q.joinedAt).toLocaleTimeString() }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- Recent matches -->
    <section>
      <h2 class="mb-1 text-sm font-bold uppercase tracking-wider text-text-dim">Recent matches</h2>
      <div v-if="!overview?.recentMatches.length" class="text-[0.75rem] text-text-dim">
        No finished matches yet.
      </div>
      <table v-else class="w-full border-collapse text-[0.75rem]">
        <thead>
          <tr class="border-b border-border text-left text-text-dim">
            <th class="py-1 pr-3">match</th>
            <th class="py-1 pr-3">mode</th>
            <th class="py-1 pr-3">winner</th>
            <th class="py-1 pr-3">cycles</th>
            <th class="py-1">ended</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in overview.recentMatches" :key="m.id" class="border-b border-border/40">
            <td class="py-1 pr-3">{{ m.id }}</td>
            <td class="py-1 pr-3">{{ m.mode }}</td>
            <td
              class="py-1 pr-3 uppercase"
              :class="
                m.winner === 'chaff' ? 'text-chaff' : m.winner === 'audit' ? 'text-audit' : ''
              "
            >
              {{ m.winner ?? 'halted' }}
            </td>
            <td class="py-1 pr-3 tabular-nums">{{ m.durationCycles }}</td>
            <td class="py-1">{{ m.endedAt ? new Date(m.endedAt).toLocaleTimeString() : '—' }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
