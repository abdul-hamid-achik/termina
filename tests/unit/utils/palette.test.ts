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
 *      healing vs a team line, self vs ability, gold vs warn) must NOT land
 *      on the SAME ramp step.
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
      expect(delta, `${steps[i - 1]} -> ${steps[i]} luminance delta ${delta.toFixed(1)}`).toBeGreaterThanOrEqual(
        MIN_DELTA,
      )
    }
  })

  it('no pair the log renders side by side lands on the same ramp step', () => {
    const pairs: Array<[string, string]> = [
      ['damage', 'audit'], // chip vs death/alarm
      ['healing', 'chaff'], // heal vs a team line
      ['self', 'ability'], // ►YOU vs the [ABILITY] tag
      ['gold', 'warn'], // bank balance vs the alarm
      ['system', 'chaff'], // dim system line vs a team line
    ]
    for (const [a, b] of pairs) {
      expect(aliases[a], `--color-${a} missing`).toBeDefined()
      expect(aliases[b], `--color-${b} missing`).toBeDefined()
      expect(aliases[a], `--color-${a} and --color-${b} share ${aliases[a]}`).not.toBe(aliases[b])
    }
  })
})
