<script setup lang="ts">
import { useSettingsStore } from '~/stores/settings'
import type { Density } from '~/stores/settings'

// Client-side HUD preferences panel. After R3 there is ONE layout; density and
// the coach are the two surviving preferences. The colourblind palette, the
// focus banner, the roster toggle and layoutMode are gone (the terminal has one
// form).
const settings = useSettingsStore()

const DENSITIES: { id: Density; label: string }[] = [
  { id: 'comfortable', label: 'Comfortable' },
  { id: 'compact', label: 'Compact' },
]
</script>

<template>
  <div class="flex flex-col gap-4 font-mono text-[0.8rem]" data-testid="hud-settings">
    <!-- Density -->
    <div class="flex flex-col gap-1.5">
      <span class="text-[0.7rem] uppercase tracking-wider text-text-dim">Density</span>
      <div class="grid grid-cols-2 gap-1.5">
        <button
          v-for="d in DENSITIES"
          :key="d.id"
          class="border px-2 py-1.5 text-[0.76rem] font-bold transition-all active:scale-[0.98]"
          :class="
            settings.hud.density === d.id
              ? 'border-chaff bg-chaff/10 text-chaff'
              : 'border-border text-text-primary hover:border-border-glow'
          "
          :data-testid="`hud-density-${d.id}`"
          :aria-pressed="settings.hud.density === d.id"
          @click="settings.setHud('density', d.id)"
        >
          {{ d.label }}
        </button>
      </div>
    </div>

    <!-- Coach -->
    <div class="flex flex-col gap-1.5">
      <span class="text-[0.7rem] uppercase tracking-wider text-text-dim">Coach</span>
      <button
        class="flex items-center justify-between border px-2 py-1.5 text-left text-[0.76rem] transition-all active:scale-[0.98]"
        :class="
          settings.hud.coach
            ? 'border-chaff bg-chaff/10 text-chaff'
            : 'border-border text-text-primary hover:border-border-glow'
        "
        data-testid="hud-coach-toggle"
        :aria-pressed="settings.hud.coach"
        @click="settings.setHud('coach', !settings.hud.coach)"
      >
        <span class="font-bold">{{ settings.hud.coach ? 'ON' : 'OFF' }}</span>
        <span class="text-[0.68rem] text-text-dim">tips in the stream</span>
      </button>
      <p class="text-[0.68rem] leading-relaxed text-text-muted">
        Situational advice while you play — why to last-hit, when to pull back, what to buy. Each
        lesson retires the moment you show you know it, so it goes quiet on its own.
      </p>
    </div>
  </div>
</template>
