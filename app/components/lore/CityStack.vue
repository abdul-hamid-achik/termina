<script setup lang="ts">
/**
 * The city, as a section.
 *
 * The four districts were named mid-sentence in a paragraph — "LANDING on the
 * cable heads, ROOKERY stacked above it, COLDSTORE in the racks, SHALLOWS where
 * the fibre thins out" — which is a lovely line and completely fails to convey
 * that this is a STACK. TERMINA grew vertically on top of a cable landing;
 * that is the shape of the place and the reason the districts are what they are.
 *
 * Drawn top-down so the reading order IS the geography: you start where the
 * ground is cheap and end at the cable heads the whole city exists for.
 *
 * Data is not sourced from DISTRICTS because the order here is the physical
 * stack, not the constant's declaration order, and each entry carries prose the
 * constant does not hold. The test asserts the two stay in sync.
 */
const STACK = [
  {
    name: 'SHALLOWS',
    depth: 'edge',
    line: 'Where the fibre thins out and the ground gets cheap. Nobody is protecting it.',
  },
  {
    name: 'COLDSTORE',
    depth: 'racks',
    line: 'The racks. Climate-controlled, humming, and worth more than the people in it.',
  },
  {
    name: 'ROOKERY',
    depth: 'stacked',
    line: 'Built upward on top of the landing, one storey at a time, by whoever needed the room.',
  },
  {
    name: 'LANDING',
    depth: 'cable heads',
    line: 'Where the twelve trunks come ashore and stop. The reason there is a city at all.',
  },
] as const
</script>

<template>
  <figure class="my-1 flex flex-col font-mono" data-testid="city-stack">
    <figcaption class="sr-only">
      The districts of TERMINA, from the cheap ground at the edge down to the cable heads.
    </figcaption>
    <div
      v-for="(d, i) in STACK"
      :key="d.name"
      class="flex items-baseline gap-2.5 border-l-2 py-1.5 pl-3"
      :class="i === STACK.length - 1 ? 'border-chaff' : 'border-border'"
    >
      <span
        class="w-[5.5rem] shrink-0 text-[0.78rem] font-bold tracking-widest"
        :class="i === STACK.length - 1 ? 'text-chaff' : 'text-text-primary'"
        >{{ d.name }}</span
      >
      <span class="w-[5.5rem] shrink-0 text-[0.66rem] uppercase tracking-wider text-text-muted">{{
        d.depth
      }}</span>
      <span class="text-[0.76rem] leading-relaxed text-text-dim">{{ d.line }}</span>
    </div>
  </figure>
</template>
