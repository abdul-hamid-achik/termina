<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { CYCLE_DURATION_MS } from '~~/shared/constants/balance'

/**
 * The batch clock, running.
 *
 * The clock is the premise the whole game rests on — every instruction in the
 * city commits at once, four seconds wide, in no order — and the page explained
 * it in a paragraph. A paragraph cannot show you that instructions ACCUMULATE
 * and then land together; you have to watch it happen once, and then you have
 * it for good.
 *
 * So this runs on the real `CYCLE_DURATION_MS`: what a reader sees here is the
 * cadence they will be playing on, not an illustration of it.
 *
 * Honours `prefers-reduced-motion` by holding the committed frame — the frame
 * that carries the meaning — rather than by hiding the diagram.
 */
const CYCLE_MS = CYCLE_DURATION_MS
const SLOTS = 5

/** The instructions the fictional crews queue, in the order they arrive. */
const QUEUE = ['move seawall', 'attack wave:0', 'cast q', 'tap coldstore', 'buy edge_kit'] as const

const elapsed = ref(0)
const committed = ref(false)
let raf: number | null = null
let start = 0

const reduced = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

/** 0..1 through the current cycle. */
const progress = computed(() => Math.min(1, elapsed.value / CYCLE_MS))

/** How many instructions have been queued so far this cycle. */
const queued = computed(() =>
  committed.value ? SLOTS : Math.min(SLOTS, Math.floor(progress.value * (SLOTS + 0.6))),
)

const secondsLeft = computed(() => Math.max(0, Math.ceil((CYCLE_MS - elapsed.value) / 1000)))

function frame(now: number) {
  if (!start) start = now
  elapsed.value = now - start
  if (elapsed.value >= CYCLE_MS) {
    // The commit: everything lands together, held briefly so it reads.
    committed.value = true
    if (elapsed.value >= CYCLE_MS + 700) {
      start = now
      elapsed.value = 0
      committed.value = false
    }
  }
  raf = requestAnimationFrame(frame)
}

onMounted(() => {
  if (reduced()) {
    // Hold the frame that carries the idea: everything committed at once.
    elapsed.value = CYCLE_MS
    committed.value = true
    return
  }
  raf = requestAnimationFrame(frame)
})
onUnmounted(() => {
  if (raf !== null) cancelAnimationFrame(raf)
})
</script>

<template>
  <figure
    class="my-1 flex flex-col gap-2 border border-border bg-bg-secondary/40 p-3"
    data-testid="cycle-diagram"
  >
    <figcaption class="sr-only">
      A four-second cycle: five instructions queue, then all commit together in no order.
    </figcaption>

    <!-- The queue filling -->
    <ul class="flex flex-col gap-1 font-mono text-[0.72rem]" aria-hidden="true">
      <li
        v-for="(cmd, i) in QUEUE"
        :key="cmd"
        class="flex items-baseline gap-2 transition-all duration-200"
        :class="
          committed ? 'text-chaff' : i < queued ? 'text-text-primary' : 'text-text-muted opacity-30'
        "
      >
        <span class="w-4 shrink-0 text-right text-text-muted">{{ i + 1 }}</span>
        <span class="shrink-0">{{ committed ? '├─' : i < queued ? '│ ' : '  ' }}</span>
        <span class="whitespace-nowrap">{{ cmd }}</span>
        <span v-if="committed" class="text-chaff">✓</span>
        <span v-else-if="i < queued" class="text-text-muted">pending</span>
      </li>
    </ul>

    <!-- The clock itself -->
    <div class="flex items-center gap-2 border-t border-border/60 pt-2">
      <div class="h-1 flex-1 overflow-hidden bg-bg-primary" aria-hidden="true">
        <div
          class="h-full transition-none"
          :class="committed ? 'bg-chaff' : 'bg-chaff/45'"
          :style="{ width: `${(committed ? 1 : progress) * 100}%` }"
        />
      </div>
      <span
        class="t-mono-num shrink-0 text-[0.7rem]"
        :class="committed ? 'text-chaff' : 'text-text-dim'"
      >
        {{ committed ? 'COMMIT' : `${secondsLeft}s` }}
      </span>
    </div>

    <p class="text-[0.7rem] leading-relaxed text-text-muted">
      Nothing resolves while the cycle is open. When it closes, everything lands at once and in no
      order — so being fast is worth nothing, and being right is worth everything.
    </p>
  </figure>
</template>
