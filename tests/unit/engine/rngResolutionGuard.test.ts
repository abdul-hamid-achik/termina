/**
 * Structural guard for tick-resolution determinism (see
 * server/game/engine/rng.ts). THE BATCH CLOCK IS CANON: the city commits every
 * cycle's actions at once, so replaying the same actions against the same
 * state must always reproduce the same crits, procs, and NPC spawn/target
 * rolls. A bare `Math.random()` call anywhere on the resolution path silently
 * reintroduces the non-determinism the `rngSeed` plumbing exists to remove.
 *
 * This greps the SOURCE of every resolution module GameLoop.processCycle
 * transitively drives, so a future "just add a quick roll" edit can't slip a
 * fresh `Math.random()` in without threading the tick's `rng()` parameter —
 * modeled on the source-grepping style of
 * tests/unit/shared/commandMirrors.test.ts.
 *
 * Allowlist (excluded from the scan, not merely tolerated): StateManager's
 * ONE seed-generation call — that IS the seed, not a resolution outcome — and
 * rng.ts itself, whose doc comments name `Math.random()` in prose.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')

function readSrc(relPath: string): string {
  return readFileSync(resolve(root, relPath), 'utf8')
}

function bareRandomCalls(src: string): string[] {
  return src.match(/Math\.random\(\)/g) ?? []
}

/** Every resolution-path file, minus the two allowlisted files above. Hero
 *  files are listed dynamically so a new hero file is covered automatically. */
const RESOLUTION_FILES = [
  'server/game/engine/GameLoop.ts',
  'server/game/engine/ActionResolver.ts',
  'server/game/engine/DamageCalculator.ts',
  'server/game/engine/CombatResolver.ts',
  'server/game/engine/WaveAI.ts',
  'server/game/engine/IceAI.ts',
  'server/game/engine/NeutralAI.ts',
  'server/game/engine/TenantAI.ts',
  'server/game/engine/CacheAI.ts',
  'server/game/map/spawner.ts',
  'server/game/map/topology.ts',
  'server/game/map/zones.ts',
  ...readdirSync(resolve(root, 'server/game/heroes'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => `server/game/heroes/${f}`),
]

describe('resolution determinism — no bare Math.random() on the tick-resolution path', () => {
  it('the scanned file list is non-empty (guards against a silently-broken glob)', () => {
    expect(RESOLUTION_FILES.length).toBeGreaterThan(15)
  })

  for (const relPath of RESOLUTION_FILES) {
    it(`${relPath} calls no Math.random() — use the threaded rng() instead`, () => {
      const calls = bareRandomCalls(readSrc(relPath))
      expect(
        calls,
        `${relPath} calls Math.random() directly — this reintroduces non-deterministic ` +
          `tick resolution. Thread the cycle's rng() parameter through instead ` +
          `(see server/game/engine/rng.ts and how GameLoop.processCycle derives it).`,
      ).toEqual([])
    })
  }

  it('StateManager keeps exactly its one allowlisted seed-generation call (not zero, not more)', () => {
    const calls = bareRandomCalls(readSrc('server/game/engine/StateManager.ts'))
    expect(
      calls,
      'StateManager should have exactly one Math.random() — the rngSeed generator itself. ' +
        'Zero means the seed stopped being generated; more than one means a new resolution ' +
        'outcome is drawing from an unseeded stream.',
    ).toHaveLength(1)
  })

  it('StateManager stamps rngSeed on every freshly created game', () => {
    const src = readSrc('server/game/engine/StateManager.ts')
    expect(src).toMatch(/rngSeed:\s*Math\.floor\(Math\.random\(\)/)
  })
})
