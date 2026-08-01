import { describe, it, expect } from 'vitest'
import { applyScenario, KNOWN_SCENARIOS } from '~~/server/game/dev/scenarios'
import type { GameState } from '~~/shared/types/game'

function baseState(): GameState {
  return {
    cycle: 0,
    phase: 'playing',
    teams: {
      chaff: { id: 'chaff', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
      audit: { id: 'audit', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
    },
    players: {},
    zones: {},
    waves: [],
    neutrals: [],
    ice: [],
    terminals: {
      chaff: { team: 'chaff', integ: 6000, maxInteg: 6000, alive: true, vulnerable: false },
      audit: { team: 'audit', integ: 6000, maxInteg: 6000, alive: true, vulnerable: false },
    },
    caches: [],
    tenant: { alive: true, integ: 5000, maxInteg: 5000, deathCycle: null },
    backup: null,
    events: [],
    surrenderVotes: { chaff: new Set(), audit: new Set() },
    timeOfDay: 'day',
    dayNightCycle: 0,
  } as GameState
}

describe('applyScenario (dev seed scenarios)', () => {
  it('tenant_dead kills Tenant and stamps deathCycle at the current tick', () => {
    const s = applyScenario({ ...baseState(), cycle: 7 }, 'tenant_dead')
    expect(s.tenant.alive).toBe(false)
    expect(s.tenant.integ).toBe(0)
    expect(s.tenant.deathCycle).toBe(7)
  })

  it('terminal_vulnerable marks only the Audit Terminal vulnerable', () => {
    const s = applyScenario(baseState(), 'terminal_vulnerable')
    expect(s.terminals.audit.vulnerable).toBe(true)
    expect(s.terminals.chaff.vulnerable).toBe(false)
  })

  it('night flips timeOfDay', () => {
    expect(applyScenario(baseState(), 'night').timeOfDay).toBe('night')
  })

  it('self_dead kills the human player with a pending respawn', () => {
    const base = {
      ...baseState(),
      cycle: 5,
      players: {
        human1: { id: 'human1', alive: true, integ: 600, maxInteg: 600, respawnCycle: null },
      },
    } as unknown as GameState
    const s = applyScenario(base, 'self_dead', { humanId: 'human1' })
    expect(s.players.human1!.alive).toBe(false)
    expect(s.players.human1!.integ).toBe(0)
    expect(s.players.human1!.respawnCycle).toBe(35)
  })

  it('self_dead is a no-op without a matching humanId', () => {
    const base = baseState()
    expect(applyScenario(base, 'self_dead')).toEqual(base)
    expect(applyScenario(base, 'self_dead', { humanId: 'nobody' })).toEqual(base)
  })

  it('laning_combat co-locates the human and one enemy mid-lane', () => {
    const base = {
      ...baseState(),
      players: {
        human1: {
          id: 'human1',
          team: 'chaff',
          alive: true,
          integ: 300,
          maxInteg: 600,
          bw: 100,
          maxBw: 300,
          level: 1,
          zone: 'rookery-anchor',
        },
        enemy1: {
          id: 'enemy1',
          team: 'audit',
          alive: true,
          integ: 200,
          maxInteg: 500,
          bw: 50,
          maxBw: 250,
          level: 1,
          zone: 'landing-anchor',
        },
      },
    } as unknown as GameState
    const s = applyScenario(base, 'laning_combat', { humanId: 'human1' })
    expect(s.players.human1!.zone).toBe('coldstore-cross')
    expect(s.players.enemy1!.zone).toBe('coldstore-cross')
    // levelled + topped off so abilities are unlocked and castable
    expect(s.players.human1!.level).toBe(6)
    expect(s.players.human1!.bw).toBe(s.players.human1!.maxBw)
    expect(s.players.enemy1!.integ).toBe(s.players.enemy1!.maxInteg)
  })

  it('laning_combat is a no-op without a matching humanId', () => {
    const base = baseState()
    expect(applyScenario(base, 'laning_combat')).toEqual(base)
  })

  it('talent_ready puts the human at level 10 with no talents chosen', () => {
    const base = {
      ...baseState(),
      players: {
        human1: {
          id: 'human1',
          team: 'chaff',
          alive: true,
          integ: 300,
          maxInteg: 600,
          bw: 100,
          maxBw: 300,
          level: 1,
          talents: { tier10: 'stale', tier15: null, tier20: null, tier25: null },
        },
      },
    } as unknown as GameState
    const s = applyScenario(base, 'talent_ready', { humanId: 'human1' })
    expect(s.players.human1!.level).toBe(10)
    expect(s.players.human1!.talents.tier10).toBeNull()
    expect(s.players.human1!.integ).toBe(s.players.human1!.maxInteg)
  })

  it('talent_ready is a no-op without a matching humanId', () => {
    const base = baseState()
    expect(applyScenario(base, 'talent_ready')).toEqual(base)
  })

  it('fresh / unknown scenarios are a no-op', () => {
    const base = baseState()
    expect(applyScenario(base, 'fresh')).toEqual(base)
    expect(applyScenario(base, 'totally_unknown')).toEqual(base)
  })

  it('does not mutate the input state', () => {
    const base = baseState()
    applyScenario(base, 'tenant_dead')
    expect(base.tenant.alive).toBe(true) // original untouched
  })

  it('KNOWN_SCENARIOS lists the shapeable scenarios', () => {
    expect(KNOWN_SCENARIOS).toContain('tenant_dead')
    expect(KNOWN_SCENARIOS).toContain('terminal_vulnerable')
    expect(KNOWN_SCENARIOS).toContain('laning_combat')
  })
})
