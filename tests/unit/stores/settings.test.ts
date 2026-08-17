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
      expect(store.musicEnabled).toBe(true)
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
        musicEnabled: true,
        quickCastEnabled: false,
        hud: { density: 'comfortable', coach: true },
      })
    })

    it('persists changed values', () => {
      const store = useSettingsStore()
      store.audioEnabled = false
      store.audioVolume = 0.8
      store.musicEnabled = false
      store.quickCastEnabled = true
      store.save()

      const saved = JSON.parse(mockStorage.get('termina:settings')!)
      expect(saved).toEqual({
        audioEnabled: false,
        audioVolume: 0.8,
        musicEnabled: false,
        quickCastEnabled: true,
        hud: { density: 'comfortable', coach: true },
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
          musicEnabled: false,
          quickCastEnabled: true,
        }),
      )

      const store = useSettingsStore()
      store.load()

      expect(store.audioEnabled).toBe(false)
      expect(store.audioVolume).toBe(0.3)
      expect(store.musicEnabled).toBe(false)
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

  describe('HUD settings (post-R3: density is the only field)', () => {
    it('defaults to comfortable density', () => {
      const store = useSettingsStore()
      expect(store.hud).toEqual({ density: 'comfortable', coach: true })
    })

    it('setHud toggles density', () => {
      const store = useSettingsStore()
      store.setHud('density', 'compact')
      expect(store.hud.density).toBe('compact')
      store.setHud('density', 'comfortable')
      expect(store.hud.density).toBe('comfortable')
    })

    it('persists and reloads density round-trip', () => {
      const store = useSettingsStore()
      store.setHud('density', 'compact')
      store.save()

      setActivePinia(createPinia())
      const reloaded = useSettingsStore()
      reloaded.load()

      expect(reloaded.hud).toEqual({ density: 'compact', coach: true })
    })

    it('a legacy pre-R3 blob (layoutMode/focusBanner/teamPalette/rosterExpanded) loads without throwing and yields the default density', () => {
      mockStorage.set(
        'termina:settings',
        JSON.stringify({
          audioEnabled: true,
          teamPalette: 'colorblind',
          hud: {
            layoutMode: 'map-centric',
            focusBanner: false,
            density: 'compact',
            emphasizeVitals: true,
            rosterExpanded: true,
          },
        }),
      )

      const store = useSettingsStore()
      store.load()

      // Only density is honoured; every retired key is ignored, not crash-worthy.
      expect(store.hud).toEqual({ density: 'compact', coach: true })
    })

    it('keeps HUD defaults when an old payload has no hud key', () => {
      mockStorage.set('termina:settings', JSON.stringify({ audioEnabled: false }))

      const store = useSettingsStore()
      store.load()

      expect(store.audioEnabled).toBe(false)
      expect(store.hud).toEqual({ density: 'comfortable', coach: true })
    })

    it('ignores a corrupt density value inside a hud blob', () => {
      mockStorage.set('termina:settings', JSON.stringify({ hud: { density: 'ultra' } }))

      const store = useSettingsStore()
      store.load()

      expect(store.hud.density).toBe('comfortable')
    })
  })
})
