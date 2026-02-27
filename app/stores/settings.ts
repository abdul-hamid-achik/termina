import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export type ThemeVariant = 'default' | 'green' | 'amber'
export type FontSize = 'small' | 'medium' | 'large'

export const useSettingsStore = defineStore('settings', () => {
  const audioEnabled = ref(true)
  const audioVolume = ref(0.5)
  const quickCastEnabled = ref(false)
  const theme = ref<ThemeVariant>('default')
  const fontSize = ref<FontSize>('medium')

  function load() {
    if (import.meta.server) return
    try {
      const raw = localStorage.getItem('termina:settings')
      if (!raw) return
      const data = JSON.parse(raw)
      if (typeof data.audioEnabled === 'boolean') audioEnabled.value = data.audioEnabled
      if (typeof data.audioVolume === 'number') audioVolume.value = data.audioVolume
      if (typeof data.quickCastEnabled === 'boolean') quickCastEnabled.value = data.quickCastEnabled
      if (data.theme) theme.value = data.theme
      if (data.fontSize) fontSize.value = data.fontSize
    } catch { /* ignore corrupt data */ }
  }

  function save() {
    if (import.meta.server) return
    localStorage.setItem('termina:settings', JSON.stringify({
      audioEnabled: audioEnabled.value,
      audioVolume: audioVolume.value,
      quickCastEnabled: quickCastEnabled.value,
      theme: theme.value,
      fontSize: fontSize.value,
    }))
  }

  // Auto-persist on change
  watch([audioEnabled, audioVolume, quickCastEnabled, theme, fontSize], save, { deep: true })

  // Load on init
  load()

  return {
    audioEnabled,
    audioVolume,
    quickCastEnabled,
    theme,
    fontSize,
    load,
    save,
  }
})
