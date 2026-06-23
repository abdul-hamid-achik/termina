import { describe, it, expect } from 'vitest'
import { LANE_ROUTES_CORE, LANE_ROUTES } from '../../../shared/constants/lanes'
import { ZONE_IDS, ZONE_MAP } from '../../../shared/constants/zones'

const zoneSet = new Set<string>(ZONE_IDS)

/** Flatten a route map into { lane, team, path } entries. */
function entries(routes: Record<string, Record<string, string[]>>) {
  return Object.entries(routes).flatMap(([lane, perTeam]) =>
    Object.entries(perTeam).map(([team, path]) => ({ lane, team, path })),
  )
}

const tables: [string, Record<string, Record<string, string[]>>][] = [
  ['LANE_ROUTES_CORE', LANE_ROUTES_CORE],
  ['LANE_ROUTES', LANE_ROUTES],
]

describe('lane routes integrity', () => {
  for (const [name, routes] of tables) {
    describe(name, () => {
      it('references only real zones (no typo waypoints)', () => {
        const bad: string[] = []
        for (const { lane, team, path } of entries(routes)) {
          for (const z of path) {
            if (!zoneSet.has(z)) bad.push(`${lane}/${team}: "${z}"`)
          }
        }
        expect(bad, `unknown zones in ${name}: ${bad.join(', ')}`).toEqual([])
      })

      // Only the real creep lanes are walked one-adjacent-zone-per-step; the
      // "jungle" entry is a list of neutral-camp references, not a walked path.
      const CREEP_LANES = new Set(['top', 'mid', 'bot'])
      it('forms walkable creep paths — each lane step is to an adjacent zone', () => {
        const breaks: string[] = []
        for (const { lane, team, path } of entries(routes)) {
          if (!CREEP_LANES.has(lane)) continue
          for (let i = 1; i < path.length; i++) {
            const from = path[i - 1]!
            const to = path[i]!
            if (!ZONE_MAP[from]?.adjacentTo.includes(to)) {
              breaks.push(`${lane}/${team}: "${from}" -> "${to}"`)
            }
          }
        }
        expect(breaks, `non-adjacent lane steps in ${name}: ${breaks.join(', ')}`).toEqual([])
      })

      it('every lane route is non-empty', () => {
        for (const { lane, team, path } of entries(routes)) {
          expect(path.length, `${lane}/${team}`).toBeGreaterThan(0)
        }
      })
    })
  }
})
