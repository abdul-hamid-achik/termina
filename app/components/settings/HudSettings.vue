<script setup lang="ts">
import { useSettingsStore } from '~/stores/settings'
import type { Density } from '~/stores/settings'

// Client-side HUD preferences panel. After R3 there is ONE layout and ONE
// surviving preference: density. The colourblind palette, the focus banner,
// the roster toggle and layoutMode are gone (the terminal has one form).
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
  </div>
</template>
