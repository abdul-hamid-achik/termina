import { watchEffect } from 'vue'
import { useSettingsStore } from '~/stores/settings'

/**
 * Sync the colorblind team-palette setting to a `.palette-colorblind` class on
 * <html>, so the Okabe-Ito blue/orange color override in terminal.css applies
 * app-wide (map, combat log, scoreboard, lobby…). Reactive: flips instantly when
 * the player toggles the setting, and applies on load from the persisted value.
 */
export default defineNuxtPlugin(() => {
  const settings = useSettingsStore()
  watchEffect(() => {
    document.documentElement.classList.toggle(
      'palette-colorblind',
      settings.teamPalette === 'colorblind',
    )
  })
})
