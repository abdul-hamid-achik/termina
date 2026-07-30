import { describe, it, expect } from 'vitest'
import { buildTrace, routeOfZone, hopIndexOf } from '~~/app/components/game/traceModel'
import { LANE_ROUTES_CORE } from '~~/shared/constants/lanes'
import type { AncientState, TeamId } from '~~/shared/types/game'

function ancient(over: Partial<AncientState> = {}): AncientState {
  return {
    team: 'chaff',
    hp: 6000,
    maxHp: 6000,
    alive: true,
    vulnerable: false,
    ...over,
  }
}

const ANCIENTS: Record<TeamId, AncientState> = {
  chaff: ancient({ team: 'chaff' }),
  audit: ancient({ team: 'audit', vulnerable: true, hp: 4200 }),
}

describe('traceModel', () => {
  it('maps a lane zone to its route and hop index, never from the id string', () => {
    // mid-t2-chaff is hop 1 on the chaff mid route (T3 → T2 → …)
    expect(routeOfZone('mid-t2-chaff', 'chaff')).toBe('mid')
    expect(hopIndexOf('mid-t2-chaff', 'chaff')).toBe(1)
    expect(routeOfZone('silt-chaff-top', 'chaff')).toBeNull()
    expect(hopIndexOf('silt-chaff-top', 'chaff')).toBe(-1)
  })

  it('hop index is team-relative (the same zone is a different hop per side)', () => {
    // mid-t1-audit is hop 4 for chaff (past the river), hop 2 for audit.
    expect(hopIndexOf('mid-t1-audit', 'chaff')).toBe(4)
    expect(hopIndexOf('mid-t1-audit', 'audit')).toBe(2)
  })

  it('builds your route first with depth, other routes one line each', () => {
    const model = buildTrace({
      playerZone: 'top-t1-chaff',
      playerTeam: 'chaff',
      contacts: [],
      ancients: ANCIENTS,
    })
    expect(model.currentRoute).toBe('top')
    expect(model.hopIndex).toBe(2)
    expect(model.routes[0]!.route).toBe('top')
    expect(model.routes[0]!.active).toBe(true)
    expect(model.routes[0]!.depth).toBe(2)
    expect(model.routes[0]!.total).toBe(LANE_ROUTES_CORE.top!.chaff!.length)
    expect(model.routes[1]!.active).toBe(false)
    expect(model.routes[1]!.depth).toBe(0)
    expect(model.routes).toHaveLength(3)
  })

  it('counts hostiles per route from visible contacts only', () => {
    const model = buildTrace({
      playerZone: 'mid-river',
      playerTeam: 'chaff',
      contacts: [
        { id: 'e1', name: 'Enemy1', zone: 'mid-t1-audit', team: 'audit', alive: true },
        { id: 'e2', name: 'Enemy2', zone: 'bot-t1-audit', team: 'audit', alive: true },
        {
          id: 'e3',
          name: 'Enemy3',
          zone: 'mid-t2-audit',
          team: 'audit',
          alive: true,
          fogged: true,
        },
        { id: 'a1', name: 'Ally1', zone: 'mid-t1-chaff', team: 'chaff', alive: true },
        { id: 'e4', name: 'Enemy4', zone: 'mid-t1-audit', team: 'audit', alive: false },
      ],
      ancients: ANCIENTS,
    })
    const mid = model.routes.find((r) => r.route === 'mid')!
    const bot = model.routes.find((r) => r.route === 'bot')!
    expect(mid.hostiles).toBe(1) // fogged + dead excluded
    expect(bot.hostiles).toBe(1)
    expect(model.contacts).toHaveLength(3)
    expect(model.contacts.find((c) => c.id === 'a1')!.hostile).toBe(false)
  })

  it('reports both terminal states', () => {
    const model = buildTrace({
      playerZone: 'mid-river',
      playerTeam: 'chaff',
      contacts: [],
      ancients: ANCIENTS,
    })
    expect(model.terminals).toHaveLength(2)
    const audit = model.terminals.find((t) => t.team === 'audit')!
    expect(audit.vulnerable).toBe(true)
    expect(audit.hp).toBe(4200)
    const chaff = model.terminals.find((t) => t.team === 'chaff')!
    expect(chaff.alive).toBe(true)
  })

  it('off-route zones (Silt/Hollow/base) yield no current route', () => {
    const model = buildTrace({
      playerZone: 'hollow',
      playerTeam: 'chaff',
      contacts: [],
      ancients: ANCIENTS,
    })
    expect(model.currentRoute).toBeNull()
    expect(model.hopIndex).toBe(-1)
  })
})
