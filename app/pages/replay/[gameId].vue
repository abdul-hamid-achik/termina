<script setup lang="ts">
import { computed, ref, onUnmounted } from 'vue'
import { HEROES } from '~~/shared/constants/heroes'
import { formatReplayCommand, clampFrameIndex, nextScrubTick, keyMoments } from '~/utils/replayView'
import { playerNetWorth, goldLead, formatGoldShort, type NetWorthInput } from '~/utils/strategy'
import type { PlayerScoreRow } from '~/components/game/PlayerScoreTable.vue'

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

// Key moments (fights + tower falls) so a learner can jump to the action
// instead of scrubbing blindly. Derived from the frame stream's score deltas.
const moments = computed(() => keyMoments(framesData.value?.frames ?? []))

function jumpTo(tick: number) {
  stopPlayback()
  scrubTick.value = tick
}

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

// Normalise frame/snapshot players into the shared PlayerScoreTable row shape.
// hero id is resolved from the match meta (frames carry no heroId per player).
function toScoreRow(p: {
  id: string
  level: number
  hp?: number
  maxHp?: number
  kills: number
  deaths: number
  assists: number
  gold: number
  zone: string
  alive: boolean
}): PlayerScoreRow {
  return {
    id: p.id,
    heroName: heroName(heroIdForPlayer(p.id)),
    level: p.level,
    hp: p.hp,
    maxHp: p.maxHp,
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    gold: p.gold,
    zone: p.zone,
    alive: p.alive,
  }
}
const radiantRows = computed(() => radiantPlayers.value.map(toScoreRow))
const direRows = computed(() => direPlayers.value.map(toScoreRow))

// Net-worth gold lead at the scrub position — scrubs with the frame so a learner
// can watch the lead swing. Net worth = liquid gold + carried item value (per
// the tested strategy helpers); the snapshot fallback carries no items, so it's
// gold-only until frames load.
const radiantNetWorth = computed(() =>
  radiantPlayers.value.reduce((sum, p) => sum + playerNetWorth(p as NetWorthInput), 0),
)
const direNetWorth = computed(() =>
  direPlayers.value.reduce((sum, p) => sum + playerNetWorth(p as NetWorthInput), 0),
)
const lead = computed(() => goldLead(radiantNetWorth.value, direNetWorth.value))

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
        <div class="min-w-0">
          <div class="t-caption">// replay</div>
          <h1 class="t-h1 text-glow-sm t-mono-num break-all">{{ gameId }}</h1>
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
            <div
              v-if="lead.leader"
              class="t-caption mt-1 t-mono-num"
              :class="lead.leader === 'radiant' ? 'text-radiant' : 'text-dire'"
              data-testid="replay-gold-lead"
            >
              {{ lead.leader === 'radiant' ? 'RADIANT' : 'DIRE' }} +{{
                formatGoldShort(lead.amount)
              }}
              net worth
            </div>
            <div v-else class="t-caption mt-1 text-text-dim" data-testid="replay-gold-lead">
              net worth even
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

        <!-- Action log scrubber -->
        <div class="border border-border bg-bg-panel">
          <div class="flex items-center justify-between border-b border-border px-3 py-2">
            <div class="t-h3">ACTION LOG</div>
            <div class="t-caption t-mono-num">
              {{ visibleActions.length }} / {{ data.actions.length }} actions
            </div>
          </div>

          <!-- Key moments — jump straight to the fights + tower falls -->
          <div
            v-if="moments.length"
            class="flex flex-wrap items-center gap-1 border-b border-border bg-bg-secondary px-3 py-2"
            data-testid="replay-key-moments"
          >
            <span class="t-caption mr-1 text-text-muted">key moments</span>
            <button
              v-for="(m, i) in moments"
              :key="i"
              type="button"
              class="border px-1.5 py-0.5 text-[0.62rem] uppercase tracking-wider transition-colors hover:border-border-glow"
              :class="
                m.kind === 'tower'
                  ? 'border-gold/50 text-gold hover:text-gold'
                  : 'border-dire/50 text-dire hover:text-dire'
              "
              :data-testid="`key-moment-${m.kind}`"
              :aria-label="`Jump to ${m.label} at tick ${m.tick}`"
              @click="jumpTo(m.tick)"
            >
              {{ m.label }} · T{{ m.tick }}
            </button>
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
