import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export type ThemeVariant = 'default' | 'green' | 'amber'
export type FontSize = 'small' | 'medium' | 'large'

// ── HUD / in-game layout preferences ───────────────────────────────
// Three independent, player-toggleable directions for the in-game HUD,
// each tuned for a text-based MOBA. Defaults reproduce TODAY's behaviour
// exactly (classic combat-log-centric layout, no banner, comfortable
// density, no vital emphasis), so existing players see no change until
// they opt in.
export type LayoutMode = 'classic' | 'map-centric' // direction A: where the map lives
export type Density = 'comfortable' | 'compact' // direction C: spacing scale
export type HudPreset = 'standard' | 'tactical' | 'focus' | 'custom'

export interface HudSettings {
  /** Combat-log-centric (classic) vs. map-as-centerpiece (tactical). */
  layoutMode: LayoutMode
  /** Direction B: a prominent threat + recommended-action banner. */
  focusBanner: boolean
  /** Direction C: comfortable vs. compact spacing/scale. */
  density: Density
  /** Direction C: bigger HP/mana + ability bar, recede secondary panels. */
  emphasizeVitals: boolean
}

/** Named bundles the player can apply in one click. 'custom' is implicit. */
export const HUD_PRESETS: Record<Exclude<HudPreset, 'custom'>, HudSettings> = {
  // Standard = exactly today's classic layout, no extras.
  standard: {
    layoutMode: 'classic',
    focusBanner: false,
    density: 'comfortable',
    emphasizeVitals: false,
  },
  // Tactical = read-the-board first: map-centric + a banner + dense panels.
  tactical: {
    layoutMode: 'map-centric',
    focusBanner: true,
    density: 'compact',
    emphasizeVitals: false,
  },
  // Focus = classic layout, but a loud action banner + emphasized vitals
  // for players who want maximum "what do I do now" clarity.
  focus: {
    layoutMode: 'classic',
    focusBanner: true,
    density: 'comfortable',
    emphasizeVitals: true,
  },
}

const DEFAULT_HUD: HudSettings = { ...HUD_PRESETS.standard }

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

/** Which named preset (if any) the current HUD settings exactly match. */
export function detectHudPreset(h: HudSettings): HudPreset {
  for (const name of Object.keys(HUD_PRESETS) as Array<Exclude<HudPreset, 'custom'>>) {
    const p = HUD_PRESETS[name]
    if (
      p.layoutMode === h.layoutMode &&
      p.focusBanner === h.focusBanner &&
      p.density === h.density &&
      p.emphasizeVitals === h.emphasizeVitals
    ) {
      return name
    }
  }
  return 'custom'
}

export const useSettingsStore = defineStore('settings', () => {
  const audioEnabled = ref(true)
  const audioVolume = ref(0.5)
  const quickCastEnabled = ref(false)
  const theme = ref<ThemeVariant>('default')
  const fontSize = ref<FontSize>('medium')
  const hud = ref<HudSettings>({ ...DEFAULT_HUD })
  const hudPreset = ref<HudPreset>('standard')

  /** Apply a named HUD preset (sets every field + the preset label). */
  function applyHudPreset(name: Exclude<HudPreset, 'custom'>) {
    hud.value = { ...HUD_PRESETS[name] }
    hudPreset.value = name
  }

  /** Change a single HUD field; re-derives whether we're on a named preset. */
  function setHud<K extends keyof HudSettings>(key: K, value: HudSettings[K]) {
    hud.value = { ...hud.value, [key]: value }
    hudPreset.value = detectHudPreset(hud.value)
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
      if (data.theme) theme.value = data.theme
      if (data.fontSize) fontSize.value = data.fontSize
      // HUD prefs are additive: payloads written before this existed simply
      // have no `hud` key and keep the defaults. Each field is validated
      // independently so a partial/corrupt blob degrades gracefully.
      if (data.hud && typeof data.hud === 'object') {
        const h = data.hud
        if (h.layoutMode === 'classic' || h.layoutMode === 'map-centric')
          hud.value.layoutMode = h.layoutMode
        if (typeof h.focusBanner === 'boolean') hud.value.focusBanner = h.focusBanner
        if (h.density === 'comfortable' || h.density === 'compact') hud.value.density = h.density
        if (typeof h.emphasizeVitals === 'boolean') hud.value.emphasizeVitals = h.emphasizeVitals
        hudPreset.value = detectHudPreset(hud.value)
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
          theme: theme.value,
          fontSize: fontSize.value,
          hud: hud.value,
        }),
      )
    } catch {
      /* ignore unavailable storage */
    }
  }

  // Auto-persist on change
  watch([audioEnabled, audioVolume, quickCastEnabled, theme, fontSize, hud], save, { deep: true })

  // Load on init
  load()

  return {
    audioEnabled,
    audioVolume,
    quickCastEnabled,
    theme,
    fontSize,
    hud,
    hudPreset,
    applyHudPreset,
    setHud,
    load,
    save,
  }
})
