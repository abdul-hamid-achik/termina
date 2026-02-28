import { describe, it, expect, beforeEach } from 'vitest'
import { Effect } from 'effect'
import {
  createInMemoryStateManager,
  type PlayerSetup,
  type StateManagerApi,
} from '../../../server/game/engine/StateManager'
import { STARTING_GOLD } from '../../../shared/constants/balance'

function makePlayerSetup(overrides: Partial<PlayerSetup> = {}): PlayerSetup {
  return {
    id: 'p1',
    name: 'Player1',
    team: 'radiant',
    heroId: 'echo',
    ...overrides,
  }
}

describe('StateManager', () => {
  let sm: StateManagerApi

  beforeEach(() => {
    sm = createInMemoryStateManager()
  })

  describe('createGame', () => {
    it('should create a new game with initial state', () => {
      const players: PlayerSetup[] = [
        makePlayerSetup({ id: 'p1', team: 'radiant', heroId: 'echo' }),
        makePlayerSetup({ id: 'p2', team: 'dire', name: 'Player2', heroId: 'echo' }),
      ]

      const state = Effect.runSync(sm.createGame('game1', players))

      expect(state.tick).toBe(0)
      expect(state.phase).toBe('picking')
      expect(state.players['p1']).toBeDefined()
      expect(state.players['p2']).toBeDefined()
    })

    it('should initialize players with correct starting gold', () => {
      const players: PlayerSetup[] = [
        makePlayerSetup({ id: 'p1', heroId: 'echo' }),
      ]

      const state = Effect.runSync(sm.createGame('game1', players))
      expect(state.players['p1']!.gold).toBe(STARTING_GOLD)
    })

    it('should place radiant players in radiant fountain', () => {
      const players: PlayerSetup[] = [
        makePlayerSetup({ id: 'p1', team: 'radiant', heroId: 'echo' }),
      ]

      const state = Effect.runSync(sm.createGame('game1', players))
      expect(state.players['p1']!.zone).toBe('radiant-fountain')
    })

    it('should place dire players in dire fountain', () => {
      const players: PlayerSetup[] = [
        makePlayerSetup({ id: 'p1', team: 'dire', heroId: 'echo' }),
      ]

      const state = Effect.runSync(sm.createGame('game1', players))
      expect(state.players['p1']!.zone).toBe('dire-fountain')
    })

    it('should initialize players with hero base stats', () => {
      const players: PlayerSetup[] = [
        makePlayerSetup({ id: 'p1', heroId: 'echo' }),
      ]

      const state = Effect.runSync(sm.createGame('game1', players))
      const p1 = state.players['p1']!
      // Echo has 550 HP, 280 MP base stats
      expect(p1.hp).toBe(550)
      expect(p1.maxHp).toBe(550)
      expect(p1.mp).toBe(280)
      expect(p1.maxMp).toBe(280)
    })

    it('should initialize players at level 1 with 0 xp', () => {
      const players: PlayerSetup[] = [
        makePlayerSetup({ id: 'p1', heroId: 'echo' }),
      ]

      const state = Effect.runSync(sm.createGame('game1', players))
      expect(state.players['p1']!.level).toBe(1)
      expect(state.players['p1']!.xp).toBe(0)
    })

    it('should initialize players with empty items', () => {
      const players: PlayerSetup[] = [
        makePlayerSetup({ id: 'p1', heroId: 'echo' }),
      ]

      const state = Effect.runSync(sm.createGame('game1', players))
      expect(state.players['p1']!.items).toEqual([null, null, null, null, null, null])
    })

    it('should initialize players as alive', () => {
      const players: PlayerSetup[] = [
        makePlayerSetup({ id: 'p1', heroId: 'echo' }),
      ]

      const state = Effect.runSync(sm.createGame('game1', players))
      expect(state.players['p1']!.alive).toBe(true)
      expect(state.players['p1']!.respawnTick).toBeNull()
    })

    it('should initialize cooldowns at 0', () => {
      const players: PlayerSetup[] = [
        makePlayerSetup({ id: 'p1', heroId: 'echo' }),
      ]

      const state = Effect.runSync(sm.createGame('game1', players))
      expect(state.players['p1']!.cooldowns).toEqual({ q: 0, w: 0, e: 0, r: 0 })
    })

    it('should initialize KDA at 0', () => {
      const players: PlayerSetup[] = [
        makePlayerSetup({ id: 'p1', heroId: 'echo' }),
      ]

      const state = Effect.runSync(sm.createGame('game1', players))
      expect(state.players['p1']!.kills).toBe(0)
      expect(state.players['p1']!.deaths).toBe(0)
      expect(state.players['p1']!.assists).toBe(0)
    })

    it('should initialize team states', () => {
      const players: PlayerSetup[] = [
        makePlayerSetup({ id: 'p1', team: 'radiant' }),
      ]

      const state = Effect.runSync(sm.createGame('game1', players))
      expect(state.teams.radiant).toEqual({ id: 'radiant', kills: 0, towerKills: 0, gold: 0 })
      expect(state.teams.dire).toEqual({ id: 'dire', kills: 0, towerKills: 0, gold: 0 })
    })

    it('should initialize towers', () => {
      const players: PlayerSetup[] = [
        makePlayerSetup({ id: 'p1' }),
      ]

      const state = Effect.runSync(sm.createGame('game1', players))
      expect(state.towers.length).toBeGreaterThan(0)
      expect(state.towers.every((t) => t.alive)).toBe(true)
    })

    it('should initialize zones', () => {
      const players: PlayerSetup[] = [
        makePlayerSetup({ id: 'p1' }),
      ]

      const state = Effect.runSync(sm.createGame('game1', players))
      expect(Object.keys(state.zones).length).toBeGreaterThan(0)
    })

    it('should start with empty creeps and events', () => {
      const players: PlayerSetup[] = [
        makePlayerSetup({ id: 'p1' }),
      ]

      const state = Effect.runSync(sm.createGame('game1', players))
      expect(state.creeps).toHaveLength(0)
      expect(state.events).toHaveLength(0)
    })

    it('should fail when creating a game with a duplicate ID', () => {
      const players: PlayerSetup[] = [makePlayerSetup()]

      Effect.runSync(sm.createGame('game1', players))

      const result = Effect.runSyncExit(sm.createGame('game1', players))
      expect(result._tag).toBe('Failure')
    })

    it('should handle null heroId', () => {
      const players: PlayerSetup[] = [
        makePlayerSetup({ id: 'p1', heroId: null }),
      ]

      const state = Effect.runSync(sm.createGame('game1', players))
      // With null heroId, stats default to 0
      expect(state.players['p1']!.hp).toBe(0)
      expect(state.players['p1']!.maxHp).toBe(0)
    })
  })

  describe('getState', () => {
    it('should return the game state', () => {
      const players: PlayerSetup[] = [makePlayerSetup()]
      Effect.runSync(sm.createGame('game1', players))

      const state = Effect.runSync(sm.getState('game1'))
      expect(state.tick).toBe(0)
      expect(state.players['p1']).toBeDefined()
    })

    it('should fail for non-existent game', () => {
      const result = Effect.runSyncExit(sm.getState('nonexistent'))
      expect(result._tag).toBe('Failure')
    })
  })

  describe('updateState', () => {
    it('should update the game state with a function', () => {
      const players: PlayerSetup[] = [makePlayerSetup()]
      Effect.runSync(sm.createGame('game1', players))

      const updated = Effect.runSync(
        sm.updateState('game1', (s) => ({ ...s, tick: 42 })),
      )
      expect(updated.tick).toBe(42)

      // Verify the update persisted
      const state = Effect.runSync(sm.getState('game1'))
      expect(state.tick).toBe(42)
    })

    it('should fail for non-existent game', () => {
      const result = Effect.runSyncExit(
        sm.updateState('nonexistent', (s) => s),
      )
      expect(result._tag).toBe('Failure')
    })

    it('should allow updating player state', () => {
      const players: PlayerSetup[] = [makePlayerSetup({ heroId: 'echo' })]
      Effect.runSync(sm.createGame('game1', players))

      Effect.runSync(
        sm.updateState('game1', (s) => ({
          ...s,
          players: {
            ...s.players,
            p1: { ...s.players['p1']!, gold: 999 },
          },
        })),
      )

      const state = Effect.runSync(sm.getState('game1'))
      expect(state.players['p1']!.gold).toBe(999)
    })
  })

  describe('deleteGame', () => {
    it('should delete an existing game', () => {
      const players: PlayerSetup[] = [makePlayerSetup()]
      Effect.runSync(sm.createGame('game1', players))

      Effect.runSync(sm.deleteGame('game1'))

      // Game should no longer exist
      const result = Effect.runSyncExit(sm.getState('game1'))
      expect(result._tag).toBe('Failure')
    })

    it('should not fail when deleting non-existent game', () => {
      // deleteGame is silent for non-existent games
      expect(() => Effect.runSync(sm.deleteGame('nonexistent'))).not.toThrow()
    })
  })

  describe('listGames', () => {
    it('should return empty list initially', () => {
      const games = Effect.runSync(sm.listGames())
      expect(games).toHaveLength(0)
    })

    it('should list all created games', () => {
      const players: PlayerSetup[] = [makePlayerSetup()]
      Effect.runSync(sm.createGame('game1', players))
      Effect.runSync(sm.createGame('game2', players))

      const games = Effect.runSync(sm.listGames())
      expect(games).toContain('game1')
      expect(games).toContain('game2')
      expect(games).toHaveLength(2)
    })

    it('should not list deleted games', () => {
      const players: PlayerSetup[] = [makePlayerSetup()]
      Effect.runSync(sm.createGame('game1', players))
      Effect.runSync(sm.createGame('game2', players))
      Effect.runSync(sm.deleteGame('game1'))

      const games = Effect.runSync(sm.listGames())
      expect(games).toEqual(['game2'])
    })
  })

  describe('isolation', () => {
    it('should not share state between different StateManager instances', () => {
      const sm2 = createInMemoryStateManager()
      const players: PlayerSetup[] = [makePlayerSetup()]

      Effect.runSync(sm.createGame('game1', players))

      // sm2 should not see game1
      const result = Effect.runSyncExit(sm2.getState('game1'))
      expect(result._tag).toBe('Failure')
    })
  })
})
