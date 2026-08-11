<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { TraceModel } from '~/components/game/traceModel'
import { computeThreat, recommendAction } from '~/utils/tactics'

/**
 * The always-on one-liners that replaced the panel chrome (R3-08): hop +
 * threat, net lead, and the persistent cycle clock. Three lines, no borders,
 * no panels — the stream owns the full column.
 */
const props = defineProps<{
  trace: TraceModel
  /** Local player INTEG fraction (0..1). */
  hpFraction: number
  alive: boolean
  cycle: number
  /** Epoch ms when the current cycle window commits, or null before the first
   *  cycle_state has arrived. */
  nextCommitAt: number | null
  /** Whether an order is queued for the current cycle window. */
  orderCommitted: boolean
  /** Stops the countdown interval — the match is over, nothing left to time. */
  gameOver: boolean
  enemyCount: number
  allyHeadcount: number
  enemyIcePresent: boolean
  hasReadyAbility: boolean
}>()

const hopLine = computed(() => {
  const active = props.trace.routes.find((r) => r.active)
  const threat = computeThreat(props.enemyCount, props.allyHeadcount, props.enemyIcePresent)
  const action = recommendAction({
    alive: props.alive,
    hpFraction: props.hpFraction,
    threat,
    hasReadyAbility: props.hasReadyAbility,
  })
  const route = active
    ? `${active.name.toUpperCase()} hop ${active.depth + 1}/${active.total}`
    : 'off route'
  return `${route} · ${threat.label} · ${action}`
})

// ── Persistent cycle clock ─────────────────────────────────────────
//
// The audit's #1 gameplay-UX gap: the HUD computed cycle timing internally
// but never rendered a clock — a player facing "AWAITING ORDERS" had no idea
// how much of the 4s window was left. This ticks a local `now` ref at ~10Hz
// (1Hz under reduced motion — the countdown still updates, just without the
// rapid-fire re-render) so `remainingSeconds` stays live between cycle_state
// arrivals, purely from the server-anchored `nextCommitAt` epoch prop.
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  )
}

function stopClockTimer() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

function startClockTimer() {
  stopClockTimer()
  if (props.gameOver) return
  const intervalMs = prefersReducedMotion() ? 1000 : 100
  timer = setInterval(() => {
    now.value = Date.now()
  }, intervalMs)
}

onMounted(startClockTimer)
onUnmounted(stopClockTimer)
watch(
  () => props.gameOver,
  (over) => {
    if (over) stopClockTimer()
    else startClockTimer()
  },
)

const remainingSeconds = computed(() => {
  if (props.nextCommitAt == null) return 0
  return Math.max(0, props.nextCommitAt - now.value) / 1000
})
</script>

<template>
  <div
    class="flex flex-col gap-0.5 border-b border-border px-2 py-1 font-mono t-hud-sm"
    data-testid="status-lines"
  >
    <div class="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
      <span class="min-w-0 flex-1 break-words text-chaff" data-testid="status-hop">{{
        hopLine
      }}</span>
      <!-- NET lives in GameStateBar (the always-on macro row) — repeating it
           here read as a bug in the first playtest. -->
    </div>
    <div class="flex min-w-0 justify-between gap-2 text-text-dim">
      <span class="min-w-0 break-words tabular-nums" data-testid="status-clock"
        >CYCLE {{ cycle }} ·
        <span
          :class="orderCommitted ? 'text-self' : 'text-text-dim'"
          data-testid="status-clock-state"
          >{{ orderCommitted ? 'COMMITTED' : 'OPEN' }}</span
        >
        · {{ remainingSeconds.toFixed(1) }}s</span
      >
    </div>
  </div>
</template>
