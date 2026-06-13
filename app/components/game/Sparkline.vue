<script setup lang="ts">
import { computed } from 'vue'
import { sparkline } from '~/utils/strategy'

const props = withDefaults(
  defineProps<{
    values: number[]
    /** CSS custom-property name for the line colour, e.g. 'color-gold'. */
    colorVar?: string
  }>(),
  { colorVar: 'color-gold' },
)

const spark = computed(() => sparkline(props.values))
</script>

<template>
  <span
    data-testid="sparkline"
    class="font-mono leading-none tracking-tighter"
    :style="{ color: `rgb(var(--${colorVar}))` }"
    aria-hidden="true"
    >{{ spark }}</span
  >
</template>
