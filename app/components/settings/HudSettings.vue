<script setup lang="ts">
import { computed } from 'vue'
import { useSettingsStore } from '~/stores/settings'
import type { HudPreset, LayoutMode, Density } from '~/stores/settings'

// Client-side HUD/layout preferences panel. Reads & writes useSettingsStore
// directly (the store auto-persists to localStorage). Lets a player compose
// their own in-game HUD across the three directions, or one-tap a preset.
const settings = useSettingsStore()

const PRESETS: { id: Exclude<HudPreset, 'custom'>; label: string; blurb: string }[] = [
  { id: 'standard', label: 'Standard', blurb: 'Classic combat-log layout' },
  { id: 'tactical', label: 'Tactical', blurb: 'Map-centric · compact · banner' },
  { id: 'focus', label: 'Focus', blurb: 'Action banner · big vitals' },
]

const LAYOUTS: { id: LayoutMode; label: string; blurb: string }[] = [
  { id: 'classic', label: 'Classic', blurb: 'Combat log is the centerpiece' },
  { id: 'map-centric', label: 'Tactical map', blurb: 'Map is the centerpiece, log a ticker' },
]

const DENSITIES: { id: Density; label: string }[] = [
  { id: 'comfortable', label: 'Comfortable' },
  { id: 'compact', label: 'Compact' },
]

const presetLabel = computed(() =>
  settings.hudPreset === 'custom'
    ? 'Custom'
    : settings.hudPreset.charAt(0).toUpperCase() + settings.hudPreset.slice(1),
)
</script>

<template>
  <div class="flex flex-col gap-4 font-mono text-[0.8rem]" data-testid="hud-settings">
    <!-- Presets -->
    <div class="flex flex-col gap-1.5">
      <div class="flex items-baseline justify-between">
        <span class="text-[0.7rem] uppercase tracking-wider text-text-dim">Preset</span>
        <span class="text-[0.7rem] text-ability" data-testid="hud-active-preset"
          >▸ {{ presetLabel }}</span
        >
      </div>
      <div class="grid grid-cols-3 gap-1.5">
        <button
          v-for="p in PRESETS"
          :key="p.id"
          class="flex flex-col gap-0.5 border px-2 py-1.5 text-left transition-all active:scale-[0.98]"
          :class="
            settings.hudPreset === p.id
              ? 'border-ability bg-ability/10 text-ability shadow-glow-ability'
              : 'border-border text-text-primary hover:border-border-glow hover:bg-border-glow/5'
          "
          :data-testid="`hud-preset-${p.id}`"
          :aria-pressed="settings.hudPreset === p.id"
          @click="settings.applyHudPreset(p.id)"
        >
          <span class="text-[0.78rem] font-bold uppercase">{{ p.label }}</span>
          <span class="text-[0.62rem] leading-tight text-text-dim">{{ p.blurb }}</span>
        </button>
      </div>
    </div>

    <!-- A · Layout -->
    <div class="flex flex-col gap-1.5 border-t border-border/50 pt-3">
      <span class="text-[0.7rem] uppercase tracking-wider text-text-dim">Layout</span>
      <div class="grid grid-cols-2 gap-1.5">
        <button
          v-for="l in LAYOUTS"
          :key="l.id"
          class="flex flex-col gap-0.5 border px-2 py-1.5 text-left transition-all active:scale-[0.98]"
          :class="
            settings.hud.layoutMode === l.id
              ? 'border-radiant bg-radiant/10 text-radiant'
              : 'border-border text-text-primary hover:border-border-glow'
          "
          :data-testid="`hud-layout-${l.id}`"
          :aria-pressed="settings.hud.layoutMode === l.id"
          @click="settings.setHud('layoutMode', l.id)"
        >
          <span class="text-[0.76rem] font-bold">{{ l.label }}</span>
          <span class="text-[0.62rem] leading-tight text-text-dim">{{ l.blurb }}</span>
        </button>
      </div>
    </div>

    <!-- B · Focus banner toggle -->
    <button
      class="flex items-center justify-between border border-border px-3 py-2 text-left transition-all hover:border-border-glow"
      data-testid="hud-toggle-focusBanner"
      :aria-pressed="settings.hud.focusBanner"
      @click="settings.setHud('focusBanner', !settings.hud.focusBanner)"
    >
      <span class="flex flex-col gap-0.5">
        <span class="text-[0.78rem] font-bold text-text-primary">Action focus banner</span>
        <span class="text-[0.62rem] text-text-dim">Threat verdict + what to do, pinned up top</span>
      </span>
      <span
        class="shrink-0 border px-2 py-0.5 text-[0.66rem] font-bold uppercase"
        :class="
          settings.hud.focusBanner
            ? 'border-gold text-gold text-glow-gold'
            : 'border-border text-text-dim'
        "
        >{{ settings.hud.focusBanner ? 'On' : 'Off' }}</span
      >
    </button>

    <!-- C · Density + emphasize vitals -->
    <div class="flex flex-col gap-1.5 border-t border-border/50 pt-3">
      <span class="text-[0.7rem] uppercase tracking-wider text-text-dim">Density</span>
      <div class="grid grid-cols-2 gap-1.5">
        <button
          v-for="d in DENSITIES"
          :key="d.id"
          class="border px-2 py-1.5 text-[0.76rem] font-bold transition-all active:scale-[0.98]"
          :class="
            settings.hud.density === d.id
              ? 'border-radiant bg-radiant/10 text-radiant'
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

    <button
      class="flex items-center justify-between border border-border px-3 py-2 text-left transition-all hover:border-border-glow"
      data-testid="hud-toggle-emphasizeVitals"
      :aria-pressed="settings.hud.emphasizeVitals"
      @click="settings.setHud('emphasizeVitals', !settings.hud.emphasizeVitals)"
    >
      <span class="flex flex-col gap-0.5">
        <span class="text-[0.78rem] font-bold text-text-primary">Emphasize vitals</span>
        <span class="text-[0.62rem] text-text-dim"
          >Bigger HP/mana + ability bar; recede the rest</span
        >
      </span>
      <span
        class="shrink-0 border px-2 py-0.5 text-[0.66rem] font-bold uppercase"
        :class="
          settings.hud.emphasizeVitals
            ? 'border-gold text-gold text-glow-gold'
            : 'border-border text-text-dim'
        "
        >{{ settings.hud.emphasizeVitals ? 'On' : 'Off' }}</span
      >
    </button>
  </div>
</template>
