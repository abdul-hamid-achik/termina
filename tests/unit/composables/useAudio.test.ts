import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useAudio } from '~/composables/useAudio'
import type { SoundName } from '~/composables/useAudio'
import { useSettingsStore } from '~/stores/settings'

function makeOsc() {
  return {
    type: '',
    frequency: {
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    detune: { setValueAtTime: vi.fn() },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  }
}

function makeGain() {
  return {
    gain: {
      value: 0,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
  }
}

function makeFilter() {
  return {
    type: '',
    frequency: {
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
  }
}

function makeBufferSource() {
  return {
    buffer: null,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  }
}

const mockAudioCtx = {
  state: 'running' as 'running' | 'suspended',
  currentTime: 0,
  sampleRate: 44100,
  destination: {},
  createOscillator: vi.fn(() => makeOsc()),
  createGain: vi.fn(() => makeGain()),
  createBiquadFilter: vi.fn(() => makeFilter()),
  createBufferSource: vi.fn(() => makeBufferSource()),
  createBuffer: vi.fn((_channels: number, length: number) => ({
    getChannelData: vi.fn(() => new Float32Array(length)),
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

  it('plays every sound type without throwing', () => {
    vi.mocked(useSettingsStore).mockReturnValue({
      audioEnabled: true,
      audioVolume: 0.5,
    } as ReturnType<typeof useSettingsStore>)

    const { playSound } = useAudio()
    const sounds: SoundName[] = [
      'tick',
      'submit',
      'damage',
      'kill',
      'death',
      'gold',
      'ready',
      'cast',
      'tower_fall',
    ]

    for (const name of sounds) {
      expect(() => playSound(name)).not.toThrow()
    }

    // Each sound creates at least one oscillator
    expect(mockAudioCtx.createOscillator.mock.calls.length).toBeGreaterThanOrEqual(sounds.length)
  })

  it('applies volume to master gain', () => {
    const masterGain = makeGain()
    // First createGain call is the master; subsequent ones are per-layer
    mockAudioCtx.createGain.mockReturnValueOnce(masterGain)

    vi.mocked(useSettingsStore).mockReturnValue({
      audioEnabled: true,
      audioVolume: 0.8,
    } as ReturnType<typeof useSettingsStore>)

    const { playSound } = useAudio()
    playSound('tick')

    // tick has no masterGain override (default 1), so master.gain.value should equal volume
    expect(masterGain.gain.value).toBe(0.8)
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
