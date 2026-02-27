<script setup lang="ts">
defineProps<{
  color?: string
  bold?: boolean
  dim?: boolean
}>()
</script>

<template>
  <span
    class="terminal-text"
    :class="{ 'terminal-text--bold': bold, 'terminal-text--dim': dim }"
    :style="color ? { color: `var(--color-${color}, ${color})` } : undefined"
  >
    <slot />
  </span>
</template>

<style scoped>
.terminal-text {
  font-family: var(--font-mono);
}

.terminal-text--bold {
  font-weight: 700;
}

.terminal-text--dim {
  opacity: 0.6;
}
</style>
