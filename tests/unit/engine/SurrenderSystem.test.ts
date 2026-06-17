import { describe, it, expect, beforeEach } from 'vitest'
import { Effect } from 'effect'
import { processTick, submitAction } from '../../../server/game/engine/GameLoop'
import {
  voteSurrender,
  removeSurrenderVote,
  getSurrenderStatus,
  canSurrender,
  clearSurrenderVotes,
} from '../../../server/game/engine/SurrenderSystem'
import type { GameState, PlayerState } from '../../../shared/types/game'
import { initializeZoneStates, initializeTowers } from '../../../server/game/map/zones'
import { resetCreepIdCounter, initializeRoshan } from '../../../server/game/map/spawner'
import { SURRENDER_MIN_TICK } from '../../../shared/constants/balance'

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
      r1: makePlayer({ id: 'r1', name: 'R1', team: 'radiant' }),
      r2: makePlayer({ id: 'r2', name: 'R2', team: 'radiant' }),
      r3: makePlayer({ id: 'r3', name: 'R3', team: 'radiant' }),
      d1: makePlayer({ id: 'd1', name: 'D1', team: 'dire', zone: 'dire-fountain' }),
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

describe('SurrenderSystem', () => {
  beforeEach(() => {
    resetCreepIdCounter()
  })

  describe('voteSurrender', () => {
    it('rejects votes before SURRENDER_MIN_TICK', () => {
      const state = makeGameState({ tick: 0 })
      const result = voteSurrender(state, 'r1')
      expect(result.success).toBe(false)
      expect(result.state.surrenderVotes.radiant.size).toBe(0)
    })

    it('records the vote in the returned state', () => {
      const state = makeGameState({ tick: SURRENDER_MIN_TICK })
      const result = voteSurrender(state, 'r1')
      expect(result.success).toBe(true)
      expect(result.surrendered).toBe(false) // 1 of ceil(3 * 0.6) = 2 needed
      expect(result.state.surrenderVotes.radiant.has('r1')).toBe(true)
    })

    it('passes when the vote threshold is reached', () => {
      const state = makeGameState({ tick: SURRENDER_MIN_TICK })
      const afterFirst = voteSurrender(state, 'r1').state
      const result = voteSurrender(afterFirst, 'r2')
      expect(result.surrendered).toBe(true)
    })

    it('removeSurrenderVote retracts a vote', () => {
      const state = makeGameState({ tick: SURRENDER_MIN_TICK })
      const voted = voteSurrender(state, 'r1').state
      const retracted = removeSurrenderVote(voted, 'r1')
      expect(retracted.surrenderVotes.radiant.size).toBe(0)
    })
  })

  describe('solo-vs-bots electorate', () => {
    // A lone human alongside bot teammates must be able to concede — bots never
    // vote, so they're excluded from the denominator (the "surrender is useless
    // when playing alone with bots" report).
    function soloWithBots(): GameState {
      return makeGameState({
        tick: SURRENDER_MIN_TICK,
        players: {
          human: makePlayer({ id: 'human', name: 'Human', team: 'radiant' }),
          bot_alpha: makePlayer({ id: 'bot_alpha', name: 'bot_alpha', team: 'radiant' }),
          bot_beta: makePlayer({ id: 'bot_beta', name: 'bot_beta', team: 'radiant' }),
          d1: makePlayer({ id: 'd1', name: 'D1', team: 'dire', zone: 'dire-fountain' }),
        },
      })
    }

    it('a lone human concedes with a single vote when teammates are bots', () => {
      const result = voteSurrender(soloWithBots(), 'human')
      expect(result.success).toBe(true)
      expect(result.surrendered).toBe(true)
      expect(result.votes).toEqual({ for: 1, against: 0, total: 1, needed: 1 })
    })

    it('excludes bots from the surrender status electorate', () => {
      const status = getSurrenderStatus(soloWithBots(), 'radiant')
      expect(status.totalAlive).toBe(1) // only the human, not the two bots
      expect(status.votesNeeded).toBe(1)
    })

    it('ends the game when the lone human concedes via processTick', () => {
      submitAction('surr-solo', 'human', { type: 'surrender', vote: 'yes' })
      const result = Effect.runSync(processTick('surr-solo', soloWithBots()))
      expect(result.state.phase).toBe('ended')
      expect(result.state.winner).toBe('dire')
      expect(result.events.some((e) => e._tag === 'surrendered')).toBe(true)
    })
  })

  describe('surrender via processTick', () => {
    it('persists votes across ticks', () => {
      const state = makeGameState({ tick: SURRENDER_MIN_TICK })
      submitAction('surr-1', 'r1', { type: 'surrender', vote: 'yes' })
      const result = Effect.runSync(processTick('surr-1', state))
      expect(result.state.surrenderVotes.radiant.has('r1')).toBe(true)
      expect(result.state.phase).toBe('playing')
    })

    it('ends the game with the opposing team as winner when vote passes', () => {
      const state = makeGameState({ tick: SURRENDER_MIN_TICK })
      submitAction('surr-2', 'r1', { type: 'surrender', vote: 'yes' })
      const mid = Effect.runSync(processTick('surr-2', state))
      submitAction('surr-2', 'r2', { type: 'surrender', vote: 'yes' })
      const result = Effect.runSync(processTick('surr-2', mid.state))

      expect(result.state.phase).toBe('ended')
      expect(result.state.winner).toBe('dire')
      expect(result.events.some((e) => e._tag === 'surrendered')).toBe(true)
    })

    it('a no vote retracts a previous yes vote', () => {
      const state = makeGameState({ tick: SURRENDER_MIN_TICK })
      submitAction('surr-3', 'r1', { type: 'surrender', vote: 'yes' })
      const mid = Effect.runSync(processTick('surr-3', state))
      expect(mid.state.surrenderVotes.radiant.has('r1')).toBe(true)

      submitAction('surr-3', 'r1', { type: 'surrender', vote: 'no' })
      const result = Effect.runSync(processTick('surr-3', mid.state))
      expect(result.state.surrenderVotes.radiant.has('r1')).toBe(false)
    })

    it('emits a surrender_vote event for player feedback', () => {
      const state = makeGameState({ tick: SURRENDER_MIN_TICK })
      submitAction('surr-4', 'r1', { type: 'surrender', vote: 'yes' })
      const result = Effect.runSync(processTick('surr-4', state))
      const voteEvent = result.events.find((e) => e._tag === 'surrender_vote')
      expect(voteEvent).toBeDefined()
    })

    it('rejects votes before the minimum tick with feedback', () => {
      const state = makeGameState({ tick: 10 })
      submitAction('surr-5', 'r1', { type: 'surrender', vote: 'yes' })
      const result = Effect.runSync(processTick('surr-5', state))
      expect(result.state.surrenderVotes.radiant.size).toBe(0)
      expect(result.rejectedActions.some((r) => r.playerId === 'r1')).toBe(true)
    })
  })

  describe('canSurrender', () => {
    it('is too early before SURRENDER_MIN_TICK', () => {
      const res = canSurrender(makeGameState({ tick: 0 }), 'radiant')
      expect(res.can).toBe(false)
      expect(res.reason).toMatch(/too early/i)
    })

    it('rejects when the team has no alive humans to vote', () => {
      const state = makeGameState({
        tick: SURRENDER_MIN_TICK,
        players: {
          r1: makePlayer({ id: 'r1', team: 'radiant', alive: false }),
          r2: makePlayer({ id: 'r2', team: 'radiant', alive: false }),
          r3: makePlayer({ id: 'r3', team: 'radiant', alive: false }),
          d1: makePlayer({ id: 'd1', team: 'dire' }),
        },
      })
      const res = canSurrender(state, 'radiant')
      expect(res.can).toBe(false)
      expect(res.reason).toMatch(/no alive/i)
    })

    it('allows a team with alive humans past the minimum tick', () => {
      expect(canSurrender(makeGameState({ tick: SURRENDER_MIN_TICK }), 'radiant').can).toBe(true)
    })
  })

  describe('clearSurrenderVotes', () => {
    it('empties both teams’ vote sets', () => {
      const state = makeGameState({
        tick: SURRENDER_MIN_TICK,
        surrenderVotes: { radiant: new Set(['r1', 'r2']), dire: new Set(['d1']) },
      })
      const cleared = clearSurrenderVotes(state)
      expect(cleared.surrenderVotes.radiant.size).toBe(0)
      expect(cleared.surrenderVotes.dire.size).toBe(0)
    })
  })
})
