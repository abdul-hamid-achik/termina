import { useSettingsStore } from '~/stores/settings'

export type SoundName =
  | 'cycle'
  | 'submit'
  | 'damage'
  | 'kill'
  | 'death'
  | 'scrip'
  | 'ready'
  | 'cast'
  | 'ice_fall'
  | 'ice_lost'
  | 'respawn'
  | 'victory'
  | 'defeat'
  | 'double_cast'
  | 'buy'
  | 'scan'
  | 'harden'
  | 'strip'
  | 'burn'
  | 'move'
  | 'grab'

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
  /** Start offset in seconds relative to the sound's t0 (defaults to 0).
   * Lets a sound sequence notes (e.g. a victory fanfare arpeggio) instead of
   * stacking every layer simultaneously. */
  delay?: number
  /**
   * Ring-modulate this layer against a carrier at this frequency (Hz).
   *
   * Multiplying two tones produces their sum and difference and nothing else,
   * so the result is INHARMONIC — bell-like, metallic, wrong in a way the ear
   * reads as machinery rather than music. It is the cheapest route to a timbre
   * that does not belong to any instrument.
   */
  ring?: number
}

interface NoiseLayer {
  duration: number
  gain: number
  /** Filter cutoff (Hz). */
  cutoff?: number
  /** Filter shape. `bandpass` is the modem/handshake texture — a narrow window
   *  of noise reads as *data* where a lowpass thump reads as an impact. */
  filter?: BiquadFilterType
  /** Sweep the cutoff to this value across the layer. Defaults to 0.3x cutoff
   *  (a closing lowpass); set it ABOVE cutoff for an opening hiss. */
  cutoffEnd?: number
  /** Resonance. High Q on a bandpass turns noise into a pitched whistle. */
  q?: number
  delay?: number
}

interface SoundDef {
  oscs?: OscLayer[]
  /** Several noise layers — a burst plus a tail, or two bands at once. */
  noise?: NoiseLayer | NoiseLayer[]
  masterGain?: number
  /**
   * Waveshaper drive on the whole sound. 0 = clean.
   *
   * This is the single biggest lever between "arcade blip" and "something a
   * machine did to you": clipping folds harmonics in that no oscillator stack
   * produces, and it is what makes a sub thump read as a contactor closing
   * rather than as a kick drum.
   */
  drive?: number
  /**
   * Sample-rate crush, in steps. Quantising the waveform aliases it — the grain
   * of a codec that cannot keep up. Small values (8-32) are audible as texture;
   * below 8 it becomes noise.
   */
  crush?: number
}

/* Sound design notes:
 * - Layered oscillators give body + transient.
 * - Detuning a few cents adds a hint of chorus.
 * - Noise burst for percussive impact (damage, kill, death).
 * - Lowpass filter sweep on death gives a "shutdown" feel.
 */
const SOUNDS: Record<SoundName, SoundDef> = {
  // THE CYCLE. Heard every four seconds for a whole match, so it has to survive
  // a thousand repeats without becoming a woodpecker — that rules out a tone.
  // It is a contactor closing: a hard click over a short sub thump, driven so
  // it reads as a mechanism committing rather than a UI beep. The city commits
  // every instruction at once; this is the sound of the batch landing.
  cycle: {
    oscs: [
      { type: 'sine', freqStart: 128, freqEnd: 62, duration: 0.07, gain: 0.16, attack: 0.001 },
    ],
    noise: [{ duration: 0.018, gain: 0.14, cutoff: 3200, filter: 'bandpass', q: 1.4 }],
    drive: 0.5,
    masterGain: 0.75,
  },
  // A keystroke into a deck: contact click, no pitch. A tone here would sing
  // against the cycle every time you type.
  submit: {
    noise: [{ duration: 0.022, gain: 0.13, cutoff: 5200, filter: 'bandpass', q: 2.2 }],
    oscs: [{ type: 'square', freqStart: 210, duration: 0.02, gain: 0.06, attack: 0.001 }],
    drive: 0.3,
    masterGain: 0.85,
  },
  // Damage: crushed impact. The quantisation is the point — this is something
  // failing in a machine, not a drum.
  damage: {
    oscs: [
      { type: 'sawtooth', freqStart: 210, freqEnd: 64, duration: 0.13, gain: 0.3, attack: 0.001 },
      { type: 'square', freqStart: 84, freqEnd: 42, duration: 0.16, gain: 0.16, attack: 0.001 },
    ],
    noise: [{ duration: 0.07, gain: 0.16, cutoff: 2400, filter: 'bandpass', q: 0.8 }],
    drive: 0.9,
    crush: 14,
    masterGain: 0.9,
  },
  // Kill: ring-modulated snap. Inharmonic on purpose — a bell that is wrong.
  // Deliberately NOT the bright rising major stab it used to be: nothing in this
  // world congratulates you.
  kill: {
    oscs: [
      {
        type: 'square',
        freqStart: 440,
        freqEnd: 220,
        duration: 0.2,
        gain: 0.2,
        attack: 0.001,
        ring: 317,
      },
      { type: 'sawtooth', freqStart: 96, freqEnd: 54, duration: 0.26, gain: 0.2, attack: 0.002 },
    ],
    noise: [{ duration: 0.05, gain: 0.14, cutoff: 6000, filter: 'highpass' }],
    drive: 0.7,
    masterGain: 0.95,
  },
  // Death: a carrier losing lock. Pitch collapses, the band narrows to nothing,
  // and the sub keeps going after the signal is gone.
  death: {
    oscs: [
      { type: 'sawtooth', freqStart: 620, freqEnd: 41, duration: 0.55, gain: 0.26, attack: 0.004 },
      { type: 'sine', freqStart: 150, freqEnd: 32, duration: 0.75, gain: 0.24, attack: 0.01 },
    ],
    noise: [
      { duration: 0.5, gain: 0.12, cutoff: 2600, cutoffEnd: 120, filter: 'bandpass', q: 1.1 },
    ],
    drive: 0.55,
    crush: 10,
    masterGain: 0.95,
  },
  // Scrip: a data burst, not a coin. Two fast FSK-ish chirps — payload taken.
  scrip: {
    oscs: [
      { type: 'square', freqStart: 1580, duration: 0.022, gain: 0.09, attack: 0.001 },
      { type: 'square', freqStart: 2260, duration: 0.026, gain: 0.08, attack: 0.001, delay: 0.03 },
    ],
    crush: 20,
    masterGain: 0.7,
  },
  // Ready / level up: a comms handshake answering. Two tones a fourth apart,
  // clean, with a hiss opening behind them — capability arriving.
  ready: {
    oscs: [
      { type: 'triangle', freqStart: 590, duration: 0.09, gain: 0.16, attack: 0.003 },
      { type: 'triangle', freqStart: 786, duration: 0.13, gain: 0.15, attack: 0.003, delay: 0.08 },
    ],
    noise: [
      { duration: 0.2, gain: 0.05, cutoff: 900, cutoffEnd: 5200, filter: 'bandpass', q: 0.7 },
    ],
    masterGain: 0.8,
  },
  // Cast: a routine executing — filtered sweep opening, with drive so it has
  // teeth. Short, because it fires constantly.
  cast: {
    oscs: [
      { type: 'sawtooth', freqStart: 300, freqEnd: 720, duration: 0.11, gain: 0.15, attack: 0.002 },
    ],
    noise: [
      { duration: 0.1, gain: 0.08, cutoff: 700, cutoffEnd: 4800, filter: 'bandpass', q: 1.2 },
    ],
    drive: 0.6,
    masterGain: 0.8,
  },
  // ICE falling: structure giving way. Distorted sub with a long debris tail.
  ice_fall: {
    oscs: [
      { type: 'sawtooth', freqStart: 74, freqEnd: 33, duration: 0.5, gain: 0.34, attack: 0.004 },
      { type: 'square', freqStart: 148, freqEnd: 52, duration: 0.4, gain: 0.14, attack: 0.004 },
    ],
    noise: [
      { duration: 0.12, gain: 0.2, cutoff: 4200, filter: 'bandpass', q: 0.6 },
      { duration: 0.45, gain: 0.13, cutoff: 1100, cutoffEnd: 200, delay: 0.08 },
    ],
    drive: 0.8,
    crush: 12,
    masterGain: 0.95,
  },
  // OUR ice falling: the same collapse with the bright debris stripped and the
  // pitch in the basement, so "ours fell" can never read as "we broke theirs".
  ice_lost: {
    oscs: [
      { type: 'sawtooth', freqStart: 52, freqEnd: 24, duration: 0.7, gain: 0.3, attack: 0.008 },
      { type: 'sine', freqStart: 104, freqEnd: 30, duration: 0.6, gain: 0.2, attack: 0.008 },
    ],
    noise: [{ duration: 0.5, gain: 0.12, cutoff: 420, cutoffEnd: 90 }],
    drive: 0.7,
    crush: 8,
    masterGain: 0.9,
  },
  // Respawn: the death sweep run backwards — a carrier re-acquiring lock.
  respawn: {
    oscs: [
      { type: 'sawtooth', freqStart: 48, freqEnd: 520, duration: 0.4, gain: 0.2, attack: 0.02 },
      { type: 'triangle', freqStart: 660, duration: 0.14, gain: 0.14, attack: 0.004, delay: 0.38 },
    ],
    noise: [{ duration: 0.35, gain: 0.09, cutoff: 200, cutoffEnd: 4000, filter: 'bandpass', q: 1 }],
    drive: 0.35,
    masterGain: 0.85,
  },
  // Victory: not a fanfare. Three ring-modulated tones walking UP, cold and
  // metallic — a system reporting a result it has no feelings about.
  victory: {
    oscs: [
      { type: 'square', freqStart: 262, duration: 0.3, gain: 0.16, attack: 0.006, ring: 131 },
      {
        type: 'square',
        freqStart: 349,
        duration: 0.3,
        gain: 0.16,
        attack: 0.006,
        delay: 0.16,
        ring: 131,
      },
      {
        type: 'square',
        freqStart: 524,
        duration: 0.6,
        gain: 0.18,
        attack: 0.008,
        delay: 0.32,
        ring: 131,
      },
      { type: 'sine', freqStart: 65, duration: 1.0, gain: 0.2, attack: 0.02 },
    ],
    noise: [
      { duration: 0.8, gain: 0.06, cutoff: 600, cutoffEnd: 4000, filter: 'bandpass', q: 0.8 },
    ],
    drive: 0.4,
    masterGain: 0.9,
  },
  // Defeat: the same three tones walking DOWN, and the sub outlives them.
  defeat: {
    oscs: [
      { type: 'square', freqStart: 392, duration: 0.3, gain: 0.15, attack: 0.008, ring: 97 },
      {
        type: 'square',
        freqStart: 294,
        duration: 0.35,
        gain: 0.15,
        attack: 0.008,
        delay: 0.18,
        ring: 97,
      },
      {
        type: 'square',
        freqStart: 196,
        duration: 0.7,
        gain: 0.16,
        attack: 0.01,
        delay: 0.38,
        ring: 97,
      },
      { type: 'sine', freqStart: 58, freqEnd: 29, duration: 1.4, gain: 0.22, attack: 0.03 },
    ],
    noise: [{ duration: 0.9, gain: 0.08, cutoff: 1400, cutoffEnd: 90 }],
    drive: 0.5,
    crush: 10,
    masterGain: 0.9,
  },
  // Double cast: the routine firing twice — the same chirp, stuttered.
  double_cast: {
    oscs: [
      { type: 'square', freqStart: 1180, duration: 0.03, gain: 0.11, attack: 0.001 },
      { type: 'square', freqStart: 1180, duration: 0.05, gain: 0.12, attack: 0.001, delay: 0.045 },
    ],
    crush: 16,
    drive: 0.3,
    masterGain: 0.75,
  },
  // Buy: a deck handshake closing a purchase. Heavier than scrip — three
  // FSK chips then a sub confirm — so the shop is not silent and is not a coin.
  buy: {
    oscs: [
      { type: 'square', freqStart: 1320, duration: 0.028, gain: 0.1, attack: 0.001 },
      { type: 'square', freqStart: 1760, duration: 0.03, gain: 0.09, attack: 0.001, delay: 0.032 },
      { type: 'square', freqStart: 2200, duration: 0.034, gain: 0.08, attack: 0.001, delay: 0.068 },
      {
        type: 'sine',
        freqStart: 82,
        freqEnd: 55,
        duration: 0.16,
        gain: 0.14,
        attack: 0.004,
        delay: 0.04,
      },
    ],
    crush: 18,
    drive: 0.35,
    masterGain: 0.8,
  },
  // Scan / map: a carrier opening a window. Bandpass hiss sweeps up, a thin
  // tone locks — looking at the ground, not spending the cycle.
  scan: {
    oscs: [
      { type: 'triangle', freqStart: 480, freqEnd: 960, duration: 0.16, gain: 0.1, attack: 0.004 },
      { type: 'sine', freqStart: 1920, duration: 0.06, gain: 0.05, attack: 0.002, delay: 0.12 },
    ],
    noise: [
      { duration: 0.22, gain: 0.08, cutoff: 400, cutoffEnd: 6400, filter: 'bandpass', q: 1.4 },
    ],
    masterGain: 0.75,
  },
  // Harden: ICE locking. Ring-mod clang + sub slam — team structures going
  // invulnerable, not a buff jingle.
  harden: {
    oscs: [
      {
        type: 'square',
        freqStart: 330,
        freqEnd: 165,
        duration: 0.28,
        gain: 0.16,
        attack: 0.002,
        ring: 187,
      },
      { type: 'sine', freqStart: 62, freqEnd: 44, duration: 0.4, gain: 0.2, attack: 0.006 },
    ],
    noise: [{ duration: 0.12, gain: 0.1, cutoff: 2800, filter: 'bandpass', q: 1.6 }],
    drive: 0.65,
    masterGain: 0.9,
  },
  // Strip: payload taken. Brighter and longer than the generic scrip burst so
  // a last-hit reads as the hit that paid, not as a coin.
  strip: {
    oscs: [
      { type: 'square', freqStart: 1480, duration: 0.024, gain: 0.1, attack: 0.001 },
      { type: 'square', freqStart: 1980, duration: 0.03, gain: 0.1, attack: 0.001, delay: 0.028 },
      {
        type: 'triangle',
        freqStart: 880,
        freqEnd: 1320,
        duration: 0.09,
        gain: 0.08,
        attack: 0.002,
        delay: 0.05,
      },
    ],
    noise: [{ duration: 0.04, gain: 0.07, cutoff: 5000, filter: 'highpass' }],
    crush: 22,
    masterGain: 0.78,
  },
  // Burn: the same family walking DOWN — you denied the payload, you did not
  // take it. Must never read as a strip.
  burn: {
    oscs: [
      { type: 'square', freqStart: 1320, duration: 0.024, gain: 0.09, attack: 0.001 },
      { type: 'square', freqStart: 740, duration: 0.04, gain: 0.1, attack: 0.001, delay: 0.03 },
      {
        type: 'sine',
        freqStart: 196,
        freqEnd: 98,
        duration: 0.14,
        gain: 0.1,
        attack: 0.004,
        delay: 0.04,
      },
    ],
    crush: 16,
    drive: 0.4,
    masterGain: 0.75,
  },
  // Move: a hop committing. Contact click + a short pitch step so walking is
  // not the same keystroke as submitting chat.
  move: {
    oscs: [
      { type: 'triangle', freqStart: 310, freqEnd: 420, duration: 0.05, gain: 0.08, attack: 0.001 },
    ],
    noise: [{ duration: 0.02, gain: 0.09, cutoff: 3600, filter: 'bandpass', q: 1.8 }],
    masterGain: 0.7,
  },
  // Grab: a cache handle taken. Handshake answering, shorter than ready.
  grab: {
    oscs: [
      { type: 'triangle', freqStart: 524, duration: 0.07, gain: 0.12, attack: 0.003 },
      { type: 'triangle', freqStart: 786, duration: 0.1, gain: 0.11, attack: 0.003, delay: 0.06 },
    ],
    crush: 24,
    masterGain: 0.75,
  },
}

/* A tick resolves in a single JS task, so every effect for that tick calls
 * playSound at the SAME ctx.currentTime. Identical waveforms starting perfectly
 * phase-aligned sum into one clipped transient instead of reading as N hits, so
 * the sounds that arrive in bursts get a minimum spacing (seconds) between
 * repeats. Sounds absent from this map are unchanged — a lone cue must still
 * fire exactly on the beat. */
const MIN_GAP: Partial<Record<SoundName, number>> = {
  damage: 0.06,
  cast: 0.05,
  scrip: 0.04,
  strip: 0.05,
  burn: 0.05,
  move: 0.04,
}

/** A repeat pushed further out than this would land under the NEXT tick's
 * events, so it is dropped instead — which also bounds a runaway burst. */
const MAX_STAGGER = 0.25

const lastStart = new Map<SoundName, number>()

/**
 * Cues that mark TIME rather than events. They are correct at full level in a
 * quiet cycle and exhausting during a five-man fight, where they compete with
 * the sounds that actually carry information.
 *
 * `cycle` fires every four seconds for a whole match; `submit` fires on every
 * keystroke. Neither ever needs to be heard over a kill.
 */
const AMBIENT: ReadonlySet<SoundName> = new Set(['cycle', 'submit'])

/** Cues that mean something happened, and so drive the duck. */
const ACTIVITY_WINDOW = 1.2
const activity: number[] = []

/**
 * How far to pull the ambient cues down, from the density of real events in the
 * last second or so.
 *
 * Floors at 0.35 rather than 0 — the cycle tick is the beat the whole HUD is
 * timed against, and a player who cannot hear it at all has lost the clock.
 */
function ambientDuck(now: number): number {
  while (activity.length && now - activity[0]! > ACTIVITY_WINDOW) activity.shift()
  if (activity.length <= 1) return 1
  return Math.max(0.35, 1 - (activity.length - 1) * 0.18)
}

/**
 * Waveshaper curve for `drive`. `tanh`-ish soft clip: harmonics fold in
 * progressively rather than the sound simply squaring off, so a low value reads
 * as weight and a high one as damage.
 */
function makeDriveCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024
  const curve = new Float32Array(new ArrayBuffer(n * 4))
  const k = amount * 40
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x))
  }
  return curve
}

/** Waveshaper curve for `crush`: quantise to N steps. Pure aliasing, no filter. */
function makeCrushCurve(steps: number): Float32Array<ArrayBuffer> {
  const n = 1024
  const curve = new Float32Array(new ArrayBuffer(n * 4))
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1
    curve[i] = Math.round(x * steps) / steps
  }
  return curve
}

function makeNoiseBuffer(ctx: AudioContext, duration: number): AudioBuffer {
  const sampleRate = ctx.sampleRate
  const length = Math.max(1, Math.floor(sampleRate * duration))
  const buffer = ctx.createBuffer(1, length, sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
  return buffer
}

/* ── Background bed ──────────────────────────────────────────────────
 * The city commits on a four-second clock. The bed is scored at 60 BPM so
 * one bar IS one cycle — drone + cable hiss under a 16-beat (four-cycle)
 * phrase in stacked fourths/fifths. It is machinery that happens to be in
 * time, not a soundtrack congratulating anyone.
 *
 * Kept synth-only (no sample files). Duck the bed when real events land so
 * it never fights a kill. */
const BED_BEAT = 1
const BED_PHRASE = 16
/** Quiet on purpose: SFX carry information; this is the floor under them. */
const BED_LEVEL = 0.22

// A1 / E1 / G1 / C2 — industrial, not a major lift.
const BASS: Array<number | null> = [
  55,
  null,
  55,
  41.25,
  55,
  65.41,
  null,
  41.25,
  55,
  null,
  49,
  41.25,
  55,
  49,
  41.25,
  null,
]
const PAD: Array<[number, number] | null> = [
  [110, 164.81],
  null,
  null,
  null,
  [130.81, 196],
  null,
  null,
  null,
  [110, 164.81],
  null,
  null,
  null,
  [98, 146.83],
  null,
  null,
  null,
]
const LEAD: Array<number | null> = [
  220,
  null,
  null,
  null,
  null,
  null,
  261.63,
  null,
  164.81,
  null,
  null,
  null,
  null,
  196,
  null,
  null,
]

interface BedGraph {
  master: GainNode
  duck: GainNode
  mix: GainNode
  oscs: OscillatorNode[]
  sources: AudioBufferSourceNode[]
  timer: ReturnType<typeof setTimeout> | null
  nextBeat: number
  beatIndex: number
}

let bed: BedGraph | null = null

function bedWanted(): boolean {
  const settings = useSettingsStore()
  return Boolean(settings.audioEnabled && settings.musicEnabled)
}

function applyBedGain(now?: number) {
  if (!bed || !audioCtx) return
  const settings = useSettingsStore()
  const on = settings.audioEnabled && settings.musicEnabled
  const target = on ? settings.audioVolume * BED_LEVEL : 0
  const t = now ?? audioCtx.currentTime
  bed.master.gain.cancelScheduledValues(t)
  bed.master.gain.setTargetAtTime(target, t, 0.12)
}

function duckBed(now: number) {
  if (!bed) return
  const duck = bed.duck.gain
  duck.cancelScheduledValues(now)
  duck.setValueAtTime(Math.min(duck.value || 1, 0.38), now)
  duck.setTargetAtTime(1, now + 1.05, 0.42)
}

function playBedTone(
  ctx: AudioContext,
  dest: AudioNode,
  at: number,
  freq: number,
  duration: number,
  gain: number,
  type: OscillatorType,
  ring?: number,
) {
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, at)
  g.gain.setValueAtTime(0, at)
  g.gain.linearRampToValueAtTime(gain, at + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, at + duration)
  if (ring) {
    const carrier = ctx.createOscillator()
    const ringGain = ctx.createGain()
    carrier.type = 'sine'
    carrier.frequency.setValueAtTime(ring, at)
    ringGain.gain.setValueAtTime(0, at)
    carrier.connect(ringGain.gain)
    osc.connect(ringGain)
    ringGain.connect(g)
    carrier.start(at)
    carrier.stop(at + duration + 0.02)
  } else {
    osc.connect(g)
  }
  g.connect(dest)
  osc.start(at)
  osc.stop(at + duration + 0.02)
}

function scheduleBedBeat(graph: BedGraph, beat: number, at: number) {
  if (!audioCtx) return
  const dest = graph.mix
  const bass = BASS[beat]
  if (bass) playBedTone(audioCtx, dest, at, bass, 0.82, 0.07, 'sine')
  const pad = PAD[beat]
  if (pad) {
    playBedTone(audioCtx, dest, at, pad[0], 3.7, 0.028, 'triangle')
    playBedTone(audioCtx, dest, at, pad[1], 3.7, 0.022, 'triangle')
  }
  const lead = LEAD[beat]
  if (lead) playBedTone(audioCtx, dest, at, lead, 0.38, 0.03, 'square', 73)
}

function pumpBed() {
  if (!bed || !audioCtx) return
  const horizon = audioCtx.currentTime + 0.25
  while (bed.nextBeat < horizon) {
    scheduleBedBeat(bed, bed.beatIndex % BED_PHRASE, bed.nextBeat)
    bed.beatIndex += 1
    bed.nextBeat += BED_BEAT
  }
  bed.timer = setTimeout(pumpBed, 80)
}

function startBed() {
  if (import.meta.server) return
  if (!bedWanted()) {
    stopBed()
    return
  }
  try {
    const ctx = getContext()
    if (ctx.state === 'suspended') ctx.resume()
    if (bed) {
      applyBedGain()
      return
    }

    const mix = ctx.createGain()
    mix.gain.value = 1
    const duck = ctx.createGain()
    duck.gain.value = 1
    const master = ctx.createGain()
    master.gain.value = 0
    mix.connect(duck)
    duck.connect(master)
    master.connect(ctx.destination)

    const oscs: OscillatorNode[] = []
    const sources: AudioBufferSourceNode[] = []

    // Mains hum — two quiet sines a fifth apart.
    for (const [freq, gain] of [
      [55, 0.09],
      [82.5, 0.045],
    ] as const) {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, ctx.currentTime)
      g.gain.value = gain
      osc.connect(g)
      g.connect(mix)
      osc.start()
      oscs.push(osc)
    }

    // Cable hiss: looping noise through a slow-opening bandpass.
    const hiss = ctx.createBufferSource()
    hiss.buffer = makeNoiseBuffer(ctx, 4)
    hiss.loop = true
    const hissFilter = ctx.createBiquadFilter()
    hissFilter.type = 'bandpass'
    hissFilter.frequency.setValueAtTime(900, ctx.currentTime)
    hissFilter.Q.setValueAtTime(0.7, ctx.currentTime)
    const hissGain = ctx.createGain()
    hissGain.gain.value = 0.035
    const lfo = ctx.createOscillator()
    const lfoGain = ctx.createGain()
    lfo.type = 'sine'
    lfo.frequency.setValueAtTime(0.07, ctx.currentTime)
    lfoGain.gain.value = 420
    lfo.connect(lfoGain)
    lfoGain.connect(hissFilter.frequency)
    hiss.connect(hissFilter)
    hissFilter.connect(hissGain)
    hissGain.connect(mix)
    hiss.start()
    lfo.start()
    sources.push(hiss)
    oscs.push(lfo)

    bed = {
      master,
      duck,
      mix,
      oscs,
      sources,
      timer: null,
      nextBeat: ctx.currentTime + 0.05,
      beatIndex: 0,
    }
    applyBedGain()
    pumpBed()
  } catch {
    // Audio API not available
  }
}

function stopBed() {
  if (!bed) return
  const graph = bed
  bed = null
  if (graph.timer != null) clearTimeout(graph.timer)
  try {
    const now = audioCtx?.currentTime ?? 0
    graph.master.gain.cancelScheduledValues(now)
    graph.master.gain.setTargetAtTime(0, now, 0.04)
    for (const osc of graph.oscs) {
      try {
        osc.stop()
      } catch {
        /* already stopped */
      }
    }
    for (const src of graph.sources) {
      try {
        src.stop()
      } catch {
        /* already stopped */
      }
    }
  } catch {
    // Audio API not available
  }
}

/** Rebuild / tear down the bed from the current settings (mount + toggles). */
function syncBed() {
  if (bedWanted()) startBed()
  else stopBed()
}

/** Test hook: drop the shared graph so suites do not leak oscillators. */
export function resetAudioGraph() {
  stopBed()
  audioCtx = null
  lastStart.clear()
  activity.length = 0
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

      const now = ctx.currentTime
      // We never schedule beyond now + MAX_STAGGER, so a previous start past
      // that can only mean the context clock restarted — ignore it rather than
      // muting the sound forever.
      const prev = lastStart.get(name) ?? -Infinity
      const stale = prev > now + MAX_STAGGER
      const t0 = stale ? now : Math.max(now, prev + (MIN_GAP[name] ?? 0))
      if (t0 - now > MAX_STAGGER) return
      lastStart.set(name, t0)

      // Event cues set the duck; ambient cues read it. The bed ducks with them.
      if (!AMBIENT.has(name)) {
        activity.push(t0)
        duckBed(t0)
      }

      const master = ctx.createGain()
      const duck = AMBIENT.has(name) ? ambientDuck(t0) : 1
      master.gain.value = (def.masterGain ?? 1) * settings.audioVolume * duck

      // Shaping chain: master -> [crush] -> [drive] -> out. Both are optional
      // and both are what separate this palette from an arcade blip.
      let tail: AudioNode = master
      if (def.crush) {
        const crusher = ctx.createWaveShaper()
        crusher.curve = makeCrushCurve(def.crush)
        tail.connect(crusher)
        tail = crusher
      }
      if (def.drive) {
        const shaper = ctx.createWaveShaper()
        shaper.curve = makeDriveCurve(def.drive)
        shaper.oversample = '4x'
        tail.connect(shaper)
        // Clipping adds energy; trim so a driven sound is not simply louder.
        const trim = ctx.createGain()
        trim.gain.value = 1 / (1 + def.drive * 0.8)
        shaper.connect(trim)
        tail = trim
      }
      tail.connect(ctx.destination)

      // Oscillator layers
      for (const layer of def.oscs ?? []) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()

        const start = t0 + (layer.delay ?? 0)

        osc.type = layer.type
        osc.frequency.setValueAtTime(layer.freqStart, start)
        if (layer.freqEnd !== undefined) {
          osc.frequency.exponentialRampToValueAtTime(
            Math.max(layer.freqEnd, 1),
            start + layer.duration,
          )
        }
        if (layer.detune) osc.detune.setValueAtTime(layer.detune, start)

        const peak = layer.peak ?? layer.gain
        const attack = layer.attack ?? 0.005
        gain.gain.setValueAtTime(0, start)
        gain.gain.linearRampToValueAtTime(peak, start + attack)
        gain.gain.exponentialRampToValueAtTime(0.0001, start + layer.duration)

        if (layer.ring) {
          // osc * carrier. A GainNode with its gain driven by an oscillator IS
          // a multiplier, so the carrier feeds the gain param, not the input.
          const carrier = ctx.createOscillator()
          const ringGain = ctx.createGain()
          carrier.type = 'sine'
          carrier.frequency.setValueAtTime(layer.ring, start)
          ringGain.gain.setValueAtTime(0, start)
          carrier.connect(ringGain.gain)
          osc.connect(ringGain)
          ringGain.connect(gain)
          carrier.start(start)
          carrier.stop(start + layer.duration + 0.02)
        } else {
          osc.connect(gain)
        }
        gain.connect(master)
        osc.start(start)
        osc.stop(start + layer.duration + 0.02)
      }

      // Noise layers — a burst plus a tail, or two bands at once.
      for (const layer of def.noise ? (Array.isArray(def.noise) ? def.noise : [def.noise]) : []) {
        const start = t0 + (layer.delay ?? 0)
        const src = ctx.createBufferSource()
        src.buffer = makeNoiseBuffer(ctx, layer.duration)

        const gain = ctx.createGain()
        gain.gain.setValueAtTime(0, start)
        gain.gain.linearRampToValueAtTime(layer.gain, start + 0.002)
        gain.gain.exponentialRampToValueAtTime(0.0001, start + layer.duration)

        if (layer.cutoff) {
          const filter = ctx.createBiquadFilter()
          filter.type = layer.filter ?? 'lowpass'
          if (layer.q) filter.Q.setValueAtTime(layer.q, start)
          filter.frequency.setValueAtTime(layer.cutoff, start)
          filter.frequency.exponentialRampToValueAtTime(
            Math.max(layer.cutoffEnd ?? layer.cutoff * 0.3, 80),
            start + layer.duration,
          )
          src.connect(filter)
          filter.connect(gain)
        } else {
          src.connect(gain)
        }
        gain.connect(master)

        src.start(start)
        src.stop(start + layer.duration + 0.02)
      }
    } catch {
      // Audio API not available
    }
  }

  return {
    playSound,
    startBed,
    stopBed,
    syncBed,
  }
}
