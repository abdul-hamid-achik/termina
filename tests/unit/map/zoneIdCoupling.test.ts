import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * Trap #9, as a test instead of a note.
 *
 * Zone ids are data. Code that reads meaning OUT of the id string — `zoneId
 * .startsWith('top-')`, `zone.includes('-t3-')` — or that builds an id by
 * gluing parts together (`` `${lane}-t${tier}-${team}` ``) hard-codes the id
 * scheme into logic that has nothing to do with naming. Every zone carries
 * `lane`, `tier`, `team` and `type` as real fields; reading those is both
 * clearer and rename-proof.
 *
 * This is exactly how the radiant/dire rename inverted vision silently, and it
 * was still live in three places afterwards: the ICE-exposure rule parsed the
 * route out of the id and then REBUILT the preceding zone's id from parts (so a
 * rename would have made every T2/T3 permanently attackable), WaveAI decided a
 * wave's route by prefix (a rename strands every wave at spawn), and the client
 * read the tier by substring. None of those would fail a type check or an
 * existing test.
 */
const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const SCAN_DIRS = ['app', 'server', 'shared']

/** Id fragments whose meaning lives in a zone field instead. */
const FORBIDDEN = ['top-', 'mid-', 'bot-', '-chaff', '-audit', '-t1', '-t2', '-t3', '-river']

/**
 * Strip comments before scanning. A guard that trips on prose *describing* the
 * bug it forbids is a guard people delete — the comment on the fixed code in
 * `zones.ts` quotes the old `${lane}-t${tier}-${team}` on purpose.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.nuxt') continue
      sourceFiles(full, out)
    } else if (/\.(ts|vue)$/.test(entry) && !/\.story\.vue$|\.d\.ts$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

describe('zone ids are data, not a parseable encoding', () => {
  const files = SCAN_DIRS.flatMap((d) => sourceFiles(join(ROOT, d)))

  it('scans a non-trivial number of files (the walker itself must not silently pass)', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('no source reads a zone id with startsWith / endsWith / includes', () => {
    const offenders: string[] = []
    // e.g. `.startsWith('top-')`, `.includes("-t3-")`
    const call = /\.(startsWith|endsWith|includes)\(\s*(['"`])([^'"`]+)\2\s*\)/g
    for (const file of files) {
      const src = stripComments(readFileSync(file, 'utf8'))
      for (const m of src.matchAll(call)) {
        const literal = m[3]!
        if (FORBIDDEN.some((frag) => literal.includes(frag))) {
          offenders.push(`${file.slice(ROOT.length)}: .${m[1]}('${literal}')`)
        }
      }
    }
    expect(offenders, `read the zone record instead:\n${offenders.join('\n')}`).toEqual([])
  })

  /**
   * A regex is the same coupling wearing a different hat, and it is how the
   * tutorial's `/fountain|base/.test(zoneId)` survived the first sweep: it
   * stopped matching the instant the zones became rookery-terminal /
   * rookery-anchor, which silently advanced the tutorial while the player was
   * still standing in their base.
   */
  it('no source matches a zone id with a regex over its words', () => {
    const offenders: string[] = []
    const WORDS = ['anchor', 'base', 'cross', 'jungle', 'silt', 'cache', 'hollow']
    const re = /\/([a-z|]+)\/\s*\.test\(/g
    for (const file of files) {
      const src = stripComments(readFileSync(file, 'utf8'))
      for (const m of src.matchAll(re)) {
        const alternation = m[1]!.split('|')
        if (alternation.some((w) => WORDS.includes(w))) {
          offenders.push(`${file.slice(ROOT.length)}: /${m[1]}/.test(...)`)
        }
      }
    }
    expect(offenders, `read the zone's \`type\` instead:\n${offenders.join('\n')}`).toEqual([])
  })

  it('no source assembles a zone id from parts', () => {
    const offenders: string[] = []
    // e.g. `` `${lane}-t${tier}-${team}` `` — an interpolation glued to a tier marker
    const build = /`[^`]*\$\{[^}]+\}-t\$\{[^}]+\}[^`]*`/g
    for (const file of files) {
      const src = stripComments(readFileSync(file, 'utf8'))
      for (const m of src.matchAll(build)) {
        offenders.push(`${file.slice(ROOT.length)}: ${m[0]}`)
      }
    }
    expect(offenders, `look the zone up by its fields instead:\n${offenders.join('\n')}`).toEqual(
      [],
    )
  })
})
