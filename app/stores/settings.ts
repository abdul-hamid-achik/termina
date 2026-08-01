import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

// ── HUD / in-game preferences ──────────────────────────────────────
// R3 collapsed the HUD to ONE layout and ONE surviving field: density.
// The colourblind palette (R3-03, one hue is already CVD-safe), the focus
// banner (R3-06, now a rig line in the stream), the roster toggle (R3-08,
// contacts live in the trace rail) and layoutMode itself (R3-10, there is
// one layout) are all gone. Legacy persisted blobs that still carry any of
// those keys load silently and yield the default density — the load branch
// below deliberately reads only `density`.
export type Density = 'comfortable' | 'compact'

export interface HudSettings {
  density: Density
  /**
   * The situational coach in the STREAM (see app/utils/coach.ts).
   *
   * Defaults ON. It exists to get a newcomer from "I can type" to "I can
   * decide", and it retires each lesson the moment the player demonstrates it —
   * so for someone who already knows the game it goes quiet on its own within a
   * match or two rather than needing to be switched off.
   */
  coach: boolean
}

const DEFAULT_HUD: HudSettings = { density: 'comfortable', coach: true }

function getStorage(): Storage | null {
  if (import.meta.server) return null
  if (typeof window !== 'undefined') return window.localStorage

  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  if (!descriptor || !('value' in descriptor)) return null
  const storage = descriptor.value
  return storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function'
    ? (storage as Storage)
    : null
}

export const useSettingsStore = defineStore('settings', () => {
  const audioEnabled = ref(true)
  const audioVolume = ref(0.5)
  const quickCastEnabled = ref(false)
  const hud = ref<HudSettings>({ ...DEFAULT_HUD })

  /** Change the HUD density. */
  function setHud<K extends keyof HudSettings>(key: K, value: HudSettings[K]) {
    hud.value = { ...hud.value, [key]: value }
  }

  function load() {
    const storage = getStorage()
    if (!storage) return
    try {
      const raw = storage.getItem('termina:settings')
      if (!raw) return
      const data = JSON.parse(raw)
      if (typeof data.audioEnabled === 'boolean') audioEnabled.value = data.audioEnabled
      if (typeof data.audioVolume === 'number') audioVolume.value = data.audioVolume
      if (typeof data.quickCastEnabled === 'boolean') quickCastEnabled.value = data.quickCastEnabled
      // Only `density` survives. A pre-R3 blob carrying layoutMode /
      // focusBanner / teamPalette / rosterExpanded / emphasizeVitals loads
      // without throwing and those keys are simply never read.
      if (data.hud && typeof data.hud === 'object') {
        const h = data.hud
        if (h.density === 'comfortable' || h.density === 'compact') hud.value.density = h.density
        if (typeof h.coach === 'boolean') hud.value.coach = h.coach
      }
    } catch {
      /* ignore corrupt data */
    }
  }

  function save() {
    const storage = getStorage()
    if (!storage) return
    try {
      storage.setItem(
        'termina:settings',
        JSON.stringify({
          audioEnabled: audioEnabled.value,
          audioVolume: audioVolume.value,
          quickCastEnabled: quickCastEnabled.value,
          hud: hud.value,
        }),
      )
    } catch {
      /* ignore unavailable storage */
    }
  }

  // Auto-persist on change
  watch([audioEnabled, audioVolume, quickCastEnabled, hud], save, { deep: true })

  // Load on init
  load()

  return {
    audioEnabled,
    audioVolume,
    quickCastEnabled,
    hud,
    setHud,
    load,
    save,
  }
})
