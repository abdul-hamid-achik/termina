<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    value: number
    max?: number
    color?: string
    width?: number
    showLabel?: boolean
  }>(),
  {
    max: 100,
    color: 'radiant',
    width: 20,
    showLabel: false,
  },
)

const filled = computed(() => {
  const ratio = Math.max(0, Math.min(1, props.value / props.max))
  return Math.round(ratio * props.width)
})

const empty = computed(() => props.width - filled.value)

const bar = computed(() => {
  return '█'.repeat(filled.value) + '░'.repeat(empty.value)
})

const percentage = computed(() => {
  return Math.round((props.value / props.max) * 100)
})
</script>

<template>
  <span class="progress-bar">
    <span class="progress-bar__bracket">[</span>
    <span
      class="progress-bar__fill"
      :style="{ color: `var(--color-${color}, ${color})` }"
    >{{ bar }}</span>
    <span class="progress-bar__bracket">]</span>
    <span v-if="showLabel" class="progress-bar__label">
      {{ value }}/{{ max }}
      <span class="progress-bar__pct">({{ percentage }}%)</span>
    </span>
  </span>
</template>

<style scoped>
.progress-bar {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.progress-bar__bracket {
  color: var(--text-dim);
}

.progress-bar__fill {
  letter-spacing: -0.05em;
}

.progress-bar__label {
  color: var(--text-primary);
  font-size: 0.75rem;
}

.progress-bar__pct {
  color: var(--text-dim);
}
</style>
