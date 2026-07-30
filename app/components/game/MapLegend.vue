<script setup lang="ts">
/**
 * Collapsible key for the AsciiMap glyphs. The map packs a lot of meaning into
 * terse symbols (►YOU, ◉ ward, ✦ cache, ↻ Tenant respawn…) which a new player has
 * no way to decode — this spells them out. Native <details> so it stays closed by
 * default (no clutter), needs no JS state, and is keyboard/screen-reader friendly.
 */
// `open` lets a parent/story render it expanded; defaults to collapsed in-game.
defineProps<{ open?: boolean }>()

const LEGEND: { harden: string; meaning: string }[] = [
  { harden: '►YOU', meaning: 'your hero' },
  { harden: '+N A', meaning: 'allies here' },
  { harden: '!N E', meaning: 'enemies here' },
  { harden: '✓ / ✗', meaning: 'ice up / razed' },
  { harden: '◈ %', meaning: 'Mainframe (HP)' },
  { harden: '◈✗', meaning: 'Mainframe razed' },
  { harden: '☠', meaning: 'Tenant pit' },
  { harden: '↻ Nt', meaning: 'Tenant respawn' },
  { harden: '✦', meaning: 'live cache' },
  { harden: '◉', meaning: 'your ward' },
  { harden: '☘ N', meaning: 'neutral camp' },
  { harden: 'cN', meaning: 'lane creeps' },
]

// Zone codes used by the compact map's mini overview grid (see AsciiMap).
const ZONE_CODES: { harden: string; meaning: string }[] = [
  { harden: 'T1-3', meaning: 'ice zones (T/M/B lane)' },
  { harden: 'JG', meaning: 'jungle' },
  { harden: 'RN', meaning: 'cache spot' },
  { harden: 'ROS', meaning: 'Tenant pit' },
  { harden: 'RF/RB', meaning: 'fountain / base' },
  { harden: 'TR/MR/BR', meaning: 'river crossings' },
]
</script>

<template>
  <details class="text-[0.6rem] text-text-dim" data-testid="map-legend" :open="open">
    <summary class="cursor-pointer select-none tracking-wider uppercase hover:text-text-primary">
      legend
    </summary>
    <div class="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-3">
      <span v-for="item in LEGEND" :key="item.harden" :data-testid="`legend-${item.harden}`">
        <span class="font-mono text-text-primary">{{ item.harden }}</span> {{ item.meaning }}
      </span>
    </div>
    <div class="mt-1 border-t border-border/40 pt-1">
      <div class="uppercase tracking-wider opacity-70">overview zone codes</div>
      <div class="mt-0.5 grid grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-3">
        <span v-for="item in ZONE_CODES" :key="item.harden" :data-testid="`legend-${item.harden}`">
          <span class="font-mono text-text-primary">{{ item.harden }}</span> {{ item.meaning }}
        </span>
      </div>
    </div>
  </details>
</template>
