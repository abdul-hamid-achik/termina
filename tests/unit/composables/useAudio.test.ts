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

vi.mock('~/stores/settings', () => ({
  useSettingsStore: vi.fn(() => ({
    audioEnabled: true,
    audioVolume: 0.5,
  })),
}))

function enableAudio(volume = 0.5) {
  vi.mocked(useSettingsStore).mockReturnValue({
    audioEnabled: true,
    audioVolume: volume,
  } as ReturnType<typeof useSettingsStore>)
}

/** Every distinct time an oscillator was scheduled to start, ascending — one
 * entry per sound actually played (a sound's layers share its t0). */
function uniqueStarts(): number[] {
  const all = mockAudioCtx.createOscillator.mock.results.flatMap((r) =>
    (r.value as ReturnType<typeof makeOsc>).start.mock.calls.map((c) => c[0] as number),
  )
  return [...new Set(all)].sort((a, b) => a - b)
}

describe('useAudio', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    // Vitest 4 restores stubGlobal between tests, so re-apply the AudioContext
    // stub each test. Use a plain constructor function, NOT vi.fn(() => ...):
    // in vitest 4 `new (vi.fn(() => obj))()` returns the empty `this`, not obj.
    vi.stubGlobal('AudioContext', function MockAudioContext() {
      return mockAudioCtx
    })
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
      'ice_fall',
      'ice_lost',
      'respawn',
      'victory',
      'defeat',
      'double_cast',
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

  it('defines the ice_lost and respawn cues', () => {
    enableAudio()
    const { playSound } = useAudio()

    playSound('ice_lost')
    expect(mockAudioCtx.createOscillator).toHaveBeenCalled()
    // Distinct from ice_fall: it is the low, crash-less variant, so it must
    // not be an alias that plays nothing.
    expect(mockAudioCtx.createBufferSource).toHaveBeenCalled()

    mockAudioCtx.createOscillator.mockClear()
    playSound('respawn')
    expect(mockAudioCtx.createOscillator).toHaveBeenCalled()
  })

  // ── Burst staggering ────────────────────────────────────────────────
  // A tick resolves in one JS task, so N damage events all read the SAME
  // ctx.currentTime and start perfectly phase-aligned — they sum into a single
  // clipped transient instead of reading as N hits.
  describe('burst staggering', () => {
    it('spaces repeats of a burst sound instead of stacking them on one instant', () => {
      enableAudio()
      mockAudioCtx.currentTime = 100
      const { playSound } = useAudio()

      playSound('damage')
      playSound('damage')
      playSound('damage')

      const starts = uniqueStarts()
      expect(starts).toHaveLength(3)
      expect(starts[0]).toBeCloseTo(100, 6)
      expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(0.05)
      expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(0.05)
    })

    it('starts a lone sound exactly at ctx.currentTime', () => {
      enableAudio()
      mockAudioCtx.currentTime = 200
      const { playSound } = useAudio()

      playSound('damage')

      expect(uniqueStarts()).toEqual([200])
    })

    it('drops repeats that would land past the audible window', () => {
      enableAudio()
      mockAudioCtx.currentTime = 300
      const { playSound } = useAudio()

      for (let i = 0; i < 12; i++) playSound('damage')

      // 0.06s apart inside a 0.25s window admits 5; the rest would land under
      // the next tick's events, so they are dropped rather than smeared.
      const starts = uniqueStarts()
      expect(starts).toHaveLength(5)
      expect(starts[starts.length - 1]!).toBeLessThanOrEqual(300.25)
    })

    it('leaves sounds without a burst gap untouched', () => {
      enableAudio()
      mockAudioCtx.currentTime = 400
      const { playSound } = useAudio()

      playSound('tick')
      playSound('tick')
      playSound('tick')

      // The UI tick is one-per-tick by construction; delaying it would smear
      // the beat the whole HUD is timed against.
      expect(uniqueStarts()).toEqual([400])
    })

    it('recovers when the context clock restarts behind the last scheduled start', () => {
      enableAudio()
      mockAudioCtx.currentTime = 500
      const { playSound } = useAudio()
      playSound('gold')

      // A fresh AudioContext restarts currentTime near 0; without a staleness
      // guard the stored future start would silence the sound permanently.
      mockAudioCtx.currentTime = 0
      mockAudioCtx.createOscillator.mockClear()
      playSound('gold')

      expect(uniqueStarts()).toEqual([0])
    })
  })
})
