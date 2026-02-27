import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import {
  resolveActions,
  validateAction,
  type PlayerAction,
} from '../../../server/game/engine/ActionResolver'
import type { GameState, PlayerState } from '../../../shared/types/game'
import { initializeZoneStates, initializeTowers } from '../../../server/game/map/zones'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'Player1',
    team: 'radiant',
    heroId: 'echo',
    zone: 'mid-t1-rad',
    hp: 500,
    maxHp: 500,
    mp: 200,
    maxMp: 200,
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
    ...overrides,
  }
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    tick: 1,
    phase: 'playing',
    teams: {
      radiant: { id: 'radiant', kills: 0, towerKills: 0, gold: 0 },
      dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0 },
    },
    players: {},
    zones: initializeZoneStates(),
    creeps: [],
    towers: initializeTowers(),
    events: [],
    ...overrides,
  }
}

describe('ActionResolver', () => {
  describe('validateAction', () => {
    it('should allow moving to adjacent zone', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ zone: 'mid-t1-rad' }) },
      })
      const error = validateAction(state, {
        playerId: 'p1',
        command: { type: 'move', zone: 'mid-t2-rad' },
      })
      expect(error).toBeNull()
    })

    it('should reject moving to non-adjacent zone', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ zone: 'mid-t1-rad' }) },
      })
      const error = validateAction(state, {
        playerId: 'p1',
        command: { type: 'move', zone: 'bot-t1-rad' },
      })
      expect(error).toBe('Cannot move to non-adjacent zone')
    })

    it('should reject actions from dead players', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ alive: false }) },
      })
      const error = validateAction(state, {
        playerId: 'p1',
        command: { type: 'move', zone: 'mid-t2-rad' },
      })
      expect(error).toBe('Player is dead')
    })

    it('should reject casting on cooldown', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ cooldowns: { q: 3, w: 0, e: 0, r: 0 } }),
        },
      })
      const error = validateAction(state, {
        playerId: 'p1',
        command: { type: 'cast', ability: 'q' },
      })
      expect(error).toBe('Ability on cooldown')
    })

    it('should reject casting without enough mana', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ mp: 10 }) }, // Echo Q costs 60
      })
      const error = validateAction(state, {
        playerId: 'p1',
        command: { type: 'cast', ability: 'q' },
      })
      expect(error).toBe('Not enough mana')
    })

    it('should reject buying outside shop', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ zone: 'mid-river' }) },
      })
      const error = validateAction(state, {
        playerId: 'p1',
        command: { type: 'buy', item: 'sword' },
      })
      expect(error).toBe('Not in a shop zone')
    })

    it('should allow buying in fountain (shop zone)', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ zone: 'radiant-fountain' }) },
      })
      const error = validateAction(state, {
        playerId: 'p1',
        command: { type: 'buy', item: 'sword' },
      })
      expect(error).toBeNull()
    })

    it('should reject move while stunned', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            buffs: [{ id: 'stun', stacks: 1, ticksRemaining: 2, source: 'e1' }],
          }),
        },
      })
      const error = validateAction(state, {
        playerId: 'p1',
        command: { type: 'move', zone: 'mid-t2-rad' },
      })
      expect(error).toBe('Cannot move while rooted or stunned')
    })

    it('should allow chat from any state', () => {
      const state = makeGameState({
        players: { p1: makePlayer() },
      })
      const error = validateAction(state, {
        playerId: 'p1',
        command: { type: 'chat', channel: 'all', message: 'gg' },
      })
      expect(error).toBeNull()
    })
  })

  describe('resolveActions', () => {
    it('should move players to new zones', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', zone: 'mid-t1-rad' }),
        },
      })

      const actions: PlayerAction[] = [
        { playerId: 'p1', command: { type: 'move', zone: 'mid-river' } },
      ]

      const result = Effect.runSync(resolveActions(state, actions))
      expect(result.state.players['p1']!.zone).toBe('mid-river')
    })

    it('should resolve multiple moves simultaneously', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', zone: 'mid-t1-rad', team: 'radiant' }),
          p2: makePlayer({ id: 'p2', zone: 'mid-t1-dire', team: 'dire' }),
        },
      })

      const actions: PlayerAction[] = [
        { playerId: 'p1', command: { type: 'move', zone: 'mid-river' } },
        { playerId: 'p2', command: { type: 'move', zone: 'mid-river' } },
      ]

      const result = Effect.runSync(resolveActions(state, actions))
      // Both should be in mid-river — zones hold multiple units
      expect(result.state.players['p1']!.zone).toBe('mid-river')
      expect(result.state.players['p2']!.zone).toBe('mid-river')
    })

    it('should track hero attackers for tower AI', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', zone: 'mid-river', team: 'radiant' }),
          p2: makePlayer({ id: 'p2', zone: 'mid-river', team: 'dire', name: 'Enemy' }),
        },
      })

      const actions: PlayerAction[] = [
        { playerId: 'p1', command: { type: 'attack', target: { kind: 'hero', name: 'Enemy' } } },
      ]

      const result = Effect.runSync(resolveActions(state, actions))
      expect(result.heroAttackers.get('p1')).toBe('p2')
    })

    it('should generate damage events on attack', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', zone: 'mid-river', team: 'radiant', heroId: 'echo' }),
          p2: makePlayer({ id: 'p2', zone: 'mid-river', team: 'dire', name: 'Enemy', hp: 500 }),
        },
      })

      const actions: PlayerAction[] = [
        { playerId: 'p1', command: { type: 'attack', target: { kind: 'hero', name: 'Enemy' } } },
      ]

      const result = Effect.runSync(resolveActions(state, actions))
      const dmgEvents = result.events.filter((e) => e._tag === 'damage')
      expect(dmgEvents.length).toBeGreaterThan(0)
      expect(dmgEvents[0]!.sourceId).toBe('p1')
      expect(dmgEvents[0]!.targetId).toBe('p2')
    })

    it('should tick down cooldowns each tick', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', cooldowns: { q: 3, w: 1, e: 0, r: 5 } }),
        },
      })

      const result = Effect.runSync(resolveActions(state, []))
      const cd = result.state.players['p1']!.cooldowns
      expect(cd.q).toBe(2)
      expect(cd.w).toBe(0)
      expect(cd.e).toBe(0)
      expect(cd.r).toBe(4)
    })

    it('should expire buffs with 0 remaining ticks', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            buffs: [
              { id: 'shield', stacks: 1, ticksRemaining: 1, source: 'p2' },
              { id: 'buff', stacks: 1, ticksRemaining: 3, source: 'p2' },
            ],
          }),
        },
      })

      const result = Effect.runSync(resolveActions(state, []))
      const buffs = result.state.players['p1']!.buffs
      // ticksRemaining 1 -> 0, should be removed
      // ticksRemaining 3 -> 2, should remain
      expect(buffs.length).toBe(1)
      expect(buffs[0]!.id).toBe('buff')
      expect(buffs[0]!.ticksRemaining).toBe(2)
    })

    it('should place wards in valid zones', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', zone: 'mid-river', team: 'radiant' }),
        },
      })

      const actions: PlayerAction[] = [
        { playerId: 'p1', command: { type: 'ward', zone: 'mid-river' } },
      ]

      const result = Effect.runSync(resolveActions(state, actions))
      const wardEvents = result.events.filter((e) => e._tag === 'ward_placed')
      expect(wardEvents.length).toBe(1)
    })
  })
})
