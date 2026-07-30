import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { HERO_IDS } from '~~/shared/constants/heroes'

/**
 * R2-08 — the eighteen inked phosphor portraits must exist as committed assets
 * (one 512 + one 64 per hero). Happy-dom never loads images; this is a
 * filesystem contract so a missing public/portraits/ fails unit tests.
 */
const ROOT = resolve(process.cwd(), 'public/portraits')
const ROOT64 = resolve(ROOT, '64')

describe('operator portraits (R2-08)', () => {
  it('ships 36 webp files + PROVENANCE.txt', () => {
    const top = readdirSync(ROOT).filter((f) => f.endsWith('.webp'))
    const small = readdirSync(ROOT64).filter((f) => f.endsWith('.webp'))
    expect(top.sort()).toEqual([...HERO_IDS].map((id) => `${id}.webp`).sort())
    expect(small.sort()).toEqual([...HERO_IDS].map((id) => `${id}.webp`).sort())
    expect(statSync(resolve(ROOT, 'PROVENANCE.txt')).isFile()).toBe(true)
  })

  it('keeps each pair within the size budget and the directory under 2 MB', () => {
    let total = 0
    for (const id of HERO_IDS) {
      const big = statSync(resolve(ROOT, `${id}.webp`)).size
      const sm = statSync(resolve(ROOT64, `${id}.webp`)).size
      expect(big).toBeGreaterThan(0)
      expect(big).toBeLessThanOrEqual(80_000)
      expect(sm).toBeGreaterThan(0)
      expect(sm).toBeLessThanOrEqual(6_000)
      total += big + sm
    }
    expect(total).toBeLessThan(2 * 1024 * 1024)
  })

  it('records model, date and treatment in PROVENANCE.txt', () => {
    const text = readFileSync(resolve(ROOT, 'PROVENANCE.txt'), 'utf8')
    expect(text).toMatch(/MiniMax|image-01/)
    expect(text).toMatch(/2026-07-30/)
    expect(text).toMatch(/phosphor green/)
    expect(text).toMatch(/INK ILLUSTRATION/)
  })

  it('documents light-ground rejection (dark-ground contract)', () => {
    const text = readFileSync(resolve(ROOT, 'PROVENANCE.txt'), 'utf8')
    expect(text).toMatch(/light-ground/)
  })
})
