import { useSettingsStore } from '~/stores/settings'

export type SoundName = 'tick' | 'submit' | 'damage' | 'kill' | 'death' | 'gold' | 'ready'

interface SoundDef {
  type: OscillatorType
  freqStart: number
  freqEnd?: number
  duration: number
  gain: number
}

const SOUNDS: Record<SoundName, SoundDef> = {
  tick: { type: 'sine', freqStart: 800, duration: 0.05, gain: 0.15 },
  submit: { type: 'square', freqStart: 1200, duration: 0.03, gain: 0.1 },
  damage: { type: 'sawtooth', freqStart: 200, duration: 0.1, gain: 0.2 },
  kill: { type: 'square', freqStart: 400, freqEnd: 800, duration: 0.2, gain: 0.25 },
  death: { type: 'square', freqStart: 800, freqEnd: 200, duration: 0.3, gain: 0.25 },
  gold: { type: 'sine', freqStart: 1000, duration: 0.08, gain: 0.15 },
  ready: { type: 'sine', freqStart: 600, duration: 0.1, gain: 0.15 },
}

let audioCtx: AudioContext | null = null

function getContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext()
  }
  return audioCtx
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

      const osc = ctx.createOscillator()
      const gainNode = ctx.createGain()

      osc.type = def.type
      osc.frequency.setValueAtTime(def.freqStart, ctx.currentTime)
      if (def.freqEnd) {
        osc.frequency.linearRampToValueAtTime(def.freqEnd, ctx.currentTime + def.duration)
      }

      gainNode.gain.setValueAtTime(def.gain * settings.audioVolume, ctx.currentTime)
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + def.duration)

      osc.connect(gainNode)
      gainNode.connect(ctx.destination)

      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + def.duration + 0.01)
    } catch {
      // Audio API not available
    }
  }

  return {
    playSound,
  }
}
