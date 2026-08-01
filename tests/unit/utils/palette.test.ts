import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

/**
 * The PHOSPHOR contract (C3a). One hue, separated by luminance. The old
 * pairwise hue-distance test is mathematically unsatisfiable inside a single
 * hue, so the guard changes shape:
 *
 *  (a) every semantic --color-* token resolves onto a DEFINED ramp step;
 *  (b) adjacent ramp steps are separated by a minimum LUMINANCE delta (a dim
 *      line and a bright one must never read as the same row);
 *  (c) the pairs the combat log renders side by side (damage vs the accent,
 *      healing vs a team line, self vs ability, scrip vs warn) must NOT land
 *      on the SAME ramp step;
 *  (d) every semantic token clears a real contrast floor against the game
 *      background. (a)-(c) are all RELATIVE checks — they say the ramp is
 *      well-spread and the aliases are distinct, and every one of them passed
 *      while `--color-system` sat at 1.59:1 against `--bg-primary`, i.e. while
 *      the token was invisible. Separation is not legibility.
 *
 * Reads the shipped CSS rather than a duplicated table, so a future edit to
 * terminal.css is what it actually guards.
 */
const CSS = readFileSync(
  fileURLToPath(new URL('../../../app/assets/css/terminal.css', import.meta.url)),
  'utf8',
)

type Rgb = [number, number, number]

/** Pull `--name: R G B;` declarations out of the :root block for a prefix. */
function tokensOf(prefix: string): Record<string, Rgb> {
  const start = CSS.indexOf(':root {')
  expect(start, ':root block missing from terminal.css').toBeGreaterThan(-1)
  const end = CSS.indexOf('\n}', start)
  const block = CSS.slice(start, end)
  const out: Record<string, Rgb> = {}
  const re = new RegExp(`--(${prefix}[\\w-]*):\\s*(\\d+)\\s+(\\d+)\\s+(\\d+);`, 'g')
  for (const m of block.matchAll(re)) {
    out[m[1]!] = [Number(m[2]), Number(m[3]), Number(m[4])]
  }
  return out
}

/** Resolve a `--color-x: var(--p-y);` alias to its ramp step name. */
function semanticTargets(): Record<string, string> {
  const start = CSS.indexOf(':root {')
  const end = CSS.indexOf('\n}', start)
  const block = CSS.slice(start, end)
  const out: Record<string, string> = {}
  for (const m of block.matchAll(/--color-([\w-]+):\s*var\((--p-[\w-]+)\);/g)) {
    out[m[1]!] = m[2]!.replace(/^--/, '')
  }
  return out
}

const ramp = tokensOf('p-')
const aliases = semanticTargets()

/** Rec.601 luma — what "this row is brighter than that one" means. */
function luminance([r, g, b]: Rgb): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/** WCAG relative luminance — what "can a human read this" means. */
function relLuminance([r, g, b]: Rgb): number {
  const lin = [r, g, b].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as Rgb
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [relLuminance(a), relLuminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** Pull a plain `--name: R G B;` from :root (backgrounds are not on the ramp). */
function rawToken(name: string): Rgb {
  const m = CSS.match(new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+);`))
  expect(m, `--${name} missing from terminal.css`).toBeTruthy()
  return [Number(m![1]), Number(m![2]), Number(m![3])]
}

const RAMP_ORDER = ['p-0', 'p-1', 'p-2', 'p-3', 'p-4', 'p-5', 'p-accent'] as const

describe('the phosphor contract (C3a)', () => {
  it('declares every ramp step', () => {
    for (const step of RAMP_ORDER) {
      expect(ramp[step], `ramp step ${step} missing`).toBeDefined()
    }
  })

  it('every semantic --color-* token aliases a defined ramp step', () => {
    expect(Object.keys(aliases).length).toBeGreaterThan(0)
    for (const [name, target] of Object.entries(aliases)) {
      expect(ramp[target], `--color-${name} aliases undefined ${target}`).toBeDefined()
    }
  })

  it('adjacent ramp steps differ by a minimum luminance delta', () => {
    const MIN_DELTA = 30
    const steps = RAMP_ORDER.filter((s) => s !== 'p-accent')
    for (let i = 1; i < steps.length; i++) {
      const prev = ramp[steps[i - 1]!]!
      const cur = ramp[steps[i]!]!
      const delta = luminance(cur) - luminance(prev)
      expect(
        delta,
        `${steps[i - 1]} -> ${steps[i]} luminance delta ${delta.toFixed(1)}`,
      ).toBeGreaterThanOrEqual(MIN_DELTA)
    }
  })

  it('no pair the log renders side by side lands on the same ramp step', () => {
    const pairs: Array<[string, string]> = [
      ['damage', 'audit'], // chip vs death/alarm
      ['healing', 'chaff'], // heal vs a team line
      ['self', 'ability'], // ►YOU vs the [ABILITY] tag
      ['gold', 'warn'], // scrip meter uses --color-gold token vs the alarm
      ['system', 'chaff'], // dim system line vs a team line
    ]
    for (const [a, b] of pairs) {
      expect(aliases[a], `--color-${a} missing`).toBeDefined()
      expect(aliases[b], `--color-${b} missing`).toBeDefined()
      expect(aliases[a], `--color-${a} and --color-${b} share ${aliases[a]}`).not.toBe(aliases[b])
    }
  })

  // p-0/p-1 are ground shades (1.1:1 and 1.6:1). They exist to be painted ON,
  // never painted WITH — a semantic token pointing at either one is invisible.
  it('no semantic token aliases a ground step', () => {
    const GROUND = new Set(['p-0', 'p-1'])
    for (const [name, target] of Object.entries(aliases)) {
      expect(GROUND.has(target), `--color-${name} aliases ground step ${target}`).toBe(false)
    }
  })

  it('every semantic token clears the 3:1 non-text contrast floor', () => {
    const bg = rawToken('bg-primary')
    for (const [name, target] of Object.entries(aliases)) {
      const ratio = contrastRatio(ramp[target]!, bg)
      expect(
        ratio,
        `--color-${name} (${target}) is ${ratio.toFixed(2)}:1 on --bg-primary`,
      ).toBeGreaterThanOrEqual(3)
    }
  })

  // The tokens below paint TEXT, not just borders and bars, so they owe the
  // stricter 4.5:1 body-text floor rather than the 3:1 UI floor.
  it('tokens used for body text clear 4.5:1', () => {
    const bg = rawToken('bg-primary')
    for (const name of ['chaff', 'audit', 'self', 'ability', 'zone', 'gold', 'healing']) {
      const target = aliases[name]
      expect(target, `--color-${name} missing`).toBeDefined()
      const ratio = contrastRatio(ramp[target!]!, bg)
      expect(
        ratio,
        `--color-${name} (${target}) is ${ratio.toFixed(2)}:1 on --bg-primary`,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })
})
