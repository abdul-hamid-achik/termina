<script setup lang="ts">
import { computed } from 'vue'
import type { TraceModel } from '~/components/game/traceModel'
import { computeThreat, recommendAction } from '~/utils/tactics'
import { formatTickClock } from '~/utils/gameClock'

/**
 * The always-on one-liners that replaced the panel chrome (R3-08): hop +
 * threat, net lead, and the tick clock. Three lines, no borders, no panels —
 * the stream owns the full column.
 */
const props = defineProps<{
  trace: TraceModel
  /** Local player INTEG fraction (0..1). */
  hpFraction: number
  alive: boolean
  /** Net lead text (e.g. "CHF +1.2k" or "even"). */
  netLead: string
  /** Ticks until the next cycle commits. */
  nextTickIn: number
  tick: number
  canAct: boolean
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

const clockLine = computed(() => {
  const t = formatTickClock(props.tick, true)
  return props.canAct ? `${t} · AWAITING ORDERS` : `${t} · resolving in ${props.nextTickIn}s`
})
</script>

<template>
  <div
    class="flex flex-col gap-0.5 border-b border-border px-2 py-1 font-mono t-hud-sm"
    data-testid="status-lines"
  >
    <div class="flex justify-between gap-2">
      <span class="text-chaff" data-testid="status-hop">{{ hopLine }}</span>
      <span class="text-gold" data-testid="status-net">NET {{ netLead }}</span>
    </div>
    <div class="flex justify-between gap-2 text-text-dim">
      <span data-testid="status-clock">{{ clockLine }}</span>
    </div>
  </div>
</template>
