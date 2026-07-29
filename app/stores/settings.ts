import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

// ── HUD / in-game layout preferences ───────────────────────────────
// Independent, player-toggleable directions for the in-game HUD, each
// tuned for a text-based MOBA. The fresh-install default (`standard`) is
// the SIMPLIFIED HUD: classic combat-log-centric layout with the focus
// banner ON and the War Room roster collapsed. Persisted settings load
// per-field, so existing players keep whatever they already chose.
export type LayoutMode = 'classic' | 'map-centric' // direction A: where the map lives
export type Density = 'comfortable' | 'compact' // direction C: spacing scale
export type HudPreset = 'standard' | 'tactical' | 'focus' | 'custom'
/** Team color palette. 'colorblind' swaps the green/red team colors for a
 *  blue/orange (Okabe-Ito) pairing distinguishable with red-green CVD. */
export type TeamPalette = 'classic' | 'colorblind'

export interface HudSettings {
  /** Combat-log-centric (classic) vs. map-as-centerpiece (tactical). */
  layoutMode: LayoutMode
  /** Direction B: a prominent threat + recommended-action banner. */
  focusBanner: boolean
  /** Direction C: comfortable vs. compact spacing/scale. */
  density: Density
  /** Direction C: bigger HP/mana + ability bar, recede secondary panels. */
  emphasizeVitals: boolean
  /** War Room: show the ally roster (collapsed to a slim row when off). The
   *  enemy-threat sheet is unconditional — a new player must be able to see
   *  enemy cooldowns and last-seen zones without finding a toggle. */
  rosterExpanded: boolean
}

/** Named bundles the player can apply in one click. 'custom' is implicit. */
export const HUD_PRESETS: Record<Exclude<HudPreset, 'custom'>, HudSettings> = {
  // Standard = the simplified default: classic layout + focus banner,
  // War Room roster tucked away until asked for.
  standard: {
    layoutMode: 'classic',
    focusBanner: true,
    density: 'comfortable',
    emphasizeVitals: false,
    rosterExpanded: false,
  },
  // Tactical = read-the-board first: map-centric + a banner + dense panels
  // + the full roster on display.
  tactical: {
    layoutMode: 'map-centric',
    focusBanner: true,
    density: 'compact',
    emphasizeVitals: false,
    rosterExpanded: true,
  },
  // Focus = classic layout, but a loud action banner + emphasized vitals
  // for players who want maximum "what do I do now" clarity.
  focus: {
    layoutMode: 'classic',
    focusBanner: true,
    density: 'comfortable',
    emphasizeVitals: true,
    rosterExpanded: false,
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
      p.emphasizeVitals === h.emphasizeVitals &&
      p.rosterExpanded === h.rosterExpanded
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
  const teamPalette = ref<TeamPalette>('classic')
  const hud = ref<HudSettings>({ ...DEFAULT_HUD })
  const hudPreset = ref<HudPreset>('standard')

  /** Switch the team color palette (classic green/red vs colorblind blue/orange). */
  function setTeamPalette(palette: TeamPalette) {
    teamPalette.value = palette
  }

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
      if (data.teamPalette === 'classic' || data.teamPalette === 'colorblind')
        teamPalette.value = data.teamPalette
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
        if (typeof h.rosterExpanded === 'boolean') hud.value.rosterExpanded = h.rosterExpanded
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
          teamPalette: teamPalette.value,
          hud: hud.value,
        }),
      )
    } catch {
      /* ignore unavailable storage */
    }
  }

  // Auto-persist on change
  watch([audioEnabled, audioVolume, quickCastEnabled, teamPalette, hud], save, { deep: true })

  // Load on init
  load()

  return {
    audioEnabled,
    audioVolume,
    quickCastEnabled,
    teamPalette,
    hud,
    hudPreset,
    applyHudPreset,
    setHud,
    setTeamPalette,
    load,
    save,
  }
})
