<script setup lang="ts">
import { useSettingsStore } from '~/stores/settings'
import HudSettings from './HudSettings.vue'

// histoire.setup.ts installs Pinia, so useSettingsStore() resolves. Each
// Variant seeds the surviving field (density) to show both states.
function seedComfortable() {
  useSettingsStore().setHud('density', 'comfortable')
}
function seedCompact() {
  useSettingsStore().setHud('density', 'compact')
}
</script>

<template>
  <Story title="Settings/HudSettings">
    <Variant title="comfortable (default)" :setup-app="seedComfortable">
      <div class="bg-bg-primary p-3" style="width: 360px">
        <HudSettings />
      </div>
    </Variant>
    <Variant title="compact" :setup-app="seedCompact">
      <div class="bg-bg-primary p-3" style="width: 360px">
        <HudSettings />
      </div>
    </Variant>
  </Story>
</template>
