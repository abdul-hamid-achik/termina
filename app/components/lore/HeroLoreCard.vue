<script setup lang="ts">
import type { HeroDef, HeroRole } from '~~/shared/types/hero'

defineProps<{ hero: Pick<HeroDef, 'name' | 'role' | 'lore'> }>()

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
  <div class="flex h-full flex-col gap-1.5 border border-border bg-bg-secondary p-3">
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
  </div>
</template>
