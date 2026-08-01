import { describe, it, expect } from 'vitest'
import { ZONES, ZONE_MAP, ZONE_IDS } from '~~/shared/constants/zones'
import { LANE_ROUTES_CORE, LANE_ROUTES } from '~~/shared/constants/lanes'
import { findPath } from '~~/shared/pathfinding'
import { areAdjacent } from '~~/server/game/map/topology'
import { resolveZoneAlias, ZONE_ALIASES } from '~/composables/useCommands'
import type { TeamId } from '~~/shared/types/game'
import { seedGame, HUMAN } from './harness'

/**
 * The map's vocabulary contract.
 *
 * Every zone id moved in the Aug 1 sweep (chaff-base → rookery-terminal,
 * top-t1-chaff → seawall-t1-chaff, mid-river → coldstore-cross, …). The engine
 * survived because nothing parses ids any more — but the *tables that name
 * zones* are hand-written and can drift from `ZONES` without any type error:
 *
 *  - `ZONE_ALIASES` maps a typed word to an id. A stale entry means the player
 *    types a word the UI advertises and the server rejects it, burning the cycle.
 *  - `LANE_ROUTES_CORE` / `LANE_ROUTES` list ids in walking order. A stale entry
 *    strands waves or bots mid-route with no error anywhere.
 *
 * These are the failure modes a human notices in the first minute of play, so
 * they are asserted against the real zone records rather than trusted.
 */
describe('the map speaks one vocabulary', () => {
  describe('typed aliases', () => {
    it('every alias resolves to a zone that exists', () => {
      const bad = Object.entries(ZONE_ALIASES).filter(([, id]) => !ZONE_MAP[id])
      expect(bad, `aliases pointing at no zone: ${JSON.stringify(bad)}`).toEqual([])
    })

    it('no alias collides with a real zone id (which would shadow it)', () => {
      const shadowed = Object.keys(ZONE_ALIASES).filter(
        (word) => ZONE_IDS.includes(word) && ZONE_ALIASES[word] !== word,
      )
      expect(shadowed, `alias words that are also zone ids: ${shadowed}`).toEqual([])
    })

    it('each of the three routes has a bare-name alias pointing at its crossing', () => {
      const crossings = ZONES.filter((z) => z.type === 'cross' && z.lane)
      expect(crossings).toHaveLength(3)
      for (const cross of crossings) {
        const alias = resolveZoneAlias(cross.lane!, 'chaff')
        expect(alias, `no bare alias for route ${cross.lane}`).toBe(cross.id)
      }
    })

    // `terminal` and `anchor` replaced `base`/`fountain`, and the whole point of
    // them is that they never walk you into the enemy's half.
    it('terminal and anchor resolve to YOUR side, for both teams', () => {
      for (const team of ['chaff', 'audit'] as TeamId[]) {
        const term = resolveZoneAlias('terminal', team)
        const anch = resolveZoneAlias('anchor', team)
        expect(ZONE_MAP[term]?.type, `${team} terminal`).toBe('base')
        expect(ZONE_MAP[term]?.team, `${team} terminal is the enemy's`).toBe(team)
        expect(ZONE_MAP[anch]?.type, `${team} anchor`).toBe('anchor')
        expect(ZONE_MAP[anch]?.team, `${team} anchor is the enemy's`).toBe(team)
      }
    })

    it('the two sides never resolve terminal/anchor to the same zone', () => {
      expect(resolveZoneAlias('terminal', 'chaff')).not.toBe(resolveZoneAlias('terminal', 'audit'))
      expect(resolveZoneAlias('anchor', 'chaff')).not.toBe(resolveZoneAlias('anchor', 'audit'))
    })
  })

  /**
   * `LANE_ROUTES` holds two different kinds of list under one type, which is
   * worth stating because the difference is invisible in the data:
   *
   *  - the three PUSH routes (keyed by a real `zone.lane`) are contiguous walks
   *    — the wave AI steps them one entry per cycle and each step must be a
   *    legal single-cycle move;
   *  - the `silt` entry is a WAYPOINT list for farming bots. Its entries are
   *    deliberately not adjacent; the bot orders a move and the engine
   *    auto-paths there over several cycles.
   *
   * Asserting adjacency across the whole table would be wrong, and asserting it
   * across none of it would miss the thing that actually strands waves.
   */
  describe('route tables match the topology', () => {
    const PUSH_ROUTES = new Set(ZONES.filter((z) => z.lane).map((z) => z.lane!))

    for (const [name, table] of [
      ['LANE_ROUTES_CORE', LANE_ROUTES_CORE],
      ['LANE_ROUTES', LANE_ROUTES],
    ] as const) {
      describe(name, () => {
        const entries = Object.entries(table).flatMap(([route, byTeam]) =>
          Object.entries(byTeam).map(([team, ids]) => ({ route, team, ids })),
        )

        it('lists only zones that exist', () => {
          const missing = entries.flatMap(({ route, team, ids }) =>
            ids.filter((id) => !ZONE_MAP[id]).map((id) => `${route}/${team}: ${id}`),
          )
          expect(missing, `route zones that do not exist: ${missing}`).toEqual([])
        })

        it('every push route is a contiguous walk — each step a legal single move', () => {
          const breaks: string[] = []
          for (const { route, team, ids } of entries) {
            if (!PUSH_ROUTES.has(route)) continue
            for (let i = 0; i < ids.length - 1; i++) {
              if (!areAdjacent(ids[i]!, ids[i + 1]!)) {
                breaks.push(`${route}/${team}: ${ids[i]} -/-> ${ids[i + 1]}`)
              }
            }
          }
          expect(breaks, `push-route steps that are not adjacent:\n${breaks.join('\n')}`).toEqual(
            [],
          )
        })

        it('covers all three push routes for both teams', () => {
          for (const route of PUSH_ROUTES) {
            for (const team of ['chaff', 'audit'] as TeamId[]) {
              const entry = entries.find((e) => e.route === route && e.team === team)
              expect(entry, `${name} is missing ${route}/${team}`).toBeDefined()
              expect(entry!.ids.length, `${route}/${team} is empty`).toBeGreaterThan(0)
            }
          }
        })

        it('every push route runs toward the enemy, never backwards', () => {
          for (const { route, team, ids } of entries) {
            if (!PUSH_ROUTES.has(route)) continue
            const last = ZONE_MAP[ids[ids.length - 1]!]
            expect(last?.team, `${name} ${route}/${team} does not end on the enemy side`).toBe(
              team === 'chaff' ? 'audit' : 'chaff',
            )
          }
        })

        it('every non-push waypoint list stays on its own side and is reachable', () => {
          for (const { route, team, ids } of entries) {
            if (PUSH_ROUTES.has(route)) continue
            for (const id of ids) {
              const zone = ZONE_MAP[id]!
              expect(
                zone.team === team || zone.team === 'neutral',
                `${name} ${route}/${team} sends ${team} to ${id} (${zone.team})`,
              ).toBe(true)
            }
            for (let i = 0; i < ids.length - 1; i++) {
              expect(
                findPath(ids[i]!, ids[i + 1]!).length,
                `${route}/${team}: no path ${ids[i]} -> ${ids[i + 1]}`,
              ).toBeGreaterThan(0)
            }
          }
        })
      })
    }
  })

  describe('the whole map is reachable', () => {
    it('every zone is reachable from both bases', () => {
      const bases = ZONES.filter((z) => z.type === 'base')
      expect(bases).toHaveLength(2)
      const unreachable: string[] = []
      for (const base of bases) {
        for (const zone of ZONES) {
          if (zone.id === base.id) continue
          if (findPath(base.id, zone.id).length === 0) unreachable.push(`${base.id} -> ${zone.id}`)
        }
      }
      expect(unreachable, `no path:\n${unreachable.join('\n')}`).toEqual([])
    })

    it('adjacency is symmetric — no one-way door on the map', () => {
      const oneWay: string[] = []
      for (const zone of ZONES) {
        for (const other of zone.adjacentTo) {
          if (!ZONE_MAP[other]?.adjacentTo.includes(zone.id)) {
            oneWay.push(`${zone.id} -> ${other} but not back`)
          }
        }
      }
      expect(oneWay, `one-way adjacency:\n${oneWay.join('\n')}`).toEqual([])
    })

    it('every adjacency names a zone that exists', () => {
      const dangling: string[] = []
      for (const zone of ZONES) {
        for (const other of zone.adjacentTo) {
          if (!ZONE_MAP[other]) dangling.push(`${zone.id} -> ${other}`)
        }
      }
      expect(dangling, `adjacency to nowhere:\n${dangling.join('\n')}`).toEqual([])
    })
  })

  // The tables above can all be right while the ENGINE still refuses the move —
  // validateAction has its own adjacency check. Walk it for real.
  describe('the engine accepts a walk down a whole route', () => {
    it('a hero auto-paths from its anchor to the enemy Terminal without a rejection', async () => {
      const game = await seedGame('laning_combat', { heroSelf: 'echo' })
      const me = await game.me()
      const myAnchor = ZONES.find((z) => z.type === 'anchor' && z.team === me.team)!
      const enemyBase = ZONES.find((z) => z.type === 'base' && z.team !== me.team)!

      await game.patch((s) => ({
        ...s,
        players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: myAnchor.id } },
      }))

      game.submit({ type: 'move', zone: enemyBase.id })
      const hops = findPath(myAnchor.id, enemyBase.id).length
      expect(hops, 'fixture assumption: the walk is multi-hop').toBeGreaterThan(3)

      const rejections: string[] = []
      for (let i = 0; i < hops + 2; i++) {
        await game.tick()
        for (const r of game.lastRejected) if (r.playerId === HUMAN) rejections.push(r.reason)
        if ((await game.me()).zone === enemyBase.id) break
      }

      expect(rejections, `move rejected mid-walk: ${rejections.join(' | ')}`).toEqual([])
      expect((await game.me()).zone).toBe(enemyBase.id)
    })
  })
})
