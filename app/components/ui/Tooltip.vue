<script setup lang="ts">
import { ref } from 'vue'

withDefaults(
  defineProps<{
    text: string
    position?: 'top' | 'bottom' | 'left' | 'right'
  }>(),
  {
    position: 'top',
  },
)

const visible = ref(false)
</script>

<template>
  <span
    class="tooltip-wrapper"
    @mouseenter="visible = true"
    @mouseleave="visible = false"
  >
    <slot />
    <span
      v-show="visible"
      class="tooltip-popup"
      :class="`tooltip-popup--${position}`"
    >{{ text }}</span>
  </span>
</template>

<style scoped>
.tooltip-wrapper {
  position: relative;
  display: inline-flex;
}

.tooltip-popup {
  position: absolute;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 0.7rem;
  padding: 4px 8px;
  white-space: nowrap;
  z-index: 100;
  pointer-events: none;
}

.tooltip-popup--top {
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
}

.tooltip-popup--bottom {
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
}

.tooltip-popup--left {
  right: calc(100% + 6px);
  top: 50%;
  transform: translateY(-50%);
}

.tooltip-popup--right {
  left: calc(100% + 6px);
  top: 50%;
  transform: translateY(-50%);
}
</style>
