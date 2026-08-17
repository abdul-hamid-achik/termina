<script setup lang="ts">
import { useSettingsStore } from '~/stores/settings'
import type { Density } from '~/stores/settings'

// Client-side HUD preferences panel. After R3 there is ONE layout; density,
// the coach, and the sound/music bed are the surviving preferences. The
// colourblind palette, the focus banner, the roster toggle and layoutMode are
// gone (the terminal has one form).
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

    <!-- Sound -->
    <div class="flex flex-col gap-1.5">
      <span class="text-[0.7rem] uppercase tracking-wider text-text-dim">Sound</span>
      <button
        class="flex items-center justify-between border px-2 py-1.5 text-left text-[0.76rem] transition-all active:scale-[0.98]"
        :class="
          settings.audioEnabled
            ? 'border-chaff bg-chaff/10 text-chaff'
            : 'border-border text-text-primary hover:border-border-glow'
        "
        data-testid="hud-audio-toggle"
        :aria-pressed="settings.audioEnabled"
        @click="settings.audioEnabled = !settings.audioEnabled"
      >
        <span class="font-bold">{{ settings.audioEnabled ? 'ON' : 'OFF' }}</span>
        <span class="text-[0.68rem] text-text-dim">cues + bed</span>
      </button>
      <label class="flex items-center gap-2 text-[0.68rem] text-text-dim">
        <span class="w-14 uppercase tracking-wider">Volume</span>
        <input
          type="range"
          min="0"
          max="100"
          step="5"
          class="h-1.5 flex-1 accent-chaff"
          data-testid="hud-audio-volume"
          :value="Math.round(settings.audioVolume * 100)"
          :disabled="!settings.audioEnabled"
          :aria-valuemin="0"
          :aria-valuemax="100"
          :aria-valuenow="Math.round(settings.audioVolume * 100)"
          @input="settings.audioVolume = Number(($event.target as HTMLInputElement).value) / 100"
        />
        <span class="w-8 text-right text-text-primary">{{
          Math.round(settings.audioVolume * 100)
        }}</span>
      </label>
    </div>

    <!-- Music -->
    <div class="flex flex-col gap-1.5">
      <span class="text-[0.7rem] uppercase tracking-wider text-text-dim">Music</span>
      <button
        class="flex items-center justify-between border px-2 py-1.5 text-left text-[0.76rem] transition-all active:scale-[0.98]"
        :class="
          settings.musicEnabled && settings.audioEnabled
            ? 'border-chaff bg-chaff/10 text-chaff'
            : 'border-border text-text-primary hover:border-border-glow'
        "
        data-testid="hud-music-toggle"
        :aria-pressed="settings.musicEnabled"
        :disabled="!settings.audioEnabled"
        @click="settings.musicEnabled = !settings.musicEnabled"
      >
        <span class="font-bold">{{ settings.musicEnabled ? 'ON' : 'OFF' }}</span>
        <span class="text-[0.68rem] text-text-dim">landing bed</span>
      </button>
      <p class="text-[0.68rem] leading-relaxed text-text-muted">
        A machine loop locked to the four-second cycle. It ducks when something happens so the cues
        stay readable.
      </p>
    </div>
  </div>
</template>
