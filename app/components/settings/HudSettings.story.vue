<script setup lang="ts">
import { useSettingsStore } from '~/stores/settings'
import HudSettings from './HudSettings.vue'

// histoire.setup.ts installs Pinia, so useSettingsStore() resolves. Each
// Variant seeds the store via :setup-app to show a different HUD preset.
function seedStandard() {
  useSettingsStore().applyHudPreset('standard')
}
function seedTactical() {
  useSettingsStore().applyHudPreset('tactical')
}
function seedFocus() {
  useSettingsStore().applyHudPreset('focus')
}
function seedCustom() {
  const s = useSettingsStore()
  s.applyHudPreset('standard')
  s.setHud('layoutMode', 'map-centric')
  s.setHud('emphasizeVitals', true)
}
</script>

<template>
  <Story title="Settings/HudSettings">
    <Variant title="standard (default)" :setup-app="seedStandard">
      <div class="bg-bg-primary p-3" style="width: 360px">
        <HudSettings />
      </div>
    </Variant>

    <Variant title="tactical preset" :setup-app="seedTactical">
      <div class="bg-bg-primary p-3" style="width: 360px">
        <HudSettings />
      </div>
    </Variant>

    <Variant title="focus preset" :setup-app="seedFocus">
      <div class="bg-bg-primary p-3" style="width: 360px">
        <HudSettings />
      </div>
    </Variant>

    <Variant title="custom (mixed toggles)" :setup-app="seedCustom">
      <div class="bg-bg-primary p-3" style="width: 360px">
        <HudSettings />
      </div>
    </Variant>
  </Story>
</template>
