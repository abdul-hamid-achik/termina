<script setup lang="ts">
/**
 * One-shot phosphor overlay. Keyed by `seq` so the same kind can retrigger.
 * Resting opacity is 0 so prefers-reduced-motion (animation: none) paints nothing.
 */
export type FxKind = 'cycle' | 'cast' | 'buy' | 'scan' | 'harden' | 'strip' | 'kill' | 'ice'

defineProps<{
  kind: FxKind
  seq: number
}>()
</script>

<template>
  <div
    v-if="seq > 0"
    :key="`${kind}-${seq}`"
    class="pointer-events-none absolute inset-0 z-[17]"
    :class="`anim-fx-${kind}`"
    :data-testid="`fx-${kind}`"
    aria-hidden="true"
  />
</template>
