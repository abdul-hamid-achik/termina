<script setup lang="ts">
import { computed } from 'vue'
import {
  DAY_DURATION_TICKS,
  NIGHT_DURATION_TICKS,
  TICK_DURATION_MS,
} from '~~/shared/constants/balance'

const props = defineProps<{
  tick: number
  gameTime: string
  gold: number
  kills: number
  deaths: number
  assists: number
  heroId?: string
  connected?: boolean
  reconnecting?: boolean
  latency?: number
  timeOfDay?: 'day' | 'night'
  dayNightTick?: number
  /** Milliseconds until the next tick resolves (live countdown). */
  nextTickIn?: number
}>()

// ── Tick countdown bar ─────────────────────────────────────────
const TICK_BAR_WIDTH = 8

const tickBar = computed(() => {
  const remaining = Math.max(0, Math.min(TICK_DURATION_MS, props.nextTickIn ?? 0))
  const filled = Math.round((remaining / TICK_DURATION_MS) * TICK_BAR_WIDTH)
  return '█'.repeat(filled) + '░'.repeat(TICK_BAR_WIDTH - filled)
})

const tickSeconds = computed(() => ((props.nextTickIn ?? 0) / 1000).toFixed(1))

function formatGold(n: number): string {
  return n.toLocaleString()
}

function formatTimeRemaining(tick: number, timeOfDay: string): string {
  const totalTicks = timeOfDay === 'day' ? DAY_DURATION_TICKS : NIGHT_DURATION_TICKS
  const remaining = totalTicks - tick
  const seconds = Math.ceil(remaining * 4)
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}
</script>

<template>
  <div
    class="flex items-center gap-2 overflow-x-auto whitespace-nowrap border-b border-border bg-bg-secondary px-3 py-1.5 text-[0.8rem] t-mono-num"
    data-testid="game-state-bar"
  >
    <HeroAvatar v-if="heroId" :hero-id="heroId" :size="24" />
    <span class="inline-flex gap-1">
      <span class="t-caption">Tick</span>
      <span class="text-text-primary">{{ tick }}</span>
    </span>
    <span class="text-border">|</span>
    <span
      v-if="nextTickIn !== undefined"
      class="inline-flex items-center gap-1"
      data-testid="tick-countdown"
    >
      <span class="t-caption">next tick</span>
      <span class="text-ability tracking-[-0.05em]" aria-hidden="true">{{ tickBar }}</span>
      <span class="text-text-primary">{{ tickSeconds }}s</span>
    </span>
    <span v-if="nextTickIn !== undefined" class="text-border">|</span>
    <span class="inline-flex gap-1">
      <span class="text-text-primary text-glow-sm">{{ gameTime }}</span>
    </span>
    <span class="text-border">|</span>
    <span class="inline-flex items-center gap-1">
      <span v-if="timeOfDay === 'day'" class="text-gold text-glow-gold">Day</span>
      <span v-else class="text-self text-glow-sm">Night</span>
      <span v-if="dayNightTick !== undefined && timeOfDay" class="t-caption">
        ({{ formatTimeRemaining(dayNightTick, timeOfDay) }})
      </span>
    </span>
    <span class="text-border">|</span>
    <span class="inline-flex gap-1">
      <span class="t-caption">Gold</span>
      <span class="text-gold text-glow-gold font-bold">{{ formatGold(gold) }}</span>
    </span>
    <span class="text-border">|</span>
    <span class="inline-flex gap-1">
      <span class="t-caption">KDA</span>
      <span>
        <span class="text-radiant text-glow-radiant font-bold">{{ kills }}</span
        ><span class="text-text-muted">/</span
        ><span class="text-dire text-glow-dire font-bold">{{ deaths }}</span
        ><span class="text-text-muted">/</span
        ><span class="text-text-dim font-bold">{{ assists }}</span>
      </span>
    </span>
    <span class="text-border">|</span>
    <span v-if="reconnecting" class="text-dire text-glow-dire animate-pulse">[RECONNECTING...]</span>
    <span v-else-if="connected" class="text-radiant text-glow-sm">[ONLINE {{ latency }}ms]</span>
    <span v-else class="text-text-muted">[OFFLINE]</span>
  </div>
</template>
