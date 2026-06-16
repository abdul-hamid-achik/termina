import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import HudSettings from '../../../app/components/settings/HudSettings.vue'
import { useSettingsStore } from '../../../app/stores/settings'

// localStorage is touched by the store's load()/save(); stub it so the
// component test runs in node/happy-dom without a real implementation.
const mockStorage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: vi.fn((k: string) => mockStorage.get(k) ?? null),
  setItem: vi.fn((k: string, v: string) => void mockStorage.set(k, v)),
  removeItem: vi.fn((k: string) => void mockStorage.delete(k)),
})

describe('HudSettings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockStorage.clear()
    vi.clearAllMocks()
  })

  it('renders all three presets and every direction control', () => {
    const wrapper = mount(HudSettings)

    expect(wrapper.find('[data-testid="hud-preset-standard"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hud-preset-tactical"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hud-preset-focus"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hud-layout-classic"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hud-layout-map-centric"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hud-toggle-focusBanner"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hud-density-comfortable"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hud-density-compact"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hud-toggle-emphasizeVitals"]').exists()).toBe(true)
  })

  it('marks the standard preset active by default', () => {
    const wrapper = mount(HudSettings)

    expect(wrapper.find('[data-testid="hud-active-preset"]').text()).toContain('Standard')
    expect(wrapper.find('[data-testid="hud-preset-standard"]').attributes('aria-pressed')).toBe(
      'true',
    )
  })

  it('applies a preset to the store on click', async () => {
    const store = useSettingsStore()
    const wrapper = mount(HudSettings)

    await wrapper.find('[data-testid="hud-preset-tactical"]').trigger('click')

    expect(store.hudPreset).toBe('tactical')
    expect(store.hud.layoutMode).toBe('map-centric')
    expect(store.hud.focusBanner).toBe(true)
    expect(store.hud.density).toBe('compact')
    // The active-preset readout reflects it.
    expect(wrapper.find('[data-testid="hud-active-preset"]').text()).toContain('Tactical')
  })

  it('toggling a single field switches the preset readout to Custom', async () => {
    const store = useSettingsStore()
    const wrapper = mount(HudSettings)

    await wrapper.find('[data-testid="hud-toggle-emphasizeVitals"]').trigger('click')

    expect(store.hud.emphasizeVitals).toBe(true)
    expect(store.hudPreset).toBe('custom')
    expect(wrapper.find('[data-testid="hud-active-preset"]').text()).toContain('Custom')
  })

  it('selecting a layout updates the store and the pressed state', async () => {
    const store = useSettingsStore()
    const wrapper = mount(HudSettings)

    await wrapper.find('[data-testid="hud-layout-map-centric"]').trigger('click')

    expect(store.hud.layoutMode).toBe('map-centric')
    expect(wrapper.find('[data-testid="hud-layout-map-centric"]').attributes('aria-pressed')).toBe(
      'true',
    )
    expect(wrapper.find('[data-testid="hud-layout-classic"]').attributes('aria-pressed')).toBe(
      'false',
    )
  })

  it('selecting compact density updates the store', async () => {
    const store = useSettingsStore()
    const wrapper = mount(HudSettings)

    await wrapper.find('[data-testid="hud-density-compact"]').trigger('click')

    expect(store.hud.density).toBe('compact')
  })

  it('the focus-banner toggle flips on then off', async () => {
    const store = useSettingsStore()
    const wrapper = mount(HudSettings)
    const btn = () => wrapper.find('[data-testid="hud-toggle-focusBanner"]')

    expect(store.hud.focusBanner).toBe(false)
    await btn().trigger('click')
    expect(store.hud.focusBanner).toBe(true)
    expect(btn().text()).toContain('On')

    await btn().trigger('click')
    expect(store.hud.focusBanner).toBe(false)
    expect(btn().text()).toContain('Off')
  })
})
