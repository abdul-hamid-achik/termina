import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * GameEngineEvent is a discriminated union on `_tag`. Two interfaces sharing a
 * tag make narrowing ambiguous (a `switch (e._tag)` sees the intersection of
 * both shapes), so every tag must be declared exactly once.
 */
describe('protocol/events.ts discriminants', () => {
  const src = readFileSync(resolve(__dirname, '../../../server/game/protocol/events.ts'), 'utf8')
  const tags = [...src.matchAll(/readonly _tag: '([a-z_0-9]+)'/g)].map((m) => m[1]!)

  it('declares a healthy number of events', () => {
    expect(tags.length).toBeGreaterThan(20)
  })

  it('never declares the same _tag on two interfaces', () => {
    const seen = new Map<string, number>()
    for (const t of tags) seen.set(t, (seen.get(t) ?? 0) + 1)
    const dupes = [...seen].filter(([, n]) => n > 1).map(([t]) => t)
    expect(dupes).toEqual([])
  })
})
