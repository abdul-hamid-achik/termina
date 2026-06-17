<script setup lang="ts">
/**
 * Floating combat numbers — the primary MOBA "what just happened" feedback that
 * a 4s batched tick + a scrolling text log otherwise hides. Each entry rises and
 * fades once; the parent (GameScreen) pushes entries on `damage`/`heal` events
 * involving the local player and prunes them after the animation. Color-coded:
 * damage TAKEN is dire-red (-N), DEALT is radiant-green (N), HEALING is teal (+N).
 */
export interface DamageFloatEntry {
  id: number
  amount: number
  kind: 'taken' | 'dealt' | 'heal'
}

defineProps<{ floats: DamageFloatEntry[] }>()

function floatClass(kind: DamageFloatEntry['kind']): string {
  if (kind === 'taken') return 'text-dire text-glow-dire'
  if (kind === 'heal') return 'text-healing'
  return 'text-radiant text-glow-radiant' // dealt
}

function floatPrefix(kind: DamageFloatEntry['kind']): string {
  if (kind === 'taken') return '-'
  if (kind === 'heal') return '+'
  return ''
}
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
      :class="floatClass(f.kind)"
      :data-testid="`damage-float-${f.kind}`"
      >{{ floatPrefix(f.kind) }}{{ f.amount }}</span
    >
  </div>
</template>
