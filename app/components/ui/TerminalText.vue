<script setup lang="ts">
defineProps<{
  color?: string
  bold?: boolean
  dim?: boolean
}>()
</script>

<template>
  <span
    class="font-mono"
    :class="{ 'font-bold': bold, 'opacity-60': dim }"
    :style="color ? { color: `rgb(var(--color-${color}, ${color}))` } : undefined"
  >
    <slot />
  </span>
</template>
