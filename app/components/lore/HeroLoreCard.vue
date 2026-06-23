<script setup lang="ts">
import type { HeroDef, HeroRole } from '~~/shared/types/hero'

defineProps<{ hero: Pick<HeroDef, 'id' | 'name' | 'role' | 'lore'> }>()

// Role → theme colour, so the roster reads at a glance.
const roleColor: Record<HeroRole, string> = {
  carry: 'text-gold',
  mage: 'text-ability',
  assassin: 'text-dire',
  tank: 'text-radiant',
  support: 'text-radiant',
  offlaner: 'text-ability',
}
</script>

<template>
  <!-- id anchors the card so /lore#lore-<id> (the heroes console's reverse LORE
       link) scrolls straight to this operative; scroll-mt clears the header. -->
  <div
    :id="`lore-${hero.id}`"
    class="flex h-full scroll-mt-20 flex-col gap-1.5 border border-border bg-bg-secondary p-3"
  >
    <div class="flex items-baseline justify-between gap-2">
      <span class="text-[0.95rem] font-bold text-text-primary">{{ hero.name }}</span>
      <span
        class="text-[0.62rem] uppercase tracking-widest"
        :class="roleColor[hero.role] ?? 'text-text-dim'"
      >
        {{ hero.role }}
      </span>
    </div>
    <p class="text-[0.78rem] leading-relaxed text-text-dim">{{ hero.lore }}</p>
    <!-- Funnel: read the lore → train this exact hero's kit (deep-links the
         /heroes console to this operative via ?hero=). -->
    <NuxtLink
      :to="`/heroes?hero=${hero.id}`"
      class="mt-auto pt-1 text-[0.7rem] text-ability no-underline hover:text-radiant"
      :aria-label="`Train ${hero.name} in the hero console`"
    >
      &gt; TRAIN {{ hero.name }}
    </NuxtLink>
  </div>
</template>
