<script setup lang="ts">
import type { HeroDef, HeroPosture, OperatorOrigin } from '~~/shared/types/hero'
import type { PlaystyleTag } from '~~/shared/heroPlaystyle'

defineProps<{
  hero: Pick<HeroDef, 'id' | 'name' | 'role' | 'posture'>
  /** The operator's real name (from CAST). */
  realName: string
  /** The operator's origin (street/corp). */
  origin: OperatorOrigin
  /** The operator's biography (from CAST). */
  bio: string
  /** Why the existing handle already fits (from CAST). */
  handleRationale: string
  /** Kit-identity tags (Burst/Control/…) from heroPlaystyleTags — optional. */
  tags?: PlaystyleTag[]
}>()
</script>

<template>
  <!-- id anchors the card so /lore#lore-<id> (the heroes console's reverse LORE
       link) scrolls straight to this operative; scroll-mt clears the header. -->
  <div
    :id="`lore-${hero.id}`"
    class="flex h-full scroll-mt-20 flex-col gap-1.5 border border-border bg-bg-secondary p-3"
  >
    <div class="flex items-baseline justify-between gap-2">
      <span class="text-[0.95rem] font-bold text-text-primary">{{ realName }}</span>
      <span class="t-caption text-text-dim">`{{ hero.id }}`</span>
    </div>
    <div class="flex flex-wrap gap-1">
      <span
        class="border border-chaff/40 bg-chaff/10 px-1 py-0.5 text-[0.58rem] uppercase tracking-wider text-chaff"
        :data-posture="hero.posture"
      >
        {{ hero.posture }}
      </span>
      <span
        class="border border-border px-1 py-0.5 text-[0.58rem] uppercase tracking-wider text-text-dim"
        :data-origin="origin"
      >
        {{ origin }}
      </span>
    </div>
    <!-- Kit identity at a glance — how the hero plays beyond its posture. -->
    <div v-if="tags && tags.length" class="flex flex-wrap gap-1" data-testid="lore-playstyle">
      <span
        v-for="t in tags"
        :key="t"
        class="border border-ability/40 bg-ability/10 px-1 py-0.5 text-[0.58rem] uppercase tracking-wider text-ability"
      >
        {{ t }}
      </span>
    </div>
    <p class="text-[0.78rem] leading-relaxed text-text-dim">{{ bio }}</p>
    <p class="text-[0.68rem] italic leading-relaxed text-text-dim">
      why the handle: {{ handleRationale }}
    </p>
    <!-- Funnel: read the bio → train this exact hero's kit (deep-links the
         /cast console to this operator via ?hero=). -->
    <NuxtLink
      :to="`/cast?hero=${hero.id}`"
      class="mt-auto pt-1 text-[0.7rem] text-ability no-underline hover:text-chaff"
      :aria-label="`Train ${hero.name} in the hero console`"
    >
      TRAIN {{ hero.name.toUpperCase() }} →
    </NuxtLink>
  </div>
</template>
