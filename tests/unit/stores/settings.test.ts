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
      expect(store.theme).toBe('default')
      expect(store.fontSize).toBe('medium')
    })
  })

  describe('save', () => {
    it('writes all settings to localStorage', () => {
      const store = useSettingsStore()
      store.save()

      expect(localStorage.setItem).toHaveBeenCalledWith(
        'termina:settings',
        expect.any(String),
      )

      const saved = JSON.parse(mockStorage.get('termina:settings')!)
      expect(saved).toEqual({
        audioEnabled: true,
        audioVolume: 0.5,
        quickCastEnabled: false,
        theme: 'default',
        fontSize: 'medium',
      })
    })

    it('persists changed values', () => {
      const store = useSettingsStore()
      store.audioEnabled = false
      store.audioVolume = 0.8
      store.quickCastEnabled = true
      store.theme = 'green'
      store.fontSize = 'large'
      store.save()

      const saved = JSON.parse(mockStorage.get('termina:settings')!)
      expect(saved).toEqual({
        audioEnabled: false,
        audioVolume: 0.8,
        quickCastEnabled: true,
        theme: 'green',
        fontSize: 'large',
      })
    })
  })

  describe('load', () => {
    it('reads from localStorage and applies values', () => {
      mockStorage.set('termina:settings', JSON.stringify({
        audioEnabled: false,
        audioVolume: 0.3,
        quickCastEnabled: true,
        theme: 'amber',
        fontSize: 'small',
      }))

      const store = useSettingsStore()
      store.load()

      expect(store.audioEnabled).toBe(false)
      expect(store.audioVolume).toBe(0.3)
      expect(store.quickCastEnabled).toBe(true)
      expect(store.theme).toBe('amber')
      expect(store.fontSize).toBe('small')
    })

    it('handles missing localStorage gracefully', () => {
      const store = useSettingsStore()
      store.load()

      expect(store.audioEnabled).toBe(true)
      expect(store.audioVolume).toBe(0.5)
      expect(store.quickCastEnabled).toBe(false)
      expect(store.theme).toBe('default')
      expect(store.fontSize).toBe('medium')
    })

    it('handles corrupt JSON gracefully', () => {
      mockStorage.set('termina:settings', '{not valid json!!')

      const store = useSettingsStore()
      store.load()

      expect(store.audioEnabled).toBe(true)
      expect(store.audioVolume).toBe(0.5)
    })

    it('loads partial settings (only some fields present)', () => {
      mockStorage.set('termina:settings', JSON.stringify({
        audioVolume: 0.9,
        theme: 'green',
      }))

      const store = useSettingsStore()
      store.load()

      expect(store.audioVolume).toBe(0.9)
      expect(store.theme).toBe('green')
      expect(store.audioEnabled).toBe(true)
      expect(store.quickCastEnabled).toBe(false)
      expect(store.fontSize).toBe('medium')
    })

    it('ignores wrong types for boolean fields', () => {
      mockStorage.set('termina:settings', JSON.stringify({
        audioEnabled: 'yes',
        quickCastEnabled: 1,
      }))

      const store = useSettingsStore()
      store.load()

      expect(store.audioEnabled).toBe(true)
      expect(store.quickCastEnabled).toBe(false)
    })

    it('ignores wrong types for number fields', () => {
      mockStorage.set('termina:settings', JSON.stringify({
        audioVolume: 'loud',
      }))

      const store = useSettingsStore()
      store.load()

      expect(store.audioVolume).toBe(0.5)
    })

    it('accepts theme and fontSize as strings (truthy check)', () => {
      mockStorage.set('termina:settings', JSON.stringify({
        theme: 'amber',
        fontSize: 'large',
      }))

      const store = useSettingsStore()
      store.load()

      expect(store.theme).toBe('amber')
      expect(store.fontSize).toBe('large')
    })
  })
})
