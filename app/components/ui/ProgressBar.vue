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
  <span class="inline-flex items-center gap-1 whitespace-nowrap font-mono text-[0.8rem]">
    <span class="text-text-dim">[</span>
    <span class="tracking-[-0.05em]" :style="{ color: `rgb(var(--color-${color}, ${color}))` }">{{
      bar
    }}</span>
    <span class="text-text-dim">]</span>
    <span v-if="showLabel" class="text-text-primary text-xs">
      {{ value }}/{{ max }}
      <span class="text-text-dim">({{ percentage }}%)</span>
    </span>
  </span>
</template>
