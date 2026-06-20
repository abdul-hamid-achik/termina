<script setup lang="ts">
import CombatLog from '~/components/game/CombatLog.vue'
import type { CombatLine } from '~/utils/combatLog'

// The combat narrative + its tick-heartbeat header. Extracted from GameScreen
// so it can occupy either the center stage (classic layout) or the side rail
// (map-centric layout) without duplicating the markup. Purely presentational —
// all live values are passed in.
defineProps<{
  events: CombatLine[]
  /** Header label: planning vs committed-and-waiting (e.g. AWAITING ORDERS). */
  status: string
  /** ASCII drain bar string for the 4s tick countdown. */
  bar: string
  /** The last ~1s before resolution — drives the warn pulse. */
  tickImminent: boolean
  /** ms until the next tick resolves (rendered as T-x.xs). */
  nextTickIn: number
  isAlive: boolean
  canAct: boolean
  /** Bump on each tick reveal to retrigger the header flash animation. */
  pulseKey: number
}>()
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <!-- Tick heartbeat header — drains over the 4s tick, flashes on reveal -->
    <div
      :key="pulseKey"
      class="anim-tick-pulse flex shrink-0 items-center gap-2 border-b border-border bg-bg-secondary/70 px-2 py-1 font-mono text-[0.72rem]"
      data-testid="theater-header"
    >
      <span
        class="font-bold tracking-wider"
        :class="
          !isAlive
            ? 'text-dire'
            : canAct
              ? tickImminent
                ? 'text-warn anim-glow-pulse'
                : 'text-ability'
              : 'text-gold anim-glow-pulse'
        "
        >&gt;&gt; {{ status }}</span
      >
      <span
        class="flex-1 truncate tracking-normal"
        :class="tickImminent ? 'text-warn' : 'text-ability'"
        aria-hidden="true"
        >{{ bar }}</span
      >
      <span class="shrink-0 text-text-dim">T-{{ (nextTickIn / 1000).toFixed(1) }}s</span>
    </div>
    <CombatLog class="min-h-0 flex-1" :events="events" />
  </div>
</template>
