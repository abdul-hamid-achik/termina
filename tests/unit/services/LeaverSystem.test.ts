import { describe, it, expect, afterEach } from 'vitest'
import { Effect } from 'effect'
import { processTick, submitAction } from '~~/server/game/engine/GameLoop'
import {
  detectAFKPlayers,
  shouldConvertAFK,
  markClientInput,
  msSinceClientInput,
  clearClientInput,
} from '~~/server/services/LeaverSystem'
import type { GameState, PlayerState } from '~~/shared/types/game'
import { initializeZoneStates, initializeTowers } from '~~/server/game/map/zones'
import { initializeRoshan } from '~~/server/game/map/spawner'

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

describe('shouldConvertAFK (presence gate)', () => {
  // Two humans on radiant so the "human teammate benefits" clause can pass.
  function twoHumanState(tick: number, p1: Partial<PlayerState> = {}): GameState {
    return makeGameState({
      tick,
      players: {
        p1: makePlayer({ id: 'p1', ...p1 }),
        p3: makePlayer({ id: 'p3', name: 'Player3', lastActionTick: tick }),
        p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain', lastActionTick: tick }),
      },
    })
  }

  it('converts a disconnected player (the original rule)', () => {
    const state = twoHumanState(60)
    expect(shouldConvertAFK(state, 'p1', { isConnected: false, msSinceInput: null })).toBe(true)
  })

  it('never converts a connected player with recent client input', () => {
    const state = twoHumanState(600, { lastActionTick: 0 })
    expect(shouldConvertAFK(state, 'p1', { isConnected: true, msSinceInput: 5_000 })).toBe(false)
  })

  it('never converts a connected player whose team has no other human', () => {
    // Solo-vs-bots: converting the only human serves nobody.
    const state = makeGameState({
      tick: 600,
      players: {
        p1: makePlayer({ id: 'p1', lastActionTick: 0 }),
        bot_ally: makePlayer({ id: 'bot_ally', name: 'Bot' }),
        p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain', lastActionTick: 600 }),
      },
    })
    expect(shouldConvertAFK(state, 'p1', { isConnected: true, msSinceInput: null })).toBe(false)
  })

  it('a teammate already replaced by a bot does not count as a human teammate', () => {
    const state = makeGameState({
      tick: 600,
      players: {
        p1: makePlayer({ id: 'p1', lastActionTick: 0 }),
        p3: makePlayer({ id: 'p3', name: 'Player3', aiControlled: true }),
        p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain', lastActionTick: 600 }),
      },
    })
    expect(shouldConvertAFK(state, 'p1', { isConnected: true, msSinceInput: null })).toBe(false)
  })

  it('does not convert a connected player under the longer connected threshold', () => {
    // 40 ticks without an action clears the base threshold (30) but not the
    // connected one (60) — present players get the longer window.
    const state = twoHumanState(40, { lastActionTick: 0 })
    expect(shouldConvertAFK(state, 'p1', { isConnected: true, msSinceInput: null })).toBe(false)
  })

  it('converts a connected but fully silent player when a human teammate benefits', () => {
    const state = twoHumanState(120, { lastActionTick: 0 })
    expect(shouldConvertAFK(state, 'p1', { isConnected: true, msSinceInput: null })).toBe(true)
    // …but any input inside the window keeps them safe.
    expect(shouldConvertAFK(state, 'p1', { isConnected: true, msSinceInput: 60_000 })).toBe(false)
  })
})

describe('client input ledger', () => {
  afterEach(() => clearClientInput('ledger-game'))

  it('stamps and reads deliberate input per game+player', () => {
    expect(msSinceClientInput('ledger-game', 'p1')).toBeNull()
    markClientInput('ledger-game', 'p1')
    const ms = msSinceClientInput('ledger-game', 'p1')
    expect(ms).not.toBeNull()
    expect(ms!).toBeLessThan(1_000)
    // Other players/games unaffected.
    expect(msSinceClientInput('ledger-game', 'p2')).toBeNull()
    expect(msSinceClientInput('other-game', 'p1')).toBeNull()
  })

  it('clearClientInput drops only the finished game', () => {
    markClientInput('ledger-game', 'p1')
    markClientInput('ledger-game-2', 'p1')
    clearClientInput('ledger-game')
    expect(msSinceClientInput('ledger-game', 'p1')).toBeNull()
    expect(msSinceClientInput('ledger-game-2', 'p1')).not.toBeNull()
    clearClientInput('ledger-game-2')
  })
})
