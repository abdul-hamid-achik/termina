import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import { processTick, submitAction } from '../../../server/game/engine/GameLoop'
import { detectAFKPlayers } from '../../../server/services/LeaverSystem'
import type { GameState, PlayerState } from '../../../shared/types/game'
import { initializeZoneStates, initializeTowers } from '../../../server/game/map/zones'
import { initializeRoshan } from '../../../server/game/map/spawner'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'Player1',
    team: 'radiant',
    heroId: 'echo',
    zone: 'radiant-fountain',
    hp: 550,
    maxHp: 550,
    mp: 280,
    maxMp: 280,
    level: 1,
    xp: 0,
    gold: 600,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnTick: null,
    defense: 3,
    magicResist: 15,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    towerDamageDealt: 0,
    killStreak: 0,
    buybackCost: 0,
    talents: { tier10: null, tier15: null, tier20: null, tier25: null },
    ...overrides,
  }
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    tick: 0,
    phase: 'playing',
    teams: {
      radiant: { id: 'radiant', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
      dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
    },
    players: {
      p1: makePlayer({ id: 'p1' }),
      p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain', name: 'Player2' }),
    },
    zones: initializeZoneStates(),
    creeps: [],
    neutrals: [],
    towers: initializeTowers(),
    runes: [],
    roshan: initializeRoshan(),
    aegis: null,
    events: [],
    surrenderVotes: { radiant: new Set(), dire: new Set() },
    timeOfDay: 'day',
    dayNightTick: 0,
    ...overrides,
  }
}

describe('LeaverSystem AFK detection', () => {
  it('flags players who have never acted once past the threshold', () => {
    const state = makeGameState({ tick: 40 })
    const afk = detectAFKPlayers(state)
    expect(afk.map((a) => a.playerId).sort()).toEqual(['p1', 'p2'])
    expect(afk[0]!.ticksAFK).toBe(40)
  })

  it('does not flag players below the threshold', () => {
    const state = makeGameState({ tick: 10 })
    expect(detectAFKPlayers(state)).toEqual([])
  })

  it('does not flag players who acted recently', () => {
    const state = makeGameState({
      tick: 100,
      players: {
        p1: makePlayer({ id: 'p1', lastActionTick: 95 }),
        p2: makePlayer({ id: 'p2', team: 'dire', lastActionTick: 50 }),
      },
    })
    const afk = detectAFKPlayers(state)
    expect(afk.map((a) => a.playerId)).toEqual(['p2'])
  })

  it('skips bots', () => {
    const state = makeGameState({
      tick: 100,
      players: {
        bot_1: makePlayer({ id: 'bot_1' }),
        p2: makePlayer({ id: 'p2', team: 'dire', lastActionTick: 99 }),
      },
    })
    expect(detectAFKPlayers(state)).toEqual([])
  })

  it('skips dead players', () => {
    const state = makeGameState({
      tick: 100,
      players: {
        p1: makePlayer({ id: 'p1', alive: false, respawnTick: 110 }),
      },
    })
    expect(detectAFKPlayers(state)).toEqual([])
  })

  it('skips players already replaced by a bot (aiControlled)', () => {
    // Once an AFK human is taken over, a bot plays the slot — it must not be
    // re-flagged, so the takeover + leaver record fire exactly once.
    const state = makeGameState({
      tick: 200,
      players: {
        p1: makePlayer({ id: 'p1', aiControlled: true }),
        p2: makePlayer({ id: 'p2', team: 'dire', lastActionTick: 199 }),
      },
    })
    expect(detectAFKPlayers(state)).toEqual([])
  })

  it('processTick stamps lastActionTick when a player acts', () => {
    const state = makeGameState({
      players: {
        p1: makePlayer({ id: 'p1', zone: 'mid-t1-rad' }),
        p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain' }),
      },
    })
    submitAction('afk-stamp-1', 'p1', { type: 'move', zone: 'mid-river' })
    const result = Effect.runSync(processTick('afk-stamp-1', state))
    expect(result.state.players['p1']!.lastActionTick).toBe(1)
    expect(result.state.players['p2']!.lastActionTick).toBeUndefined()
  })
})
