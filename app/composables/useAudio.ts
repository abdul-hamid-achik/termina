import { useSettingsStore } from '~/stores/settings'

export type SoundName =
  | 'tick'
  | 'submit'
  | 'damage'
  | 'kill'
  | 'death'
  | 'gold'
  | 'ready'
  | 'cast'
  | 'tower_fall'

let audioCtx: AudioContext | null = null

function getContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext()
  }
  return audioCtx
}

interface OscLayer {
  type: OscillatorType
  freqStart: number
  freqEnd?: number
  detune?: number
  duration: number
  gain: number
  /** Peak gain reached during attack (defaults to `gain`). */
  peak?: number
  /** Attack time in seconds (defaults to 0.005). */
  attack?: number
}

interface NoiseLayer {
  duration: number
  gain: number
  /** Lowpass cutoff (Hz). */
  cutoff?: number
}

interface SoundDef {
  oscs?: OscLayer[]
  noise?: NoiseLayer
  masterGain?: number
}

/* Sound design notes:
 * - Layered oscillators give body + transient.
 * - Detuning a few cents adds a hint of chorus.
 * - Noise burst for percussive impact (damage, kill, death).
 * - Lowpass filter sweep on death gives a "shutdown" feel.
 */
const SOUNDS: Record<SoundName, SoundDef> = {
  // Subtle UI tick — single short blip
  tick: {
    oscs: [{ type: 'sine', freqStart: 880, duration: 0.04, gain: 0.08, attack: 0.002 }],
  },
  // Crisp keypress / submit
  submit: {
    oscs: [
      { type: 'square', freqStart: 1400, duration: 0.04, gain: 0.12, attack: 0.001 },
      { type: 'sine', freqStart: 700, duration: 0.04, gain: 0.06, attack: 0.001 },
    ],
  },
  // Damage: thumpy low body + noise burst
  damage: {
    oscs: [
      { type: 'sawtooth', freqStart: 240, freqEnd: 90, duration: 0.14, gain: 0.28, attack: 0.001 },
      { type: 'sine', freqStart: 120, freqEnd: 60, duration: 0.16, gain: 0.18, attack: 0.001 },
    ],
    noise: { duration: 0.08, gain: 0.18, cutoff: 1800 },
  },
  // Kill: bright ascending stab with harmonic stack + noise transient
  kill: {
    oscs: [
      { type: 'square', freqStart: 520, freqEnd: 980, duration: 0.18, gain: 0.22, attack: 0.002 },
      {
        type: 'sine',
        freqStart: 1040,
        freqEnd: 1960,
        duration: 0.18,
        gain: 0.16,
        attack: 0.002,
        detune: 4,
      },
      { type: 'triangle', freqStart: 260, freqEnd: 490, duration: 0.22, gain: 0.18, attack: 0.003 },
    ],
    noise: { duration: 0.05, gain: 0.16, cutoff: 5000 },
  },
  // Death: descending sweep + low rumble + noise tail (low-pass closing)
  death: {
    oscs: [
      { type: 'sawtooth', freqStart: 720, freqEnd: 90, duration: 0.5, gain: 0.28, attack: 0.005 },
      { type: 'sine', freqStart: 360, freqEnd: 45, duration: 0.55, gain: 0.22, attack: 0.005 },
    ],
    noise: { duration: 0.4, gain: 0.14, cutoff: 600 },
  },
  // Gold: bright two-tone "ka-ching" (root + perfect fifth above)
  gold: {
    oscs: [
      { type: 'triangle', freqStart: 1320, duration: 0.08, gain: 0.16, attack: 0.001 },
      { type: 'sine', freqStart: 1980, duration: 0.1, gain: 0.12, attack: 0.001, detune: 3 },
    ],
  },
  // Ready / level up: rising fifth with a sparkle on top
  ready: {
    oscs: [
      { type: 'triangle', freqStart: 660, freqEnd: 990, duration: 0.18, gain: 0.2, attack: 0.005 },
      { type: 'sine', freqStart: 1320, freqEnd: 1980, duration: 0.2, gain: 0.14, attack: 0.005 },
    ],
  },
  // Ability cast: short whoosh + tonal accent
  cast: {
    oscs: [
      { type: 'sine', freqStart: 380, freqEnd: 760, duration: 0.12, gain: 0.18, attack: 0.003 },
      { type: 'triangle', freqStart: 760, freqEnd: 1140, duration: 0.12, gain: 0.1, attack: 0.003 },
    ],
    noise: { duration: 0.08, gain: 0.08, cutoff: 3500 },
  },
  // Tower fall: heavy thud + crash
  tower_fall: {
    oscs: [
      { type: 'sawtooth', freqStart: 80, freqEnd: 40, duration: 0.45, gain: 0.32, attack: 0.005 },
      { type: 'square', freqStart: 160, freqEnd: 60, duration: 0.4, gain: 0.18, attack: 0.005 },
    ],
    noise: { duration: 0.35, gain: 0.22, cutoff: 1400 },
  },
}

function makeNoiseBuffer(ctx: AudioContext, duration: number): AudioBuffer {
  const sampleRate = ctx.sampleRate
  const length = Math.max(1, Math.floor(sampleRate * duration))
  const buffer = ctx.createBuffer(1, length, sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
  return buffer
}

export function useAudio() {
  const settings = useSettingsStore()

  function playSound(name: SoundName) {
    if (!settings.audioEnabled) return
    if (import.meta.server) return

    const def = SOUNDS[name]
    if (!def) return

    try {
      const ctx = getContext()
      if (ctx.state === 'suspended') {
        ctx.resume()
      }

      const t0 = ctx.currentTime
      const master = ctx.createGain()
      master.gain.value = (def.masterGain ?? 1) * settings.audioVolume
      master.connect(ctx.destination)

      // Oscillator layers
      for (const layer of def.oscs ?? []) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()

        osc.type = layer.type
        osc.frequency.setValueAtTime(layer.freqStart, t0)
        if (layer.freqEnd !== undefined) {
          osc.frequency.exponentialRampToValueAtTime(
            Math.max(layer.freqEnd, 1),
            t0 + layer.duration,
          )
        }
        if (layer.detune) osc.detune.setValueAtTime(layer.detune, t0)

        const peak = layer.peak ?? layer.gain
        const attack = layer.attack ?? 0.005
        gain.gain.setValueAtTime(0, t0)
        gain.gain.linearRampToValueAtTime(peak, t0 + attack)
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + layer.duration)

        osc.connect(gain)
        gain.connect(master)
        osc.start(t0)
        osc.stop(t0 + layer.duration + 0.02)
      }

      // Noise layer (percussive transient)
      if (def.noise) {
        const src = ctx.createBufferSource()
        src.buffer = makeNoiseBuffer(ctx, def.noise.duration)

        const gain = ctx.createGain()
        gain.gain.setValueAtTime(0, t0)
        gain.gain.linearRampToValueAtTime(def.noise.gain, t0 + 0.002)
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + def.noise.duration)

        if (def.noise.cutoff) {
          const filter = ctx.createBiquadFilter()
          filter.type = 'lowpass'
          filter.frequency.setValueAtTime(def.noise.cutoff, t0)
          filter.frequency.exponentialRampToValueAtTime(
            Math.max(def.noise.cutoff * 0.3, 80),
            t0 + def.noise.duration,
          )
          src.connect(filter)
          filter.connect(gain)
        } else {
          src.connect(gain)
        }
        gain.connect(master)

        src.start(t0)
        src.stop(t0 + def.noise.duration + 0.02)
      }
    } catch {
      // Audio API not available
    }
  }

  return {
    playSound,
  }
}
