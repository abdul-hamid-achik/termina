<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  name: string
  hp: number
  maxHp: number
  /** Active damage-over-time stacks ticking on the dummy, for the status line. */
  dots?: number
  /** Control effects (stun/slow/…) on the dummy, shown as decaying chips. */
  statuses?: { label: string; ticksLeft: number }[]
}>()

const pct = computed(() =>
  props.maxHp > 0 ? Math.max(0, Math.min(100, Math.round((props.hp / props.maxHp) * 100))) : 0,
)
const destroyed = computed(() => props.hp <= 0)
// Health colour shifts radiant → gold → dire as the bar drains.
const barColor = computed(() =>
  pct.value <= 25 ? 'bg-dire' : pct.value <= 50 ? 'bg-gold' : 'bg-radiant',
)
</script>

<template>
  <div
    class="flex flex-col gap-1 border border-border bg-bg-secondary p-2.5"
    data-testid="target-dummy"
  >
    <div class="flex items-center justify-between text-[0.72rem]">
      <span class="font-bold text-text-primary">{{ name }}</span>
      <span :class="destroyed ? 'text-dire' : 'text-text-dim'">
        {{ destroyed ? 'DESTROYED' : `${Math.max(0, hp)} / ${maxHp} hp` }}
      </span>
    </div>
    <div class="h-2 w-full bg-bg-primary">
      <div
        class="h-full transition-all"
        :class="barColor"
        :style="{ width: `${pct}%` }"
        data-testid="target-dummy-bar"
      />
    </div>
    <div v-if="dots && dots > 0" class="text-[0.62rem] text-dire">
      &gt; {{ dots }} damage-over-time stack{{ dots > 1 ? 's' : '' }} active
    </div>
    <div
      v-if="statuses && statuses.length > 0"
      class="flex flex-wrap gap-1"
      data-testid="target-dummy-statuses"
    >
      <span
        v-for="(s, i) in statuses"
        :key="i"
        class="border border-gold/60 bg-gold/10 px-1 py-0.5 text-[0.6rem] uppercase tracking-wider text-gold"
      >
        {{ s.label }} · {{ s.ticksLeft }}t
      </span>
    </div>
  </div>
</template>
