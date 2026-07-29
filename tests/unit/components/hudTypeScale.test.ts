import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import EnemyThreatSheet from '../../../app/components/game/EnemyThreatSheet.vue'

/**
 * W2-7 — the in-game type floor.
 *
 * The HUD used to be written as one-off sub-rem arbitrary sizes against a 14px
 * root, which rendered most panel text between 7.7px and 11.2px; the enemy
 * cooldown chips, the single highest-value readout in the game, sat at 8.1px.
 * Two things hold the fix in place and both are easy to undo by accident: the
 * root font size, and the discipline of using the `t-hud-*` tiers instead of a
 * fresh `text-[0.58rem]`.
 *
 * Sizes are asserted in px so a change to either half is caught: `--hud-text-xs`
 * only means 12px because the root is 16px.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')
const CSS = read('app/assets/css/terminal.css')
const GAME_SCREEN = read('app/components/game/GameScreen.vue')

/** Root px per `html { font-size: … }` in the base layer. */
const ROOT_PX = Number(/html\s*\{[^}]*font-size:\s*(\d+(?:\.\d+)?)px/.exec(CSS)?.[1])

/** Resolve a `--hud-text-*` declaration to rendered px at the current root. */
function hudTierPx(name: string, source: string): number {
  const rem = /(-?\d*\.?\d+)rem/.exec(
    new RegExp(`--hud-text-${name}:\\s*([^;]+);`).exec(source)?.[1] ?? '',
  )?.[1]
  return Number(rem) * ROOT_PX
}

describe('HUD type floor (W2-7)', () => {
  it('renders the root at the browser default', () => {
    expect(ROOT_PX).toBe(16)
  })

  it('puts both HUD tiers at or above 12px, in order', () => {
    const xs = hudTierPx('xs', CSS)
    const sm = hudTierPx('sm', CSS)

    expect(xs).toBeGreaterThanOrEqual(12)
    expect(sm).toBeGreaterThan(xs)
  })

  it('drives the tier classes off the variables, so density can retune them', () => {
    expect(CSS).toMatch(/\.t-hud-xs\s*\{[^}]*font-size:\s*var\(--hud-text-xs\)/)
    expect(CSS).toMatch(/\.t-hud-sm\s*\{[^}]*font-size:\s*var\(--hud-text-sm\)/)
  })

  it('retunes the tiers through the existing compact density, not a new toggle', () => {
    const compact = /\.game-grid\[data-density='compact'\]\s*\{([^}]*)\}/.exec(GAME_SCREEN)?.[1]
    expect(compact).toBeTruthy()

    const compactXs = hudTierPx('xs', compact!)
    const compactSm = hudTierPx('sm', compact!)

    // Compact buys rows back — smaller than comfortable, but still far above the
    // 7.7px–8.1px this replaced, which is the whole point of the item.
    expect(compactXs).toBeLessThan(hudTierPx('xs', CSS))
    expect(compactSm).toBeLessThan(hudTierPx('sm', CSS))
    expect(compactXs).toBeGreaterThanOrEqual(11)
  })

  it('sizes the enemy cooldown chips off the floor tier', () => {
    const w = mount(EnemyThreatSheet, {
      props: {
        enemies: [
          {
            id: 'e1',
            name: 'enemy_one',
            team: 'dire',
            heroId: 'null_ref',
            zone: 'mid-river',
            hp: 500,
            maxHp: 1000,
            mp: 200,
            maxMp: 400,
            level: 7,
            alive: true,
            cooldowns: { q: 0, w: 3, e: 0, r: 5 },
            items: [],
          },
        ],
        lastSeen: {},
        tick: 10,
      },
    })

    expect(w.get('[data-testid="threat-cd-e1-r"]').classes()).toContain('t-hud-xs')
    w.unmount()
  })
})

describe('HUD type floor: no drift back below it', () => {
  // The components swept for W2-7. Others still carry sub-floor one-offs and are
  // owned elsewhere; this guard covers what has been converted so it stays that
  // way, since re-introducing `text-[0.58rem]` is a one-word change.
  const SWEPT = [
    'app/components/game/GameScreen.vue',
    'app/components/game/CombatLog.vue',
    'app/components/game/WarRoom.vue',
    'app/components/game/EnemyThreatSheet.vue',
    'app/components/game/AllyStatusSheet.vue',
    'app/components/game/AsciiMap.vue',
  ]

  // AsciiMap's mini-overview thumbnail is the documented exemption: its column
  // headers and cells are grid geometry that has to fit the rail's width, not
  // prose. Nothing else may sit below the floor.
  const EXEMPT_LINES = /min-h-\[70px\]|font-bold uppercase tracking-wider text-text-dim|flex h-7/

  it.each(SWEPT)('%s uses the tier classes, not sub-floor arbitrary sizes', (file) => {
    const offenders = read(file)
      .split('\n')
      .filter((line) => {
        const m = /text-\[(\d*\.?\d+)rem\]/.exec(line)
        return m && Number(m[1]) * ROOT_PX < 12 && !EXEMPT_LINES.test(line)
      })

    expect(offenders).toEqual([])
  })
})
