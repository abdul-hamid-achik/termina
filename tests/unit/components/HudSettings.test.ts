import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import HudSettings from '~~/app/components/settings/HudSettings.vue'
import { useSettingsStore } from '~~/app/stores/settings'

const mockStorage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: vi.fn((key: string) => mockStorage.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => void mockStorage.set(key, value)),
  removeItem: vi.fn((key: string) => void mockStorage.delete(key)),
  clear: vi.fn(() => void mockStorage.clear()),
})

function mountPanel() {
  return mount(HudSettings)
}

beforeEach(() => {
  mockStorage.clear()
  setActivePinia(createPinia())
})

describe('HudSettings (post-R3: one layout, surviving preferences)', () => {
  it('renders density, coach, and sound — presets, layout, banner, roster and palette are gone', () => {
    const wrapper = mountPanel()
    expect(wrapper.find('[data-testid="hud-density-comfortable"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hud-density-compact"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hud-active-preset"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid^="hud-preset-"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid^="hud-layout-"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="hud-toggle-focusBanner"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="hud-toggle-rosterExpanded"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="hud-toggle-colorblind"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="hud-audio-toggle"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hud-music-toggle"]').exists()).toBe(true)
  })

  it('toggles sound and music and persists them', async () => {
    const settings = useSettingsStore()
    const wrapper = mountPanel()

    await wrapper.find('[data-testid="hud-music-toggle"]').trigger('click')
    expect(settings.musicEnabled).toBe(false)

    await wrapper.find('[data-testid="hud-audio-toggle"]').trigger('click')
    expect(settings.audioEnabled).toBe(false)

    const blob = JSON.parse(localStorage.getItem('termina:settings')!)
    expect(blob.audioEnabled).toBe(false)
    expect(blob.musicEnabled).toBe(false)
  })

  it('marks comfortable density active by default', () => {
    const wrapper = mountPanel()
    expect(wrapper.find('[data-testid="hud-density-comfortable"]').attributes('aria-pressed')).toBe(
      'true',
    )
    expect(wrapper.find('[data-testid="hud-density-compact"]').attributes('aria-pressed')).toBe(
      'false',
    )
  })

  it('selecting compact density updates the store and the pressed state', async () => {
    const settings = useSettingsStore()
    const wrapper = mountPanel()

    await wrapper.find('[data-testid="hud-density-compact"]').trigger('click')

    expect(settings.hud.density).toBe('compact')
    expect(wrapper.find('[data-testid="hud-density-compact"]').attributes('aria-pressed')).toBe(
      'true',
    )
  })

  it('switching back to comfortable persists to localStorage', async () => {
    const settings = useSettingsStore()
    const wrapper = mountPanel()

    await wrapper.find('[data-testid="hud-density-compact"]').trigger('click')
    await wrapper.find('[data-testid="hud-density-comfortable"]').trigger('click')

    expect(settings.hud.density).toBe('comfortable')
    const blob = JSON.parse(localStorage.getItem('termina:settings')!)
    expect(blob.hud.density).toBe('comfortable')
  })
})
