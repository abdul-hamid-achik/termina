<script setup lang="ts">
defineProps<{
  title?: string
  variant?: 'default' | 'highlight' | 'danger'
}>()
</script>

<template>
  <div
    class="terminal-panel"
    :class="{
      'terminal-panel--highlight': variant === 'highlight',
      'terminal-panel--danger': variant === 'danger',
    }"
  >
    <div v-if="title" class="terminal-panel__header">
      <span class="terminal-panel__corner">┌─</span>
      <span class="terminal-panel__title">{{ title }}</span>
      <span class="terminal-panel__line">─┐</span>
    </div>
    <div class="terminal-panel__body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.terminal-panel {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.terminal-panel--highlight {
  border-color: var(--border-glow);
  box-shadow: 0 0 6px rgba(42, 42, 78, 0.4);
}

.terminal-panel--danger {
  border-color: var(--color-dire);
  box-shadow: 0 0 6px rgba(233, 69, 96, 0.2);
}

.terminal-panel__header {
  display: flex;
  align-items: center;
  padding: 0 8px;
  height: 24px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  font-size: 0.75rem;
  user-select: none;
  overflow: hidden;
}

.terminal-panel__corner {
  color: var(--text-dim);
  flex-shrink: 0;
}

.terminal-panel__title {
  color: var(--color-ability);
  padding: 0 6px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.terminal-panel__line {
  color: var(--text-dim);
  flex: 1;
  overflow: hidden;
  text-align: right;
}

.terminal-panel__body {
  flex: 1;
  overflow: auto;
  padding: 8px;
}
</style>
