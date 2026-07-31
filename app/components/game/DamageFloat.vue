<script setup lang="ts">
/**
 * Floating combat numbers — the primary MOBA "what just happened" feedback that
 * a 4s batched tick + a scrolling text log otherwise hides. Each entry rises and
 * fades once; the parent (GameScreen) pushes entries on `damage`/`heal` events
 * involving the local player and prunes them after the animation. Color-coded:
 * damage TAKEN is audit-red (-N), DEALT is chaff-green (N), HEALING is teal
 * (+N), SCRIP is amber (+Nsc) — last-hit income is a reward, not a hit, so it
 * carries the currency suffix to stay unmistakable next to a damage number.
 *
 * Numbers rise in two lanes: what happens TO you on the side the HUD keeps your
 * vitals, what you do to someone else on the side it keeps the zone. GameScreen
 * renders one instance per lane and splits the entries by `anchor`.
 */
export interface DamageFloatEntry {
  id: number
  amount: number
  kind: 'taken' | 'dealt' | 'heal' | 'scrip'
  /** Which lane this number belongs to (see the component's `anchor` prop). */
  anchor?: 'self' | 'target'
}

withDefaults(defineProps<{ floats: DamageFloatEntry[]; anchor?: 'self' | 'target' }>(), {
  anchor: 'target',
})

/* Roughly over the rail that holds Hero Status and the TRACE column on
   desktop. Anchoring to the panels themselves is not possible without
   measuring them: they swap columns per breakpoint, and both live inside
   `overflow: auto` bodies that would clip a float. */
const LANE: Record<'self' | 'target', string> = {
  self: 'right-[8%] top-[44%]',
  target: 'left-[12%] top-[26%]',
}

/**
 * Rendered as a flex column, pruning the oldest float made every surviving one
 * jump upward mid-animation, so a number's position carried no information at
 * all. Absolute placement plus an offset derived from the entry id keeps each
 * float still from birth to death, whatever happens to its neighbours.
 */
function offsetStyle(id: number, anchor: 'self' | 'target'): Record<string, string> {
  // Grow INBOARD from whichever edge the lane is anchored to. A left offset on
  // the right-anchored self lane pushed the number past the grid edge and it was
  // clipped away entirely on any viewport below ~1025px.
  const dx = `${((id * 37) % 56) - 28}px`
  const top = `${(id * 23) % 40}px`
  return anchor === 'self' ? { right: dx, top } : { left: dx, top }
}

function floatClass(kind: DamageFloatEntry['kind']): string {
  if (kind === 'taken') return 'text-audit text-glow-audit'
  if (kind === 'heal') return 'text-healing'
  if (kind === 'scrip') return 'text-gold text-glow-gold'
  return 'text-chaff text-glow-chaff' // dealt
}

function floatPrefix(kind: DamageFloatEntry['kind']): string {
  if (kind === 'taken') return '-'
  if (kind === 'heal' || kind === 'scrip') return '+'
  return ''
}

function floatSuffix(kind: DamageFloatEntry['kind']): string {
  return kind === 'scrip' ? 'sc' : ''
}
</script>

<template>
  <div
    class="pointer-events-none absolute z-30"
    :class="LANE[anchor]"
    data-testid="damage-floats"
    :data-anchor="anchor"
    aria-hidden="true"
  >
    <span
      v-for="f in floats"
      :key="f.id"
      class="anim-dmg-float absolute font-mono text-2xl font-bold tracking-tight whitespace-nowrap"
      :class="floatClass(f.kind)"
      :style="offsetStyle(f.id, anchor)"
      :data-testid="`damage-float-${f.kind}`"
      >{{ floatPrefix(f.kind) }}{{ f.amount }}{{ floatSuffix(f.kind) }}</span
    >
  </div>
</template>
