<script setup lang="ts">
/**
 * Collapsible key for the AsciiMap glyphs. The map packs a lot of meaning into
 * terse symbols (►YOU, ◉ ward, ✦ rune, ↻ Roshan respawn…) which a new player has
 * no way to decode — this spells them out. Native <details> so it stays closed by
 * default (no clutter), needs no JS state, and is keyboard/screen-reader friendly.
 */
// `open` lets a parent/story render it expanded; defaults to collapsed in-game.
defineProps<{ open?: boolean }>()

const LEGEND: { glyph: string; meaning: string }[] = [
  { glyph: '►YOU', meaning: 'your hero' },
  { glyph: '+N A', meaning: 'allies here' },
  { glyph: '!N E', meaning: 'enemies here' },
  { glyph: '✓ / ✗', meaning: 'tower up / razed' },
  { glyph: '◈ %', meaning: 'ancient (HP)' },
  { glyph: '☠', meaning: 'Roshan pit' },
  { glyph: '↻ Nt', meaning: 'Roshan respawn' },
  { glyph: '✦', meaning: 'live rune' },
  { glyph: '◉', meaning: 'your ward' },
  { glyph: '☘ N', meaning: 'neutral camp' },
  { glyph: 'cN', meaning: 'lane creeps' },
]
</script>

<template>
  <details class="text-[0.6rem] text-text-dim" data-testid="map-legend" :open="open">
    <summary class="cursor-pointer select-none tracking-wider uppercase hover:text-text-primary">
      legend
    </summary>
    <div class="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-3">
      <span v-for="item in LEGEND" :key="item.glyph" :data-testid="`legend-${item.glyph}`">
        <span class="font-mono text-text-primary">{{ item.glyph }}</span> {{ item.meaning }}
      </span>
    </div>
  </details>
</template>
