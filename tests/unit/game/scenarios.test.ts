import { describe, it, expect } from 'vitest'
import { applyScenario, KNOWN_SCENARIOS } from '../../../server/game/dev/scenarios'
import type { GameState } from '../../../shared/types/game'

function baseState(): GameState {
  return {
    tick: 0,
    phase: 'playing',
    teams: {
      radiant: { id: 'radiant', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
      dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
    },
    players: {},
    zones: {},
    creeps: [],
    neutrals: [],
    towers: [],
    ancients: {
      radiant: { team: 'radiant', hp: 6000, maxHp: 6000, alive: true, vulnerable: false },
      dire: { team: 'dire', hp: 6000, maxHp: 6000, alive: true, vulnerable: false },
    },
    runes: [],
    roshan: { alive: true, hp: 5000, maxHp: 5000, deathTick: null },
    aegis: null,
    events: [],
    surrenderVotes: { radiant: new Set(), dire: new Set() },
    lastSeen: {},
    timeOfDay: 'day',
    dayNightTick: 0,
  } as GameState
}

describe('applyScenario (dev seed scenarios)', () => {
  it('roshan_dead kills Roshan and stamps deathTick at the current tick', () => {
    const s = applyScenario({ ...baseState(), tick: 7 }, 'roshan_dead')
    expect(s.roshan.alive).toBe(false)
    expect(s.roshan.hp).toBe(0)
    expect(s.roshan.deathTick).toBe(7)
  })

  it('core_vulnerable marks only the Dire Ancient vulnerable', () => {
    const s = applyScenario(baseState(), 'core_vulnerable')
    expect(s.ancients.dire.vulnerable).toBe(true)
    expect(s.ancients.radiant.vulnerable).toBe(false)
  })

  it('night flips timeOfDay', () => {
    expect(applyScenario(baseState(), 'night').timeOfDay).toBe('night')
  })

  it('self_dead kills the human player with a pending respawn', () => {
    const base = {
      ...baseState(),
      tick: 5,
      players: {
        human1: { id: 'human1', alive: true, hp: 600, maxHp: 600, respawnTick: null },
      },
    } as unknown as GameState
    const s = applyScenario(base, 'self_dead', { humanId: 'human1' })
    expect(s.players.human1!.alive).toBe(false)
    expect(s.players.human1!.hp).toBe(0)
    expect(s.players.human1!.respawnTick).toBe(35)
  })

  it('self_dead is a no-op without a matching humanId', () => {
    const base = baseState()
    expect(applyScenario(base, 'self_dead')).toEqual(base)
    expect(applyScenario(base, 'self_dead', { humanId: 'nobody' })).toEqual(base)
  })

  it('fresh / unknown scenarios are a no-op', () => {
    const base = baseState()
    expect(applyScenario(base, 'fresh')).toEqual(base)
    expect(applyScenario(base, 'totally_unknown')).toEqual(base)
  })

  it('does not mutate the input state', () => {
    const base = baseState()
    applyScenario(base, 'roshan_dead')
    expect(base.roshan.alive).toBe(true) // original untouched
  })

  it('KNOWN_SCENARIOS lists the shapeable scenarios', () => {
    expect(KNOWN_SCENARIOS).toContain('roshan_dead')
    expect(KNOWN_SCENARIOS).toContain('core_vulnerable')
  })
})
