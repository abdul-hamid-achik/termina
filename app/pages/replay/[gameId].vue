<script setup lang="ts">
import { computed, ref, onUnmounted } from 'vue'
import { HEROES } from '~~/shared/constants/heroes'
import { formatReplayCommand, clampFrameIndex, nextScrubTick, keyMoments } from '~/utils/replayView'
import { playerNetWorth, scripLead, formatScripShort, type NetWorthInput } from '~/utils/strategy'
import type { PlayerScoreRow } from '~/components/game/PlayerScoreTable.vue'

definePageMeta({ ssr: false })

const route = useRoute()
const gameId = computed(() => String(route.params.gameId))

interface ReplayIntegrity {
  complete: boolean
  truncated: boolean
  readFailed: boolean
  entryCount: number
  firstLoggedCycle: number | null
  lastLoggedCycle: number | null
  initialSnapshotCycle: number
}

interface ReplayPayload {
  gameId: string
  savedAt: number
  state: {
    cycle: number
    phase: string
    teams: {
      chaff: { kills: number; iceKills: number; scrip: number }
      audit: { kills: number; iceKills: number; scrip: number }
    }
    players: Record<
      string,
      {
        id: string
        name: string
        team: 'chaff' | 'audit'
        heroId: string | null
        level: number
        scrip: number
        kills: number
        deaths: number
        assists: number
        alive: boolean
        zone: string
      }
    >
    timeOfDay: 'day' | 'night'
  }
  meta?: { players: { playerId: string; team: 'chaff' | 'audit'; heroId: string; mmr: number }[] }
  actions: { cycle: number; playerId: string; command: { type: string; [k: string]: unknown } }[]
  integrity?: ReplayIntegrity
}

interface FramePlayer {
  id: string
  integ: number
  maxInteg: number
  bw: number
  maxBw: number
  level: number
  scrip: number
  kills: number
  deaths: number
  assists: number
  alive: boolean
  zone: string
  items: (string | null)[]
}

interface Frame {
  cycle: number
  teams: {
    chaff: { kills: number; iceKills: number }
    audit: { kills: number; iceKills: number }
  }
  timeOfDay: 'day' | 'night'
  players: Record<string, FramePlayer>
}

interface FramesPayload {
  gameId: string
  totalTicks: number
  frames: Frame[]
  meta?: { players: { playerId: string; team: 'chaff' | 'audit'; heroId: string; mmr: number }[] }
  integrity?: ReplayIntegrity
}

const { data, error, pending } = await useFetch<ReplayPayload>(`/api/replay/${gameId.value}`)
const framesFetch = await useFetch<FramesPayload>(`/api/replay/${gameId.value}/frames`)
const framesData = framesFetch.data
// Component tests stub useFetch with a partial shape; default error to null.
const framesError = framesFetch.error ?? ref(null)

const integrityNotice = computed(() => {
  const integrity = data.value?.integrity
  if (!integrity || integrity.complete) return null
  if (integrity.truncated) {
    const from = integrity.firstLoggedCycle
    const to = integrity.lastLoggedCycle
    const range = from != null && to != null ? ` Retained log covers cycles ${from}–${to}.` : ''
    return `INCOMPLETE REPLAY — action log was truncated.${range} End-state dump only; scrubber frames were not reconstructed.`
  }
  if (integrity.readFailed) {
    return 'INCOMPLETE REPLAY — action log could not be read.'
  }
  return 'INCOMPLETE REPLAY — log integrity unknown.'
})

const framesUnavailableNotice = computed(() => {
  if (framesData.value || !framesError.value) return null
  const msg = messageFromError(framesError.value)
  if (/truncated|incomplete/i.test(msg)) {
    return 'Frame scrubber unavailable — action log was truncated and cannot reconstruct from cycle 1.'
  }
  if (/after the game ends/i.test(msg)) {
    return 'Frame scrubber unavailable until the match ends.'
  }
  return msg ? `Frame scrubber unavailable — ${msg}` : 'Frame scrubber unavailable.'
})

const scrubTick = ref(0)
const maxTick = computed(() => {
  if (framesData.value?.totalTicks) return framesData.value.totalTicks
  return data.value?.state.cycle ?? 0
})

// Playback: auto-advance the scrubber so a replay can be watched, not just
// dragged. ~0.6s per cycle is a readable pace for the 4s-cycle game.
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

// Key moments (fights + ice falls) so a learner can jump to the action
// instead of scrubbing blindly. Derived from the frame stream's score deltas.
const moments = computed(() => keyMoments(framesData.value?.frames ?? []))

function jumpTo(cycle: number) {
  stopPlayback()
  scrubTick.value = cycle
}

// Filter actions visible up to scrubTick
const visibleActions = computed(() => {
  if (!data.value) return []
  return data.value.actions.filter((a) => a.cycle <= scrubTick.value)
})

// Frame at the scrub position — frames are indexed by cycle (0..N).
const currentFrame = computed<Frame | null>(() => {
  const frames = framesData.value?.frames
  if (!frames) return null
  const idx = clampFrameIndex(frames.length, scrubTick.value)
  return idx < 0 ? null : (frames[idx] ?? null)
})

function frameTeam(team: 'chaff' | 'audit'): FramePlayer[] {
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

const chaffPlayers = computed(() => {
  if (currentFrame.value) return frameTeam('chaff')
  if (!data.value) return []
  // Fall back to the snapshot's end-state if frames haven't loaded yet.
  return Object.values(data.value.state.players).filter((p) => p.team === 'chaff')
})
const auditPlayers = computed(() => {
  if (currentFrame.value) return frameTeam('audit')
  if (!data.value) return []
  return Object.values(data.value.state.players).filter((p) => p.team === 'audit')
})

// Normalise frame/snapshot players into the shared PlayerScoreTable row shape.
// hero id is resolved from the match meta (frames carry no heroId per player).
function toScoreRow(p: {
  id: string
  guildTag?: string
  level: number
  integ?: number
  maxInteg?: number
  kills: number
  deaths: number
  assists: number
  scrip: number
  zone: string
  alive: boolean
}): PlayerScoreRow {
  return {
    id: p.id,
    heroName: heroName(heroIdForPlayer(p.id)),
    guildTag: p.guildTag,
    level: p.level,
    integ: p.integ,
    maxInteg: p.maxInteg,
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    scrip: p.scrip,
    zone: p.zone,
    alive: p.alive,
  }
}
const chaffRows = computed(() => chaffPlayers.value.map(toScoreRow))
const auditRows = computed(() => auditPlayers.value.map(toScoreRow))

// Net-worth scrip lead at the scrub position — scrubs with the frame so a learner
// can watch the lead swing. Net worth = liquid scrip + carried item value (per
// the tested strategy helpers); the snapshot fallback carries no items, so it's
// scrip-only until frames load.
const chaffNetWorth = computed(() =>
  chaffPlayers.value.reduce((sum, p) => sum + playerNetWorth(p as NetWorthInput), 0),
)
const auditNetWorth = computed(() =>
  auditPlayers.value.reduce((sum, p) => sum + playerNetWorth(p as NetWorthInput), 0),
)
const lead = computed(() => scripLead(chaffNetWorth.value, auditNetWorth.value))

const teamScores = computed(() => {
  if (currentFrame.value) {
    return {
      chaff: currentFrame.value.teams.chaff,
      audit: currentFrame.value.teams.audit,
    }
  }
  if (!data.value) return null
  return {
    chaff: {
      kills: data.value.state.teams.chaff.kills,
      iceKills: data.value.state.teams.chaff.iceKills,
    },
    audit: {
      kills: data.value.state.teams.audit.kills,
      iceKills: data.value.state.teams.audit.iceKills,
    },
  }
})

function fmtSavedAt(ts: number): string {
  return new Date(ts).toLocaleString()
}

// The endpoint's sentence ("Replay available after the game ends") travels in
// the response body's `message`. The FetchError's own statusMessage is only the
// HTTP status text, which Nitro leaves as "Server Error" for any error that
// doesn't set one — so reading that first blames the backend for a 403/404 the
// player can actually act on.
function messageFromError(err: unknown): string {
  const e = err as
    | { data?: { message?: unknown }; statusMessage?: unknown; message?: unknown }
    | undefined
  for (const candidate of [e?.data?.message, e?.statusMessage, e?.message]) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return 'unknown error'
}
const errorMessage = computed(() => messageFromError(error.value))

function heroName(id: string | null): string {
  if (!id) return '???'
  return HEROES[id]?.name ?? id
}

// Initialise the scrubber to the last cycle ONCE data arrives. Guarded so it
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
    scrubTick.value = data.value.state.cycle
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

      <div v-else-if="error" class="border border-audit bloom-audit p-4">
        <div class="t-h3 text-audit text-glow-audit">REPLAY UNAVAILABLE</div>
        <div class="t-caption mt-1" data-testid="replay-error-detail">
          {{ errorMessage }}
        </div>
        <div class="mt-2 t-caption">
          A replay is written when the game ends — a match still in progress doesn't have one yet —
          and is kept for about 8 hours after that.
        </div>
      </div>

      <template v-else-if="data">
        <div
          v-if="integrityNotice"
          class="border border-audit/60 bg-bg-panel p-3 t-caption text-audit"
          data-testid="replay-integrity-notice"
          role="status"
        >
          {{ integrityNotice }}
        </div>
        <div
          v-else-if="framesUnavailableNotice"
          class="border border-border bg-bg-panel p-3 t-caption text-text-dim"
          data-testid="replay-frames-unavailable"
          role="status"
        >
          {{ framesUnavailableNotice }}
        </div>

        <!-- Score banner — driven by the current frame so it scrubs with the slider -->
        <div class="grid grid-cols-3 items-stretch border border-border bg-bg-panel">
          <div class="border-r border-border p-3 text-center bloom-chaff">
            <div class="t-h3 text-chaff text-glow-chaff">CHAFF</div>
            <div class="t-display t-mono-num text-chaff text-glow-chaff">
              {{ teamScores?.chaff.kills ?? 0 }}
            </div>
            <div class="t-caption">{{ teamScores?.chaff.iceKills ?? 0 }} ice</div>
          </div>
          <div class="flex flex-col items-center justify-center p-3">
            <div class="t-caption">cycle</div>
            <div class="t-h1 t-mono-num text-glow-sm">{{ scrubTick }}</div>
            <div class="t-caption mt-1">
              {{ currentFrame?.timeOfDay ?? data.state.timeOfDay }} · saved
              {{ fmtSavedAt(data.savedAt) }}
            </div>
            <div
              v-if="lead.leader"
              class="t-caption mt-1 t-mono-num"
              :class="lead.leader === 'chaff' ? 'text-chaff' : 'text-audit'"
              data-testid="replay-scrip-lead"
            >
              {{ lead.leader === 'chaff' ? 'CHAFF' : 'AUDIT' }} +{{ formatScripShort(lead.amount) }}
              net worth
            </div>
            <div v-else class="t-caption mt-1 text-text-dim" data-testid="replay-scrip-lead">
              net worth even
            </div>
          </div>
          <div class="border-l border-border p-3 text-center bloom-audit">
            <div class="t-h3 text-audit text-glow-audit">AUDIT</div>
            <div class="t-display t-mono-num text-audit text-glow-audit">
              {{ teamScores?.audit.kills ?? 0 }}
            </div>
            <div class="t-caption">{{ teamScores?.audit.iceKills ?? 0 }} ice</div>
          </div>
        </div>

        <!-- Per-player breakdown -->
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="border border-chaff/40 bg-bg-panel">
            <div
              class="t-h3 border-b border-border bg-bg-secondary px-3 py-1.5 text-chaff text-glow-chaff"
            >
              CHAFF
            </div>
            <PlayerScoreTable caption="Chaff players" :rows="chaffRows" />
          </div>

          <div class="border border-audit/40 bg-bg-panel">
            <div
              class="t-h3 border-b border-border bg-bg-secondary px-3 py-1.5 text-audit text-glow-audit"
            >
              AUDIT
            </div>
            <PlayerScoreTable caption="Audit players" :rows="auditRows" />
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

          <!-- Key moments — jump straight to the fights + ice falls -->
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
                m.kind === 'ice'
                  ? 'border-gold/50 text-gold hover:text-gold'
                  : 'border-audit/50 text-audit hover:text-audit'
              "
              :data-testid="`key-moment-${m.kind}`"
              :aria-label="`Jump to ${m.label} at cycle ${m.cycle}`"
              @click="jumpTo(m.cycle)"
            >
              {{ m.label }} · T{{ m.cycle }}
            </button>
          </div>

          <div class="border-b border-border bg-bg-secondary px-3 py-2">
            <div class="t-caption mb-1 flex justify-between">
              <span>cycle 0</span>
              <span>scrub: cycle {{ scrubTick }}</span>
              <span>cycle {{ maxTick }}</span>
            </div>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="shrink-0 border border-border px-2 py-0.5 text-xs text-ability transition-colors hover:border-border-glow hover:text-chaff"
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
                aria-label="Scrub replay cycle"
              />
            </div>
          </div>

          <div class="max-h-[420px] overflow-y-auto px-2 py-1 text-xs t-mono-num">
            <div
              v-for="(a, i) in visibleActions.slice(-200)"
              :key="i"
              class="anim-fade-in-up flex items-baseline gap-2 border-l-2 border-l-transparent px-2 py-0.5 hover:bg-white/[0.03] hover:border-l-ability"
            >
              <span class="w-12 shrink-0 text-text-muted">[T{{ a.cycle }}]</span>
              <span class="w-32 shrink-0 truncate text-self">{{ a.playerId }}</span>
              <span class="text-text-primary">{{ formatReplayCommand(a.command) }}</span>
            </div>
            <div v-if="visibleActions.length === 0" class="t-caption px-2 py-2">
              &gt;_ no actions yet at this cycle
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
