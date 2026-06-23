<script setup lang="ts">
defineProps<{
  title?: string
  variant?: 'default' | 'highlight' | 'danger'
  /**
   * Element to render the title as. Defaults to a non-semantic 'span' so the
   * in-game HUD panels (and every existing caller) are unchanged; content pages
   * can opt the panel title into a real heading for a proper outline — h1 for a
   * single-panel page where the panel title IS the page heading (focused auth
   * cards), h2/h3 for section panels under a page-level heading.
   */
  titleAs?: 'span' | 'h1' | 'h2' | 'h3'
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
      <component
        :is="titleAs ?? 'span'"
        class="truncate px-1.5 font-bold uppercase tracking-wide text-ability"
      >
        {{ title }}
      </component>
      <span class="flex-1 overflow-hidden text-right text-text-dim">─┐</span>
    </div>
    <div class="flex-1 overflow-auto p-2">
      <slot />
    </div>
  </div>
</template>
