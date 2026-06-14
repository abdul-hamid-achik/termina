<script setup lang="ts">
import { computed } from 'vue'
import type { KillFeedEntry, KillCategory } from '~/utils/combatNarrative'

/**
 * Cinematic kill-feed banner — the loudest element on screen. Shows the recent
 * headline plays (first blood, multi-kills, shutdowns, Roshan, tower & Core
 * falls) for a few ticks, then they age out. Driven entirely by tick proximity
 * (no timers) so it's deterministic and test-friendly.
 */
const props = withDefaults(
  defineProps<{
    entries: KillFeedEntry[]
    currentTick: number
    /** How many ticks a headline stays on screen (~4s/tick). */
    window?: number
    /** Max simultaneous banners. */
    max?: number
  }>(),
  { window: 2, max: 3 },
)

const recent = computed(() => {
  const cutoff = props.currentTick - props.window
  return props.entries
    .filter((e) => e.tick >= cutoff && e.tick <= props.currentTick)
    .slice(-props.max)
})

const categoryClass: Record<KillCategory, string> = {
  hero: 'border-dire/60 text-dire bloom-dire',
  tower: 'border-gold/50 text-gold',
  roshan: 'border-gold/70 text-gold bloom-gold',
  core: 'border-gold/80 text-gold bloom-gold',
}

function entryKey(e: KillFeedEntry): string {
  return `${e.tick}-${e.category}-${e.killerId ?? ''}-${e.victimId ?? ''}`
}
</script>

<template>
  <div
    v-if="recent.length"
    data-testid="kill-feed"
    class="pointer-events-none flex flex-col items-center gap-1"
  >
    <div
      v-for="(e, i) in recent"
      :key="`${entryKey(e)}-${i}`"
      data-testid="kill-feed-entry"
      class="anim-pop flex items-center gap-2 border bg-bg-panel/90 px-3 py-1 font-mono text-sm font-bold tracking-wide whitespace-nowrap text-glow-sm"
      :class="categoryClass[e.category]"
    >
      <HeroAvatar
        v-if="e.killerHeroId"
        :hero-id="e.killerHeroId"
        :size="20"
        class="inline-flex shrink-0 align-middle"
      />
      <span>{{ e.text }}</span>
      <HeroAvatar
        v-if="e.victimHeroId"
        :hero-id="e.victimHeroId"
        :size="20"
        class="inline-flex shrink-0 align-middle opacity-70"
      />
    </div>
  </div>
</template>
