import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useAudio } from '~/composables/useAudio'
import type { SoundName } from '~/composables/useAudio'
import { useSettingsStore } from '~/stores/settings'

const mockOsc = {
  type: '',
  frequency: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
  connect: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}
const _mockGain = {
  gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
  connect: vi.fn(),
}
const mockAudioCtx = {
  state: 'running',
  currentTime: 0,
  destination: {},
  createOscillator: vi.fn(() => ({ ...mockOsc })),
  createGain: vi.fn(() => ({
    gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn(),
  })),
  resume: vi.fn(),
}

vi.stubGlobal('AudioContext', vi.fn(() => mockAudioCtx))

vi.mock('~/stores/settings', () => ({
  useSettingsStore: vi.fn(() => ({
    audioEnabled: true,
    audioVolume: 0.5,
  })),
}))

describe('useAudio', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mockAudioCtx.state = 'running'
    mockAudioCtx.currentTime = 0
  })

  it('does nothing when audio is disabled', () => {
    vi.mocked(useSettingsStore).mockReturnValue({
      audioEnabled: false,
      audioVolume: 0.5,
    } as ReturnType<typeof useSettingsStore>)

    const { playSound } = useAudio()
    playSound('tick')

    expect(mockAudioCtx.createOscillator).not.toHaveBeenCalled()
  })

  it('creates AudioContext when first sound is played', () => {
    vi.mocked(useSettingsStore).mockReturnValue({
      audioEnabled: true,
      audioVolume: 0.5,
    } as ReturnType<typeof useSettingsStore>)

    const { playSound } = useAudio()
    playSound('tick')

    expect(mockAudioCtx.createOscillator).toHaveBeenCalled()
    expect(mockAudioCtx.createGain).toHaveBeenCalled()
  })

  it('plays all 7 sound types without error', () => {
    vi.mocked(useSettingsStore).mockReturnValue({
      audioEnabled: true,
      audioVolume: 0.5,
    } as ReturnType<typeof useSettingsStore>)

    const { playSound } = useAudio()
    const sounds: SoundName[] = ['tick', 'submit', 'damage', 'kill', 'death', 'gold', 'ready']

    for (const name of sounds) {
      expect(() => playSound(name)).not.toThrow()
    }

    expect(mockAudioCtx.createOscillator).toHaveBeenCalledTimes(7)
    expect(mockAudioCtx.createGain).toHaveBeenCalledTimes(7)
  })

  it('respects volume from settings store', () => {
    const gainSetValue = vi.fn()
    mockAudioCtx.createGain.mockReturnValue({
      gain: { setValueAtTime: gainSetValue, exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    })

    vi.mocked(useSettingsStore).mockReturnValue({
      audioEnabled: true,
      audioVolume: 0.8,
    } as ReturnType<typeof useSettingsStore>)

    const { playSound } = useAudio()
    playSound('tick')

    // The gain should be def.gain * settings.audioVolume
    // tick has gain: 0.15, volume is 0.8, so 0.15 * 0.8 = 0.12
    expect(gainSetValue).toHaveBeenCalledWith(0.15 * 0.8, 0)
  })

  it('resumes AudioContext when suspended', () => {
    mockAudioCtx.state = 'suspended'

    vi.mocked(useSettingsStore).mockReturnValue({
      audioEnabled: true,
      audioVolume: 0.5,
    } as ReturnType<typeof useSettingsStore>)

    const { playSound } = useAudio()
    playSound('tick')

    expect(mockAudioCtx.resume).toHaveBeenCalled()
  })

  it('returns playSound function', () => {
    const result = useAudio()
    expect(result).toHaveProperty('playSound')
    expect(typeof result.playSound).toBe('function')
  })
})
