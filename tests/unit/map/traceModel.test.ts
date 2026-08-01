import { describe, it, expect } from 'vitest'
import { buildTrace, routeOfZone, hopIndexOf } from '~~/app/components/game/traceModel'
import { LANE_ROUTES_CORE } from '~~/shared/constants/lanes'
import type { TerminalState, TeamId } from '~~/shared/types/game'

function terminal(over: Partial<TerminalState> = {}): TerminalState {
  return {
    team: 'chaff',
    integ: 6000,
    maxInteg: 6000,
    alive: true,
    vulnerable: false,
    ...over,
  }
}

const TERMINALS: Record<TeamId, TerminalState> = {
  chaff: terminal({ team: 'chaff' }),
  audit: terminal({ team: 'audit', vulnerable: true, integ: 4200 }),
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
      terminals: TERMINALS,
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
      terminals: TERMINALS,
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
      terminals: TERMINALS,
    })
    expect(model.terminals).toHaveLength(2)
    const audit = model.terminals.find((t) => t.team === 'audit')!
    expect(audit.vulnerable).toBe(true)
    expect(audit.integ).toBe(4200)
    const chaff = model.terminals.find((t) => t.team === 'chaff')!
    expect(chaff.alive).toBe(true)
  })

  it('off-route zones (Silt/Hollow/base) yield no current route', () => {
    const model = buildTrace({
      playerZone: 'hollow',
      playerTeam: 'chaff',
      contacts: [],
      terminals: TERMINALS,
    })
    expect(model.currentRoute).toBeNull()
    expect(model.hopIndex).toBe(-1)
  })

  // A fogged enemy arrives as `FoggedPlayer` — KDA + hero + level, and no zone.
  // GameScreen used to hand every roster entry in with `fogged: false` hardcoded,
  // so TRACE listed all five enemies as live contacts, most at a blank location.
  it('excludes contacts with no observed position from the contact list', () => {
    const model = buildTrace({
      playerZone: 'mid-river',
      playerTeam: 'chaff',
      contacts: [
        { id: 'seen', name: 'Seen', zone: 'mid-river', team: 'audit', alive: true },
        { id: 'fog', name: 'Fogged', zone: '', team: 'audit', alive: true, fogged: true },
      ],
      terminals: TERMINALS,
    })
    expect(model.contacts.map((c) => c.id)).toEqual(['seen'])
  })

  it('carries each contact team so hostility need not be encoded as hue', () => {
    const model = buildTrace({
      playerZone: 'mid-river',
      playerTeam: 'audit',
      contacts: [{ id: 'a', name: 'A', zone: 'mid-river', team: 'audit', alive: true }],
      terminals: TERMINALS,
    })
    expect(model.contacts[0]!.team).toBe('audit')
    expect(model.contacts[0]!.hostile).toBe(false)
  })

  it('counts how many of each route the team can actually see', () => {
    const model = buildTrace({
      playerZone: 'hollow',
      playerTeam: 'chaff',
      contacts: [],
      terminals: TERMINALS,
      visibleZoneIds: ['top-t1-chaff', 'top-t2-chaff'],
    })
    expect(model.routes.find((r) => r.route === 'top')!.seen).toBe(2)
    expect(model.routes.find((r) => r.route === 'bot')!.seen).toBe(0)
  })

  it('treats omitted vision as unknown, never as full vision', () => {
    const model = buildTrace({
      playerZone: 'hollow',
      playerTeam: 'chaff',
      contacts: [],
      terminals: TERMINALS,
    })
    expect(model.routes.every((r) => r.seen === 0)).toBe(true)
  })
})
