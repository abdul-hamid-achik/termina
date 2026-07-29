import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

/**
 * The palette is the log's typography. Nine `CombatLineType` values, the map,
 * the HUD and every toast are separated ONLY by color, so two tokens sitting a
 * few RGB units apart silently erase a distinction the code believes it makes —
 * which is exactly how a hero death came to render in the same red as creep
 * chip damage, and how the colorblind palette put the enemy team, the gold
 * counter and every warning on the same orange.
 *
 * These tests read the shipped CSS rather than a duplicated table, so a future
 * edit to terminal.css is what they actually guard.
 */
const CSS = readFileSync(
  fileURLToPath(new URL('../../../app/assets/css/terminal.css', import.meta.url)),
  'utf8',
)

type Rgb = [number, number, number]

/** Pull the `--color-*: R G B;` declarations out of one CSS rule block. */
function paletteOf(selector: string): Record<string, Rgb> {
  const start = CSS.indexOf(`${selector} {`)
  expect(start, `${selector} block missing from terminal.css`).toBeGreaterThan(-1)
  const end = CSS.indexOf('\n}', start)
  const block = CSS.slice(start, end)
  const out: Record<string, Rgb> = {}
  for (const m of block.matchAll(/--color-([\w-]+):\s*(\d+)\s+(\d+)\s+(\d+);/g)) {
    out[m[1]!] = [Number(m[2]), Number(m[3]), Number(m[4])]
  }
  return out
}

const base = paletteOf(':root')
const colorblind = { ...base, ...paletteOf('.palette-colorblind') }

/**
 * Semantic tokens that can appear side by side on one screen. The `-deep`
 * variants are deliberately near their parent (gradient siblings), so they are
 * not part of the set.
 */
const SEMANTIC = [
  'radiant',
  'dire',
  'self',
  'gold',
  'mana',
  'damage',
  'healing',
  'system',
  'zone',
  'ability',
  'warn',
] as const

/** Straight RGB distance — crude, but it is what "these look the same" means. */
function distance(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

/** Below this two tokens read as the same color at HUD type sizes. */
const MIN_DISTANCE = 45

function closestPair(palette: Record<string, Rgb>): { pair: string; d: number } {
  let worst = { pair: '', d: Number.POSITIVE_INFINITY }
  for (let i = 0; i < SEMANTIC.length; i++) {
    for (let j = i + 1; j < SEMANTIC.length; j++) {
      const a = SEMANTIC[i]!
      const b = SEMANTIC[j]!
      const ca = palette[a]
      const cb = palette[b]
      expect(ca, `--color-${a} is not defined`).toBeDefined()
      expect(cb, `--color-${b} is not defined`).toBeDefined()
      const d = distance(ca!, cb!)
      if (d < worst.d) worst = { pair: `${a}/${b}`, d }
    }
  }
  return worst
}

describe('terminal palette', () => {
  it('keeps every semantic color distinguishable in the default palette', () => {
    const worst = closestPair(base)
    expect(worst.d, `closest pair: ${worst.pair}`).toBeGreaterThanOrEqual(MIN_DISTANCE)
  })

  it('keeps them distinguishable in the colorblind palette too', () => {
    // The Okabe-Ito remap moves dire onto orange; gold and warn have to move
    // with it or the swap trades one collision for three.
    const worst = closestPair(colorblind)
    expect(worst.d, `closest pair: ${worst.pair}`).toBeGreaterThanOrEqual(MIN_DISTANCE)
  })

  it('separates the pairs the combat log renders next to each other', () => {
    // Chip damage vs a death, a heal vs the team, the ►YOU marker vs a spell.
    for (const [a, b] of [
      ['damage', 'dire'],
      ['healing', 'radiant'],
      ['self', 'ability'],
      ['gold', 'warn'],
    ] as const) {
      expect(distance(base[a]!, base[b]!), `${a} vs ${b}`).toBeGreaterThanOrEqual(MIN_DISTANCE)
      expect(distance(colorblind[a]!, colorblind[b]!), `${a} vs ${b} (cvd)`).toBeGreaterThanOrEqual(
        MIN_DISTANCE,
      )
    }
  })
})
