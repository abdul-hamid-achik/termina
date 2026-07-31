import { describe, it, expect, afterEach } from 'vitest'
import { Effect } from 'effect'
import { processCycle, submitAction } from '~~/server/game/engine/GameLoop'
import {
  detectAFKPlayers,
  shouldConvertAFK,
  markClientInput,
  msSinceClientInput,
  clearClientInput,
} from '~~/server/services/LeaverSystem'
import type { GameState, PlayerState } from '~~/shared/types/game'
import { initializeZoneStates, initializeIce } from '~~/server/game/map/zones'
import { initializeTenant } from '~~/server/game/map/spawner'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'Player1',
    team: 'chaff',
    heroId: 'echo',
    zone: 'chaff-fountain',
    integ: 550,
    maxInteg: 550,
    bw: 280,
    maxBw: 280,
    level: 1,
    xp: 0,
    scrip: 600,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnCycle: null,
    plate: 3,
    ice: 15,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    iceDamageDealt: 0,
    killStreak: 0,
    buybackCost: 0,
    talents: { tier10: null, tier15: null, tier20: null, tier25: null },
    ...overrides,
  }
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    cycle: 0,
    phase: 'playing',
    teams: {
      chaff: { id: 'chaff', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
      audit: { id: 'audit', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
    },
    players: {
      p1: makePlayer({ id: 'p1' }),
      p2: makePlayer({ id: 'p2', team: 'audit', zone: 'audit-fountain', name: 'Player2' }),
    },
    zones: initializeZoneStates(),
    waves: [],
    neutrals: [],
    ice: initializeIce(),
    caches: [],
    tenant: initializeTenant(),
    backup: null,
    events: [],
    surrenderVotes: { chaff: new Set(), audit: new Set() },
    timeOfDay: 'day',
    dayNightCycle: 0,
    ...overrides,
  }
}

describe('LeaverSystem AFK detection', () => {
  it('flags players who have never acted once past the threshold', () => {
    const state = makeGameState({ cycle: 40 })
    const afk = detectAFKPlayers(state)
    expect(afk.map((a) => a.playerId).sort()).toEqual(['p1', 'p2'])
    expect(afk[0]!.ticksAFK).toBe(40)
  })

  it('does not flag players below the threshold', () => {
    const state = makeGameState({ cycle: 10 })
    expect(detectAFKPlayers(state)).toEqual([])
  })

  it('does not flag players who acted recently', () => {
    const state = makeGameState({
      cycle: 100,
      players: {
        p1: makePlayer({ id: 'p1', lastActionCycle: 95 }),
        p2: makePlayer({ id: 'p2', team: 'audit', lastActionCycle: 50 }),
      },
    })
    const afk = detectAFKPlayers(state)
    expect(afk.map((a) => a.playerId)).toEqual(['p2'])
  })

  it('skips bots', () => {
    const state = makeGameState({
      cycle: 100,
      players: {
        bot_1: makePlayer({ id: 'bot_1' }),
        p2: makePlayer({ id: 'p2', team: 'audit', lastActionCycle: 99 }),
      },
    })
    expect(detectAFKPlayers(state)).toEqual([])
  })

  it('skips dead players', () => {
    const state = makeGameState({
      cycle: 100,
      players: {
        p1: makePlayer({ id: 'p1', alive: false, respawnCycle: 110 }),
      },
    })
    expect(detectAFKPlayers(state)).toEqual([])
  })

  it('skips players already replaced by a bot (aiControlled)', () => {
    // Once an AFK human is taken over, a bot plays the slot — it must not be
    // re-flagged, so the takeover + leaver record fire exactly once.
    const state = makeGameState({
      cycle: 200,
      players: {
        p1: makePlayer({ id: 'p1', aiControlled: true }),
        p2: makePlayer({ id: 'p2', team: 'audit', lastActionCycle: 199 }),
      },
    })
    expect(detectAFKPlayers(state)).toEqual([])
  })

  it('processCycle stamps lastActionCycle when a player acts', () => {
    const state = makeGameState({
      players: {
        p1: makePlayer({ id: 'p1', zone: 'mid-t1-chaff' }),
        p2: makePlayer({ id: 'p2', team: 'audit', zone: 'audit-fountain' }),
      },
    })
    submitAction('afk-stamp-1', 'p1', { type: 'move', zone: 'mid-river' })
    const result = Effect.runSync(processCycle('afk-stamp-1', state))
    expect(result.state.players['p1']!.lastActionCycle).toBe(1)
    expect(result.state.players['p2']!.lastActionCycle).toBeUndefined()
  })
})

describe('shouldConvertAFK (presence gate)', () => {
  // Two humans on chaff so the "human teammate benefits" clause can pass.
  function twoHumanState(cycle: number, p1: Partial<PlayerState> = {}): GameState {
    return makeGameState({
      cycle,
      players: {
        p1: makePlayer({ id: 'p1', ...p1 }),
        p3: makePlayer({ id: 'p3', name: 'Player3', lastActionCycle: cycle }),
        p2: makePlayer({ id: 'p2', team: 'audit', zone: 'audit-fountain', lastActionCycle: cycle }),
      },
    })
  }

  it('converts a disconnected player (the original rule)', () => {
    const state = twoHumanState(60)
    expect(shouldConvertAFK(state, 'p1', { isConnected: false, msSinceInput: null })).toBe(true)
  })

  it('never converts a connected player with recent client input', () => {
    const state = twoHumanState(600, { lastActionCycle: 0 })
    expect(shouldConvertAFK(state, 'p1', { isConnected: true, msSinceInput: 5_000 })).toBe(false)
  })

  it('never converts a connected player whose team has no other human', () => {
    // Solo-vs-bots: converting the only human serves nobody.
    const state = makeGameState({
      cycle: 600,
      players: {
        p1: makePlayer({ id: 'p1', lastActionCycle: 0 }),
        bot_ally: makePlayer({ id: 'bot_ally', name: 'Bot' }),
        p2: makePlayer({ id: 'p2', team: 'audit', zone: 'audit-fountain', lastActionCycle: 600 }),
      },
    })
    expect(shouldConvertAFK(state, 'p1', { isConnected: true, msSinceInput: null })).toBe(false)
  })

  it('a teammate already replaced by a bot does not count as a human teammate', () => {
    const state = makeGameState({
      cycle: 600,
      players: {
        p1: makePlayer({ id: 'p1', lastActionCycle: 0 }),
        p3: makePlayer({ id: 'p3', name: 'Player3', aiControlled: true }),
        p2: makePlayer({ id: 'p2', team: 'audit', zone: 'audit-fountain', lastActionCycle: 600 }),
      },
    })
    expect(shouldConvertAFK(state, 'p1', { isConnected: true, msSinceInput: null })).toBe(false)
  })

  it('does not convert a connected player under the longer connected threshold', () => {
    // 40 ticks without an action clears the base threshold (30) but not the
    // connected one (60) — present players get the longer window.
    const state = twoHumanState(40, { lastActionCycle: 0 })
    expect(shouldConvertAFK(state, 'p1', { isConnected: true, msSinceInput: null })).toBe(false)
  })

  it('converts a connected but fully silent player when a human teammate benefits', () => {
    const state = twoHumanState(120, { lastActionCycle: 0 })
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
