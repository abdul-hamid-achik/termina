import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useSettingsStore } from '~/stores/settings'

const mockStorage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: vi.fn((key: string) => mockStorage.get(key) ?? null),
  setItem: vi.fn((key: string, val: string) => {
    mockStorage.set(key, val)
  }),
  removeItem: vi.fn((key: string) => {
    mockStorage.delete(key)
  }),
})

describe('Settings Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockStorage.clear()
    vi.clearAllMocks()
  })

  describe('default values', () => {
    it('has correct defaults', () => {
      const store = useSettingsStore()

      expect(store.audioEnabled).toBe(true)
      expect(store.audioVolume).toBe(0.5)
      expect(store.quickCastEnabled).toBe(false)
    })
  })

  describe('save', () => {
    it('writes all settings to localStorage', () => {
      const store = useSettingsStore()
      store.save()

      expect(localStorage.setItem).toHaveBeenCalledWith('termina:settings', expect.any(String))

      const saved = JSON.parse(mockStorage.get('termina:settings')!)
      expect(saved).toEqual({
        audioEnabled: true,
        audioVolume: 0.5,
        quickCastEnabled: false,
        hud: {
          layoutMode: 'classic',
          focusBanner: false,
          density: 'comfortable',
          emphasizeVitals: false,
        },
      })
    })

    it('persists changed values', () => {
      const store = useSettingsStore()
      store.audioEnabled = false
      store.audioVolume = 0.8
      store.quickCastEnabled = true
      store.save()

      const saved = JSON.parse(mockStorage.get('termina:settings')!)
      expect(saved).toEqual({
        audioEnabled: false,
        audioVolume: 0.8,
        quickCastEnabled: true,
        hud: {
          layoutMode: 'classic',
          focusBanner: false,
          density: 'comfortable',
          emphasizeVitals: false,
        },
      })
    })
  })

  describe('load', () => {
    it('reads from localStorage and applies values', () => {
      mockStorage.set(
        'termina:settings',
        JSON.stringify({
          audioEnabled: false,
          audioVolume: 0.3,
          quickCastEnabled: true,
        }),
      )

      const store = useSettingsStore()
      store.load()

      expect(store.audioEnabled).toBe(false)
      expect(store.audioVolume).toBe(0.3)
      expect(store.quickCastEnabled).toBe(true)
    })

    it('handles missing localStorage gracefully', () => {
      const store = useSettingsStore()
      store.load()

      expect(store.audioEnabled).toBe(true)
      expect(store.audioVolume).toBe(0.5)
      expect(store.quickCastEnabled).toBe(false)
    })

    it('handles corrupt JSON gracefully', () => {
      mockStorage.set('termina:settings', '{not valid json!!')

      const store = useSettingsStore()
      store.load()

      expect(store.audioEnabled).toBe(true)
      expect(store.audioVolume).toBe(0.5)
    })

    it('loads partial settings (only some fields present)', () => {
      mockStorage.set(
        'termina:settings',
        JSON.stringify({
          audioVolume: 0.9,
        }),
      )

      const store = useSettingsStore()
      store.load()

      expect(store.audioVolume).toBe(0.9)
      expect(store.audioEnabled).toBe(true)
      expect(store.quickCastEnabled).toBe(false)
    })

    it('ignores wrong types for boolean fields', () => {
      mockStorage.set(
        'termina:settings',
        JSON.stringify({
          audioEnabled: 'yes',
          quickCastEnabled: 1,
        }),
      )

      const store = useSettingsStore()
      store.load()

      expect(store.audioEnabled).toBe(true)
      expect(store.quickCastEnabled).toBe(false)
    })

    it('ignores wrong types for number fields', () => {
      mockStorage.set(
        'termina:settings',
        JSON.stringify({
          audioVolume: 'loud',
        }),
      )

      const store = useSettingsStore()
      store.load()

      expect(store.audioVolume).toBe(0.5)
    })
  })

  describe('HUD settings', () => {
    it('defaults to the standard preset (today’s classic layout)', () => {
      const store = useSettingsStore()

      expect(store.hudPreset).toBe('standard')
      expect(store.hud).toEqual({
        layoutMode: 'classic',
        focusBanner: false,
        density: 'comfortable',
        emphasizeVitals: false,
      })
    })

    it('applyHudPreset swaps every field and records the preset', () => {
      const store = useSettingsStore()

      store.applyHudPreset('tactical')
      expect(store.hudPreset).toBe('tactical')
      expect(store.hud).toEqual({
        layoutMode: 'map-centric',
        focusBanner: true,
        density: 'compact',
        emphasizeVitals: false,
      })

      store.applyHudPreset('focus')
      expect(store.hudPreset).toBe('focus')
      expect(store.hud.emphasizeVitals).toBe(true)
      expect(store.hud.focusBanner).toBe(true)
    })

    it('setHud toggles one field and re-derives the preset label', () => {
      const store = useSettingsStore()

      // Off a named preset → 'custom'.
      store.setHud('emphasizeVitals', true)
      expect(store.hud.emphasizeVitals).toBe(true)
      expect(store.hudPreset).toBe('custom')

      // Toggling back to a combination that matches 'standard' re-detects it.
      store.setHud('emphasizeVitals', false)
      expect(store.hudPreset).toBe('standard')
    })

    it('detects the focus preset when fields are set individually', () => {
      const store = useSettingsStore()
      store.setHud('focusBanner', true)
      expect(store.hudPreset).toBe('custom')
      store.setHud('emphasizeVitals', true)
      // classic + banner + comfortable + vitals === the focus preset
      expect(store.hudPreset).toBe('focus')
    })

    it('persists and reloads HUD settings round-trip', () => {
      const store = useSettingsStore()
      store.applyHudPreset('tactical')
      store.save()

      setActivePinia(createPinia())
      const reloaded = useSettingsStore()
      reloaded.load()

      expect(reloaded.hud).toEqual({
        layoutMode: 'map-centric',
        focusBanner: true,
        density: 'compact',
        emphasizeVitals: false,
      })
      expect(reloaded.hudPreset).toBe('tactical')
    })

    it('keeps HUD defaults when an old payload has no hud key', () => {
      mockStorage.set('termina:settings', JSON.stringify({ audioEnabled: false }))

      const store = useSettingsStore()
      store.load()

      expect(store.audioEnabled).toBe(false)
      expect(store.hud.layoutMode).toBe('classic')
      expect(store.hudPreset).toBe('standard')
    })

    it('loads a partial/typo-corrupt hud blob field-by-field', () => {
      mockStorage.set(
        'termina:settings',
        JSON.stringify({
          hud: {
            layoutMode: 'map-centric', // valid → applied
            focusBanner: 'yes', // wrong type → ignored (stays false)
            density: 'ultra', // invalid enum → ignored (stays comfortable)
            emphasizeVitals: true, // valid → applied
          },
        }),
      )

      const store = useSettingsStore()
      store.load()

      expect(store.hud.layoutMode).toBe('map-centric')
      expect(store.hud.focusBanner).toBe(false)
      expect(store.hud.density).toBe('comfortable')
      expect(store.hud.emphasizeVitals).toBe(true)
      expect(store.hudPreset).toBe('custom')
    })
  })
})
