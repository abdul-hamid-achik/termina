<script setup lang="ts">
/**
 * Floating combat numbers — the primary MOBA "what just happened" feedback that
 * a 4s batched tick + a scrolling text log otherwise hides. Each entry rises and
 * fades once; the parent (GameScreen) pushes entries on `damage` events involving
 * the local player and prunes them after the animation. Color-coded: damage TAKEN
 * is dire-red, damage DEALT is radiant-green.
 */
export interface DamageFloatEntry {
  id: number
  amount: number
  kind: 'taken' | 'dealt'
}

defineProps<{ floats: DamageFloatEntry[] }>()
</script>

<template>
  <div
    class="pointer-events-none absolute inset-x-0 top-[28%] z-30 flex flex-col items-center gap-0.5"
    data-testid="damage-floats"
    aria-hidden="true"
  >
    <span
      v-for="f in floats"
      :key="f.id"
      class="anim-dmg-float font-mono text-2xl font-bold tracking-tight"
      :class="f.kind === 'taken' ? 'text-dire text-glow-dire' : 'text-radiant text-glow-radiant'"
      :data-testid="`damage-float-${f.kind}`"
      >{{ f.kind === 'taken' ? '-' : '' }}{{ f.amount }}</span
    >
  </div>
</template>
