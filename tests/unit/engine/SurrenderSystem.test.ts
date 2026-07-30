import { describe, it, expect, beforeEach } from 'vitest'
import { Effect } from 'effect'
import { processTick, submitAction } from '~~/server/game/engine/GameLoop'
import {
  voteSurrender,
  removeSurrenderVote,
  getSurrenderStatus,
  canSurrender,
  clearSurrenderVotes,
} from '~~/server/game/engine/SurrenderSystem'
import type { GameState, PlayerState } from '~~/shared/types/game'
import { initializeZoneStates, initializeIce } from '~~/server/game/map/zones'
import { resetWaveIdCounter, initializeTenant } from '~~/server/game/map/spawner'
import { SURRENDER_MIN_TICK } from '~~/shared/constants/balance'

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
    gold: 600,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnTick: null,
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
    tick: 0,
    phase: 'playing',
    teams: {
      chaff: { id: 'chaff', kills: 0, iceKills: 0, gold: 0, hardenUsedTick: null },
      audit: { id: 'audit', kills: 0, iceKills: 0, gold: 0, hardenUsedTick: null },
    },
    players: {
      r1: makePlayer({ id: 'r1', name: 'R1', team: 'chaff' }),
      r2: makePlayer({ id: 'r2', name: 'R2', team: 'chaff' }),
      r3: makePlayer({ id: 'r3', name: 'R3', team: 'chaff' }),
      d1: makePlayer({ id: 'd1', name: 'D1', team: 'audit', zone: 'audit-fountain' }),
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
    dayNightTick: 0,
    ...overrides,
  }
}

describe('SurrenderSystem', () => {
  beforeEach(() => {
    resetWaveIdCounter()
  })

  describe('voteSurrender', () => {
    it('rejects votes before SURRENDER_MIN_TICK', () => {
      const state = makeGameState({ tick: 0 })
      const result = voteSurrender(state, 'r1')
      expect(result.success).toBe(false)
      expect(result.state.surrenderVotes.chaff.size).toBe(0)
    })

    it('records the vote in the returned state', () => {
      const state = makeGameState({ tick: SURRENDER_MIN_TICK })
      const result = voteSurrender(state, 'r1')
      expect(result.success).toBe(true)
      expect(result.surrendered).toBe(false) // 1 of ceil(3 * 0.6) = 2 needed
      expect(result.state.surrenderVotes.chaff.has('r1')).toBe(true)
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
      expect(retracted.surrenderVotes.chaff.size).toBe(0)
    })

    it('rejects a vote from an unknown player', () => {
      const state = makeGameState({ tick: SURRENDER_MIN_TICK })
      const result = voteSurrender(state, 'ghost')
      expect(result.success).toBe(false)
      expect(result.reason).toBe('Player not found')
      expect(result.state).toBe(state) // unchanged
    })

    // Death is the moment a player most wants to concede, and the death overlay
    // covers the command input — its [VOTE TO SURRENDER] button used to be
    // rejected 100% of the time.
    it('accepts a vote from a dead player', () => {
      const base = makeGameState({ tick: SURRENDER_MIN_TICK })
      const state = {
        ...base,
        players: { ...base.players, r1: { ...base.players.r1!, alive: false } },
      }
      const result = voteSurrender(state, 'r1')
      expect(result.success).toBe(true)
      expect(result.state.surrenderVotes.chaff.has('r1')).toBe(true)
    })

    it('a fully wiped team can still concede', () => {
      const base = makeGameState({ tick: SURRENDER_MIN_TICK })
      const wiped = {
        ...base,
        players: {
          ...base.players,
          r1: { ...base.players.r1!, alive: false },
          r2: { ...base.players.r2!, alive: false },
          r3: { ...base.players.r3!, alive: false },
        },
      }
      const afterFirst = voteSurrender(wiped, 'r1')
      expect(afterFirst.votes).toEqual({ for: 1, against: 2, total: 3, needed: 2 })
      expect(voteSurrender(afterFirst.state, 'r2').surrendered).toBe(true)
    })

    // The electorate must not move under the vote: if dying removed a player
    // from the denominator, r1's lone vote would retroactively pass (ceil(2*0.6)
    // = 2 → ceil(1*0.6) = 1) the instant its two teammates were killed.
    it('keeps the denominator stable when voters die mid-vote', () => {
      const base = makeGameState({ tick: SURRENDER_MIN_TICK })
      const voted = voteSurrender(base, 'r1')
      expect(voted.votes!.needed).toBe(2)

      const bereaved = {
        ...voted.state,
        players: {
          ...voted.state.players,
          r2: { ...voted.state.players.r2!, alive: false },
          r3: { ...voted.state.players.r3!, alive: false },
        },
      }
      const status = getSurrenderStatus(bereaved, 'chaff')
      expect(status.electorate).toBe(3)
      expect(status.votesNeeded).toBe(2)
      expect(status.votesFor).toBe(1)
    })

    it('removeSurrenderVote is a no-op for an unknown player', () => {
      const state = makeGameState({ tick: SURRENDER_MIN_TICK })
      expect(removeSurrenderVote(state, 'ghost')).toBe(state) // same reference, untouched
    })
  })

  describe('getSurrenderStatus edge cases', () => {
    it('reports 0% with 0 needed when the team has no humans', () => {
      const state = makeGameState({
        tick: SURRENDER_MIN_TICK,
        players: {
          bot_a: makePlayer({ id: 'bot_a', name: 'bot_a', team: 'chaff' }),
          bot_b: makePlayer({ id: 'bot_b', name: 'bot_b', team: 'chaff' }),
          d1: makePlayer({ id: 'd1', name: 'D1', team: 'audit', zone: 'audit-fountain' }),
        },
      })
      const status = getSurrenderStatus(state, 'chaff')
      expect(status.electorate).toBe(0)
      expect(status.votesFor).toBe(0)
      expect(status.votesNeeded).toBe(0)
      expect(status.percentage).toBe(0)
    })

    it('counts dead humans in the electorate', () => {
      const base = makeGameState({ tick: SURRENDER_MIN_TICK })
      const allDead = {
        ...base,
        players: {
          ...base.players,
          r1: { ...base.players.r1!, alive: false },
          r2: { ...base.players.r2!, alive: false },
          r3: { ...base.players.r3!, alive: false },
        },
      }
      const status = getSurrenderStatus(allDead, 'chaff')
      expect(status.electorate).toBe(3)
      expect(status.votesNeeded).toBe(2)
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
          human: makePlayer({ id: 'human', name: 'Human', team: 'chaff' }),
          bot_alpha: makePlayer({ id: 'bot_alpha', name: 'bot_alpha', team: 'chaff' }),
          bot_beta: makePlayer({ id: 'bot_beta', name: 'bot_beta', team: 'chaff' }),
          d1: makePlayer({ id: 'd1', name: 'D1', team: 'audit', zone: 'audit-fountain' }),
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
      const status = getSurrenderStatus(soloWithBots(), 'chaff')
      expect(status.electorate).toBe(1) // only the human, not the two bots
      expect(status.votesNeeded).toBe(1)
    })

    it('a dead lone human concedes from the death overlay', () => {
      const base = soloWithBots()
      const dead = {
        ...base,
        players: { ...base.players, human: { ...base.players.human!, alive: false } },
      }
      submitAction('surr-solo-dead', 'human', { type: 'surrender', vote: 'yes' })
      const result = Effect.runSync(processTick('surr-solo-dead', dead))
      expect(result.state.phase).toBe('ended')
      expect(result.state.winner).toBe('audit')
    })

    it('ends the game when the lone human concedes via processTick', () => {
      submitAction('surr-solo', 'human', { type: 'surrender', vote: 'yes' })
      const result = Effect.runSync(processTick('surr-solo', soloWithBots()))
      expect(result.state.phase).toBe('ended')
      expect(result.state.winner).toBe('audit')
      expect(result.events.some((e) => e._tag === 'surrendered')).toBe(true)
    })
  })

  describe('surrender via processTick', () => {
    it('persists votes across ticks', () => {
      const state = makeGameState({ tick: SURRENDER_MIN_TICK })
      submitAction('surr-1', 'r1', { type: 'surrender', vote: 'yes' })
      const result = Effect.runSync(processTick('surr-1', state))
      expect(result.state.surrenderVotes.chaff.has('r1')).toBe(true)
      expect(result.state.phase).toBe('playing')
    })

    it('ends the game with the opposing team as winner when vote passes', () => {
      const state = makeGameState({ tick: SURRENDER_MIN_TICK })
      submitAction('surr-2', 'r1', { type: 'surrender', vote: 'yes' })
      const mid = Effect.runSync(processTick('surr-2', state))
      submitAction('surr-2', 'r2', { type: 'surrender', vote: 'yes' })
      const result = Effect.runSync(processTick('surr-2', mid.state))

      expect(result.state.phase).toBe('ended')
      expect(result.state.winner).toBe('audit')
      expect(result.events.some((e) => e._tag === 'surrendered')).toBe(true)
    })

    it('a no vote retracts a previous yes vote', () => {
      const state = makeGameState({ tick: SURRENDER_MIN_TICK })
      submitAction('surr-3', 'r1', { type: 'surrender', vote: 'yes' })
      const mid = Effect.runSync(processTick('surr-3', state))
      expect(mid.state.surrenderVotes.chaff.has('r1')).toBe(true)

      submitAction('surr-3', 'r1', { type: 'surrender', vote: 'no' })
      const result = Effect.runSync(processTick('surr-3', mid.state))
      expect(result.state.surrenderVotes.chaff.has('r1')).toBe(false)
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
      expect(result.state.surrenderVotes.chaff.size).toBe(0)
      expect(result.rejectedActions.some((r) => r.playerId === 'r1')).toBe(true)
    })
  })

  describe('canSurrender', () => {
    it('is too early before SURRENDER_MIN_TICK', () => {
      const res = canSurrender(makeGameState({ tick: 0 }), 'chaff')
      expect(res.can).toBe(false)
      expect(res.reason).toMatch(/too early/i)
    })

    it('rejects when the team is all bots', () => {
      const state = makeGameState({
        tick: SURRENDER_MIN_TICK,
        players: {
          bot_a: makePlayer({ id: 'bot_a', team: 'chaff' }),
          bot_b: makePlayer({ id: 'bot_b', team: 'chaff' }),
          d1: makePlayer({ id: 'd1', team: 'audit' }),
        },
      })
      const res = canSurrender(state, 'chaff')
      expect(res.can).toBe(false)
      expect(res.reason).toMatch(/no human/i)
    })

    it('allows a team of dead humans past the minimum tick', () => {
      const base = makeGameState({ tick: SURRENDER_MIN_TICK })
      const allDead = {
        ...base,
        players: {
          ...base.players,
          r1: { ...base.players.r1!, alive: false },
          r2: { ...base.players.r2!, alive: false },
          r3: { ...base.players.r3!, alive: false },
        },
      }
      expect(canSurrender(allDead, 'chaff').can).toBe(true)
    })

    it('allows a team with humans past the minimum tick', () => {
      expect(canSurrender(makeGameState({ tick: SURRENDER_MIN_TICK }), 'chaff').can).toBe(true)
    })
  })

  describe('clearSurrenderVotes', () => {
    it('empties both teams’ vote sets', () => {
      const state = makeGameState({
        tick: SURRENDER_MIN_TICK,
        surrenderVotes: { chaff: new Set(['r1', 'r2']), audit: new Set(['d1']) },
      })
      const cleared = clearSurrenderVotes(state)
      expect(cleared.surrenderVotes.chaff.size).toBe(0)
      expect(cleared.surrenderVotes.audit.size).toBe(0)
    })
  })
})
