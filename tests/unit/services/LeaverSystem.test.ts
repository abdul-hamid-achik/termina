import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import { processCycle, submitAction } from '~~/server/game/engine/GameLoop'
import {
  detectAFKPlayers,
  shouldConvertAFK,
  isAfkCheckCycle,
  isAfkPrimaryCheck,
  isConfirmedOffline,
  presenceCandidates,
  withPresenceSample,
  AFK_CHECK_EVERY_CYCLES,
  PRESENCE_CONFIRM_CYCLES,
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
    zone: 'rookery-anchor',
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
      p2: makePlayer({ id: 'p2', team: 'audit', zone: 'landing-anchor', name: 'Player2' }),
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
        p1: makePlayer({ id: 'p1', zone: 'coldstore-t1-chaff' }),
        p2: makePlayer({ id: 'p2', team: 'audit', zone: 'landing-anchor' }),
      },
    })
    submitAction('afk-stamp-1', 'p1', { type: 'move', zone: 'coldstore-cross' })
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
        p2: makePlayer({ id: 'p2', team: 'audit', zone: 'landing-anchor', lastActionCycle: cycle }),
      },
    })
  }

  it('converts a disconnected player (the short rule)', () => {
    const state = twoHumanState(60)
    expect(shouldConvertAFK(state, 'p1', false)).toBe(true)
  })

  it('converts a disconnected player even with no human teammate', () => {
    // Gone is gone: a bot plays the slot better than nobody, solo or not.
    const state = makeGameState({ cycle: 60 })
    expect(shouldConvertAFK(state, 'p1', false)).toBe(true)
  })

  it('never converts a connected player whose team has no other human', () => {
    // Solo-vs-bots: converting the only human serves nobody.
    const state = makeGameState({
      cycle: 600,
      players: {
        p1: makePlayer({ id: 'p1', lastActionCycle: 0 }),
        bot_ally: makePlayer({ id: 'bot_ally', name: 'Bot' }),
        p2: makePlayer({ id: 'p2', team: 'audit', zone: 'landing-anchor', lastActionCycle: 600 }),
      },
    })
    expect(shouldConvertAFK(state, 'p1', true)).toBe(false)
  })

  it('a teammate already replaced by a bot does not count as a human teammate', () => {
    const state = makeGameState({
      cycle: 600,
      players: {
        p1: makePlayer({ id: 'p1', lastActionCycle: 0 }),
        p3: makePlayer({ id: 'p3', name: 'Player3', aiControlled: true }),
        p2: makePlayer({ id: 'p2', team: 'audit', zone: 'landing-anchor', lastActionCycle: 600 }),
      },
    })
    expect(shouldConvertAFK(state, 'p1', true)).toBe(false)
  })

  it('does not convert a connected player under the longer connected threshold', () => {
    // 59 cycles without an order clears the base threshold (30) but not the
    // connected one (60) — present players get the longer window.
    expect(shouldConvertAFK(twoHumanState(59, { lastActionCycle: 0 }), 'p1', true)).toBe(false)
    expect(shouldConvertAFK(twoHumanState(60, { lastActionCycle: 0 }), 'p1', true)).toBe(true)
  })

  it('a standing order issued inside the window keeps a connected walker safe', () => {
    // Issuing the auto-walk/auto-attack stamps lastActionCycle (GameLoop 1.2);
    // the synthesized continuations after it do not. So an order issued 40
    // cycles ago, still walking, is inside the 60-cycle connected window.
    const state = twoHumanState(120, {
      lastActionCycle: 80,
      moveTarget: 'landing-anchor',
    })
    expect(shouldConvertAFK(state, 'p1', true)).toBe(false)
  })
})

describe('presence sampling (state-borne, deterministic)', () => {
  it('checks only on the AFK cadence: the primary check and its confirm sample', () => {
    expect(AFK_CHECK_EVERY_CYCLES).toBe(60)
    expect(PRESENCE_CONFIRM_CYCLES).toBeGreaterThan(1)
    expect(PRESENCE_CONFIRM_CYCLES).toBeLessThan(AFK_CHECK_EVERY_CYCLES)
    const confirm = 60 + PRESENCE_CONFIRM_CYCLES
    for (const c of [60, 120, confirm, 120 + PRESENCE_CONFIRM_CYCLES]) {
      expect(isAfkCheckCycle(c)).toBe(true)
    }
    for (const c of [0, 59, 61, confirm - 1, confirm + 1, PRESENCE_CONFIRM_CYCLES]) {
      expect(isAfkCheckCycle(c)).toBe(false)
    }
    expect(isAfkPrimaryCheck(60)).toBe(true)
    expect(isAfkPrimaryCheck(confirm)).toBe(false)
  })

  it('is confirmed offline only when BOTH samples of the check list the player', () => {
    const confirm = 120 + PRESENCE_CONFIRM_CYCLES
    const base = makeGameState({ cycle: confirm })
    // No sample at all (no Ably key, failed lookup, old snapshot): connected.
    expect(isConfirmedOffline(base, 'p1')).toBe(false)
    const both = withPresenceSample(withPresenceSample(base, 120, ['p1']), confirm, ['p1'])
    expect(isConfirmedOffline(both, 'p1')).toBe(true)
    expect(isConfirmedOffline(both, 'p2')).toBe(false)
    // One sample is a reload, not a leaver — either one alone is not enough.
    expect(isConfirmedOffline(withPresenceSample(base, 120, ['p1']), 'p1')).toBe(false)
    expect(isConfirmedOffline(withPresenceSample(base, confirm, ['p1']), 'p1')).toBe(false)
    // Only ON the confirm cycle — never at the primary or any other cycle.
    expect(isConfirmedOffline({ ...both, cycle: 120 }, 'p1')).toBe(false)
    expect(isConfirmedOffline({ ...both, cycle: confirm + 1 }, 'p1')).toBe(false)
  })

  it('records nothing for an all-present sample (the log stays tiny)', () => {
    const base = makeGameState({ cycle: 59 })
    expect(withPresenceSample(base, 60, [])).toBe(base)
    const once = withPresenceSample(base, 60, ['p1'])
    const twice = withPresenceSample(once, 120, ['p2'])
    expect(twice.presenceOffline).toEqual({ 60: ['p1'], 120: ['p2'] })
  })

  it('samples only humans who could be past the AFK threshold at the check cycle', () => {
    const state = makeGameState({
      cycle: 59,
      players: {
        idle: makePlayer({ id: 'idle', lastActionCycle: 10 }),
        busy: makePlayer({ id: 'busy', lastActionCycle: 50 }),
        bot_x: makePlayer({ id: 'bot_x' }),
        taken: makePlayer({ id: 'taken', aiControlled: true }),
        dead: makePlayer({ id: 'dead', alive: false, respawnCycle: 70 }),
      },
    })
    // Dead players are sampled too: they may respawn within the cycle.
    expect(presenceCandidates(state, 60).sort()).toEqual(['dead', 'idle'])
  })

  it('the confirm sample re-asks ONLY about players the primary found gone', () => {
    const confirm = 60 + PRESENCE_CONFIRM_CYCLES
    const players = {
      idle: makePlayer({ id: 'idle', lastActionCycle: 10 }),
      gone: makePlayer({ id: 'gone', lastActionCycle: 10 }),
      back: makePlayer({ id: 'back', lastActionCycle: confirm - 2 }),
    }
    // Nobody missing at the primary ⇒ no candidates ⇒ the tick makes no call.
    expect(presenceCandidates(makeGameState({ cycle: confirm - 1, players }), confirm)).toEqual([])
    const sampled = withPresenceSample(makeGameState({ cycle: confirm - 1, players }), 60, [
      'gone',
      'back',
    ])
    // 'back' gave an order since: no longer past the threshold, not re-asked.
    expect(presenceCandidates(sampled, confirm)).toEqual(['gone'])
  })
})
