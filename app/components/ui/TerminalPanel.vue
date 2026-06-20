<script setup lang="ts">
defineProps<{
  title?: string
  variant?: 'default' | 'highlight' | 'danger'
}>()
</script>

<template>
  <div
    class="flex min-w-0 flex-col overflow-hidden border border-border bg-bg-panel"
    :class="{
      'border-border-glow shadow-glow-highlight': variant === 'highlight',
      'border-dire shadow-glow-dire-soft': variant === 'danger',
    }"
  >
    <div
      v-if="title"
      class="flex h-6 items-center overflow-hidden border-b border-border bg-bg-secondary px-2 text-xs select-none"
    >
      <span class="shrink-0 text-text-dim">┌─</span>
      <span class="truncate px-1.5 font-bold uppercase tracking-wide text-ability">{{
        title
      }}</span>
      <span class="flex-1 overflow-hidden text-right text-text-dim">─┐</span>
    </div>
    <div class="flex-1 overflow-auto p-2">
      <slot />
    </div>
  </div>
</template>
