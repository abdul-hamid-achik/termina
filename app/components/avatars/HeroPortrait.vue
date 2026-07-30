<script setup lang="ts">
import { computed, ref } from 'vue'
import { CAST } from '~~/shared/constants/cast'
import { HEROES } from '~~/shared/constants/heroes'

/**
 * The operator portrait — an inked, monochrome-green render committed as an
 * asset (public/portraits/, generated once in the vault per R2-08). Same
 * public API the old avatar had: heroId + size. When the asset is missing the
 * frame falls back to the handle glyph so a 404 never renders a blank box.
 */
const props = withDefaults(defineProps<{ heroId: string; size?: number }>(), { size: 48 })

const failed = ref(false)

const src = computed(() =>
  props.size < 96 ? `/portraits/64/${props.heroId}.webp` : `/portraits/${props.heroId}.webp`,
)

const alt = computed(() => {
  const op = CAST[props.heroId as keyof typeof CAST]
  const hero = HEROES[props.heroId]
  if (op && hero) return `${op.realName} — ${hero.name}`
  return hero?.name ?? props.heroId
})
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center justify-center overflow-hidden border border-border bg-bg-secondary"
    :style="{ width: `${size}px`, height: `${size}px` }"
  >
    <img
      v-if="!failed"
      :src="src"
      :alt="alt"
      :width="size"
      :height="size"
      loading="lazy"
      decoding="async"
      class="h-full w-full object-cover"
      @error="failed = true"
    />
    <span
      v-else
      class="font-mono text-text-dim"
      :style="{ fontSize: `${Math.max(10, size / 3)}px` }"
    >
      {{ heroId.slice(0, 2).toUpperCase() }}
    </span>
  </span>
</template>
