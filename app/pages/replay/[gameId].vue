<script setup lang="ts">
import { computed, ref, onUnmounted } from 'vue'
import { HEROES } from '~~/shared/constants/heroes'
import { formatReplayCommand, clampFrameIndex, nextScrubTick } from '~/utils/replayView'

definePageMeta({ ssr: false })

const route = useRoute()
const gameId = computed(() => String(route.params.gameId))

interface ReplayPayload {
  gameId: string
  savedAt: number
  state: {
    tick: number
    phase: string
    teams: {
      radiant: { kills: number; towerKills: number; gold: number }
      dire: { kills: number; towerKills: number; gold: number }
    }
    players: Record<
      string,
      {
        id: string
        name: string
        team: 'radiant' | 'dire'
        heroId: string | null
        level: number
        gold: number
        kills: number
        deaths: number
        assists: number
        alive: boolean
        zone: string
      }
    >
    timeOfDay: 'day' | 'night'
  }
  meta?: { players: { playerId: string; team: 'radiant' | 'dire'; heroId: string; mmr: number }[] }
  actions: { tick: number; playerId: string; command: { type: string; [k: string]: unknown } }[]
}

interface FramePlayer {
  id: string
  hp: number
  maxHp: number
  mp: number
  maxMp: number
  level: number
  gold: number
  kills: number
  deaths: number
  assists: number
  alive: boolean
  zone: string
  items: (string | null)[]
}

interface Frame {
  tick: number
  teams: {
    radiant: { kills: number; towerKills: number }
    dire: { kills: number; towerKills: number }
  }
  timeOfDay: 'day' | 'night'
  players: Record<string, FramePlayer>
}

interface FramesPayload {
  gameId: string
  totalTicks: number
  frames: Frame[]
  meta?: { players: { playerId: string; team: 'radiant' | 'dire'; heroId: string; mmr: number }[] }
}

const { data, error, pending } = await useFetch<ReplayPayload>(`/api/replay/${gameId.value}`)
const { data: framesData } = await useFetch<FramesPayload>(`/api/replay/${gameId.value}/frames`)

const scrubTick = ref(0)
const maxTick = computed(() => {
  if (framesData.value?.totalTicks) return framesData.value.totalTicks
  return data.value?.state.tick ?? 0
})

// Playback: auto-advance the scrubber so a replay can be watched, not just
// dragged. ~0.6s per tick is a readable pace for the 4s-tick game.
const playing = ref(false)
let playTimer: ReturnType<typeof setInterval> | null = null
function stopPlayback() {
  if (playTimer) {
    clearInterval(playTimer)
    playTimer = null
  }
  playing.value = false
}
function togglePlayback() {
  if (playing.value) {
    stopPlayback()
    return
  }
  if (scrubTick.value >= maxTick.value) scrubTick.value = 0 // replay from the top
  playing.value = true
  playTimer = setInterval(() => {
    if (scrubTick.value >= maxTick.value) {
      stopPlayback()
      return
    }
    scrubTick.value = nextScrubTick(scrubTick.value, maxTick.value)
  }, 600)
}
onUnmounted(stopPlayback)

// Filter actions visible up to scrubTick
const visibleActions = computed(() => {
  if (!data.value) return []
  return data.value.actions.filter((a) => a.tick <= scrubTick.value)
})

// Frame at the scrub position — frames are indexed by tick (0..N).
const currentFrame = computed<Frame | null>(() => {
  const frames = framesData.value?.frames
  if (!frames) return null
  const idx = clampFrameIndex(frames.length, scrubTick.value)
  return idx < 0 ? null : (frames[idx] ?? null)
})

function frameTeam(team: 'radiant' | 'dire'): FramePlayer[] {
  const f = currentFrame.value
  const meta = data.value?.meta?.players
  if (!f || !meta) return []
  return meta
    .filter((m) => m.team === team)
    .map((m) => f.players[m.playerId])
    .filter((p): p is FramePlayer => p !== undefined)
}

function heroIdForPlayer(playerId: string): string | null {
  const fromMeta = data.value?.meta?.players.find((m) => m.playerId === playerId)?.heroId
  if (fromMeta) return fromMeta
  return data.value?.state.players[playerId]?.heroId ?? null
}

const radiantPlayers = computed(() => {
  if (currentFrame.value) return frameTeam('radiant')
  if (!data.value) return []
  // Fall back to the snapshot's end-state if frames haven't loaded yet.
  return Object.values(data.value.state.players).filter((p) => p.team === 'radiant')
})
const direPlayers = computed(() => {
  if (currentFrame.value) return frameTeam('dire')
  if (!data.value) return []
  return Object.values(data.value.state.players).filter((p) => p.team === 'dire')
})

const teamScores = computed(() => {
  if (currentFrame.value) {
    return {
      radiant: currentFrame.value.teams.radiant,
      dire: currentFrame.value.teams.dire,
    }
  }
  if (!data.value) return null
  return {
    radiant: {
      kills: data.value.state.teams.radiant.kills,
      towerKills: data.value.state.teams.radiant.towerKills,
    },
    dire: {
      kills: data.value.state.teams.dire.kills,
      towerKills: data.value.state.teams.dire.towerKills,
    },
  }
})

function fmtSavedAt(ts: number): string {
  return new Date(ts).toLocaleString()
}

function heroName(id: string | null): string {
  if (!id) return '???'
  return HEROES[id]?.name ?? id
}

// Initialise the scrubber to the last tick ONCE data arrives. Guarded so it
// fires only on first load — without `inited` it would re-trigger whenever
// scrubTick returns to 0 (e.g. play-from-the-top), yanking the scrub back to
// the end. Prefer the frame count so the slider lines up with rendered frames.
let inited = false
watchEffect(() => {
  if (inited) return
  if (framesData.value?.totalTicks) {
    scrubTick.value = framesData.value.totalTicks
    inited = true
  } else if (data.value) {
    scrubTick.value = data.value.state.tick
    inited = true
  }
})
</script>

<template>
  <div class="min-h-screen bg-bg-primary p-4 text-text-primary">
    <div class="mx-auto flex max-w-6xl flex-col gap-4">
      <!-- Header -->
      <div class="flex flex-wrap items-baseline justify-between gap-3 border-b border-border pb-3">
        <div>
          <div class="t-caption">// replay</div>
          <h1 class="t-h1 text-glow-sm t-mono-num">{{ gameId }}</h1>
        </div>
        <NuxtLink
          to="/"
          class="border border-border px-3 py-1.5 t-caption transition-colors hover:text-text-primary hover:border-border-glow"
        >
          [exit]
        </NuxtLink>
      </div>

      <!-- Loading / error -->
      <div v-if="pending" class="border border-border p-4 t-caption">
        &gt;_ loading replay data...
      </div>

      <div v-else-if="error" class="border border-dire bloom-dire p-4">
        <div class="t-h3 text-dire text-glow-dire">REPLAY UNAVAILABLE</div>
        <div class="t-caption mt-1">
          {{ String(error.statusMessage ?? error.message ?? 'unknown error') }}
        </div>
        <div class="mt-2 t-caption">
          Replays are kept for ~8 hours after a game starts and are dropped on game-over.
        </div>
      </div>

      <template v-else-if="data">
        <!-- Score banner — driven by the current frame so it scrubs with the slider -->
        <div class="grid grid-cols-3 items-stretch border border-border bg-bg-panel">
          <div class="border-r border-border p-3 text-center bloom-radiant">
            <div class="t-h3 text-radiant text-glow-radiant">RADIANT</div>
            <div class="t-display t-mono-num text-radiant text-glow-radiant">
              {{ teamScores?.radiant.kills ?? 0 }}
            </div>
            <div class="t-caption">{{ teamScores?.radiant.towerKills ?? 0 }} towers</div>
          </div>
          <div class="flex flex-col items-center justify-center p-3">
            <div class="t-caption">tick</div>
            <div class="t-h1 t-mono-num text-glow-sm">{{ scrubTick }}</div>
            <div class="t-caption mt-1">
              {{ currentFrame?.timeOfDay ?? data.state.timeOfDay }} · saved
              {{ fmtSavedAt(data.savedAt) }}
            </div>
          </div>
          <div class="border-l border-border p-3 text-center bloom-dire">
            <div class="t-h3 text-dire text-glow-dire">DIRE</div>
            <div class="t-display t-mono-num text-dire text-glow-dire">
              {{ teamScores?.dire.kills ?? 0 }}
            </div>
            <div class="t-caption">{{ teamScores?.dire.towerKills ?? 0 }} towers</div>
          </div>
        </div>

        <!-- Per-player breakdown -->
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="border border-radiant/40 bg-bg-panel">
            <div
              class="t-h3 border-b border-border bg-bg-secondary px-3 py-1.5 text-radiant text-glow-radiant"
            >
              RADIANT
            </div>
            <table class="w-full t-mono-num text-xs">
              <caption class="sr-only">
                Radiant players
              </caption>
              <thead>
                <tr class="text-text-muted">
                  <th scope="col" class="px-2 py-1 text-left t-caption">Hero</th>
                  <th scope="col" class="px-2 py-1 text-left t-caption">Lv</th>
                  <th scope="col" class="px-2 py-1 text-left t-caption">HP</th>
                  <th scope="col" class="px-2 py-1 text-left t-caption">K/D/A</th>
                  <th scope="col" class="px-2 py-1 text-left t-caption">Gold</th>
                  <th scope="col" class="px-2 py-1 text-left t-caption">Zone</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="p in radiantPlayers"
                  :key="p.id"
                  class="border-t border-border/50"
                  :class="{ 'opacity-50': !p.alive }"
                >
                  <th scope="row" class="px-2 py-1 font-normal">
                    {{ heroName(heroIdForPlayer(p.id)) }}
                  </th>
                  <td class="px-2 py-1 text-gold">{{ p.level }}</td>
                  <td class="px-2 py-1">
                    <span v-if="'hp' in p && 'maxHp' in p"
                      >{{ p.hp }}<span class="text-text-muted">/{{ p.maxHp }}</span></span
                    >
                    <span v-else class="text-text-muted">?</span>
                  </td>
                  <td class="px-2 py-1">
                    <span class="text-radiant">{{ p.kills }}</span
                    ><span class="text-text-muted">/</span
                    ><span class="text-dire">{{ p.deaths }}</span
                    ><span class="text-text-muted">/</span
                    ><span class="text-text-dim">{{ p.assists }}</span>
                  </td>
                  <td class="px-2 py-1 text-gold">{{ p.gold.toLocaleString() }}</td>
                  <td class="px-2 py-1 text-zone t-caption">{{ p.zone }}</td>
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
              <caption class="sr-only">
                Dire players
              </caption>
              <thead>
                <tr class="text-text-muted">
                  <th scope="col" class="px-2 py-1 text-left t-caption">Hero</th>
                  <th scope="col" class="px-2 py-1 text-left t-caption">Lv</th>
                  <th scope="col" class="px-2 py-1 text-left t-caption">HP</th>
                  <th scope="col" class="px-2 py-1 text-left t-caption">K/D/A</th>
                  <th scope="col" class="px-2 py-1 text-left t-caption">Gold</th>
                  <th scope="col" class="px-2 py-1 text-left t-caption">Zone</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="p in direPlayers"
                  :key="p.id"
                  class="border-t border-border/50"
                  :class="{ 'opacity-50': !p.alive }"
                >
                  <th scope="row" class="px-2 py-1 font-normal">
                    {{ heroName(heroIdForPlayer(p.id)) }}
                  </th>
                  <td class="px-2 py-1 text-gold">{{ p.level }}</td>
                  <td class="px-2 py-1">
                    <span v-if="'hp' in p && 'maxHp' in p"
                      >{{ p.hp }}<span class="text-text-muted">/{{ p.maxHp }}</span></span
                    >
                    <span v-else class="text-text-muted">?</span>
                  </td>
                  <td class="px-2 py-1">
                    <span class="text-radiant">{{ p.kills }}</span
                    ><span class="text-text-muted">/</span
                    ><span class="text-dire">{{ p.deaths }}</span
                    ><span class="text-text-muted">/</span
                    ><span class="text-text-dim">{{ p.assists }}</span>
                  </td>
                  <td class="px-2 py-1 text-gold">{{ p.gold.toLocaleString() }}</td>
                  <td class="px-2 py-1 text-zone t-caption">{{ p.zone }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Action log scrubber -->
        <div class="border border-border bg-bg-panel">
          <div class="flex items-center justify-between border-b border-border px-3 py-2">
            <div class="t-h3">ACTION LOG</div>
            <div class="t-caption t-mono-num">
              {{ visibleActions.length }} / {{ data.actions.length }} actions
            </div>
          </div>

          <div class="border-b border-border bg-bg-secondary px-3 py-2">
            <div class="t-caption mb-1 flex justify-between">
              <span>tick 0</span>
              <span>scrub: tick {{ scrubTick }}</span>
              <span>tick {{ maxTick }}</span>
            </div>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="shrink-0 border border-border px-2 py-0.5 text-xs text-ability transition-colors hover:border-border-glow hover:text-radiant"
                :aria-label="playing ? 'Pause replay playback' : 'Play replay'"
                :aria-pressed="playing"
                data-testid="replay-play"
                @click="togglePlayback"
              >
                {{ playing ? '⏸ PAUSE' : '▶ PLAY' }}
              </button>
              <input
                v-model.number="scrubTick"
                type="range"
                min="0"
                :max="maxTick"
                step="1"
                class="w-full accent-ability"
                aria-label="Scrub replay tick"
              />
            </div>
          </div>

          <div class="max-h-[420px] overflow-y-auto px-2 py-1 text-xs t-mono-num">
            <div
              v-for="(a, i) in visibleActions.slice(-200)"
              :key="i"
              class="anim-fade-in-up flex items-baseline gap-2 border-l-2 border-l-transparent px-2 py-0.5 hover:bg-white/[0.03] hover:border-l-ability"
            >
              <span class="w-12 shrink-0 text-text-muted">[T{{ a.tick }}]</span>
              <span class="w-32 shrink-0 truncate text-self">{{ a.playerId }}</span>
              <span class="text-text-primary">{{ formatReplayCommand(a.command) }}</span>
            </div>
            <div v-if="visibleActions.length === 0" class="t-caption px-2 py-2">
              &gt;_ no actions yet at this tick
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
