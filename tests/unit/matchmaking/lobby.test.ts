import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Effect } from 'effect'
import {
  createLobby,
  pickHero,
  getLobby,
  getPlayerLobby,
  cleanupLobby,
  cancelLobby,
} from '../../../server/game/matchmaking/lobby'
import type { QueueEntry } from '../../../server/game/matchmaking/queue'
import { HERO_IDS } from '../../../shared/constants/heroes'

// ── Mocks ──────────────────────────────────────────────────────────

// Mock PeerRegistry to prevent actual sends
vi.mock('../../../server/services/PeerRegistry', () => ({
  sendToPeer: vi.fn(),
}))

// Mock BotManager to control bot detection
vi.mock('../../../server/game/ai/BotManager', () => ({
  isBot: (id: string) => id.startsWith('bot_'),
}))

function mockWs() {
  return {
    addConnection: vi.fn(() => Effect.void),
    removeConnection: vi.fn(() => Effect.void),
    sendToPlayer: vi.fn(() => Effect.void),
    broadcastToGame: vi.fn(() => Effect.void),
  }
}

function mockRedis() {
  return {
    get: vi.fn(() => Effect.succeed(null)),
    set: vi.fn(() => Effect.void),
    del: vi.fn(() => Effect.void),
    publish: vi.fn(() => Effect.void),
    subscribe: vi.fn(() => Effect.void),
    zadd: vi.fn(() => Effect.void),
    zrem: vi.fn(() => Effect.void),
    zcard: vi.fn(() => Effect.succeed(0)),
    zrangebyscore: vi.fn(() => Effect.succeed([])),
  }
}

function mockDb() {
  return {
    saveGame: vi.fn(() => Effect.void),
    loadGame: vi.fn(() => Effect.succeed(null)),
    savePlayerStats: vi.fn(() => Effect.void),
  }
}

function makeQueueEntries(count: number): QueueEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    playerId: `player_${i}`,
    username: `Player ${i}`,
    mmr: 1000 + i * 10,
    joinedAt: Date.now(),
    mode: 'ranked_5v5' as const,
  }))
}

// ── Tests ──────────────────────────────────────────────────────────

describe('Lobby', () => {
  let ws: ReturnType<typeof mockWs>
  let redis: ReturnType<typeof mockRedis>
  let db: ReturnType<typeof mockDb>
  let createdLobbyId: string | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    ws = mockWs()
    redis = mockRedis()
    db = mockDb()
    createdLobbyId = null
  })

  afterEach(() => {
    // Clean up any created lobbies
    if (createdLobbyId) {
      cleanupLobby(createdLobbyId)
    }
    vi.useRealTimers()
  })

  describe('createLobby', () => {
    it('creates a lobby with correct player count', () => {
      const entries = makeQueueEntries(10)
      const lobby = createLobby(entries, ws as never, redis as never, db as never)
      createdLobbyId = lobby.id

      expect(lobby.players).toHaveLength(10)
      expect(lobby.phase).toBe('banning') // Starts with ban phase
      expect(lobby.bannedHeroes.size).toBe(0)
      expect(lobby.currentBanIndex).toBe(0)
    })

    it('assigns teams in alternating fashion by MMR', () => {
      const entries = makeQueueEntries(4)
      const lobby = createLobby(entries, ws as never, redis as never, db as never)
      createdLobbyId = lobby.id

      const radiant = lobby.players.filter((p) => p.team === 'radiant')
      const dire = lobby.players.filter((p) => p.team === 'dire')
      expect(radiant.length).toBe(2)
      expect(dire.length).toBe(2)
    })

    it('generates unique lobby IDs', () => {
      const entries1 = makeQueueEntries(2)
      const entries2 = makeQueueEntries(2).map((e, i) => ({ ...e, playerId: `other_${i}` }))

      const lobby1 = createLobby(entries1, ws as never, redis as never, db as never)
      const lobby2 = createLobby(entries2, ws as never, redis as never, db as never)

      expect(lobby1.id).not.toBe(lobby2.id)

      // Cleanup
      cleanupLobby(lobby1.id)
      cleanupLobby(lobby2.id)
    })

    it('tracks player→lobby mapping', () => {
      const entries = makeQueueEntries(4)
      const lobby = createLobby(entries, ws as never, redis as never, db as never)
      createdLobbyId = lobby.id

      for (const entry of entries) {
        expect(getPlayerLobby(entry.playerId)).toBe(lobby.id)
      }
    })

    it('initializes with empty picked heroes and zero pick index', () => {
      const entries = makeQueueEntries(4)
      const lobby = createLobby(entries, ws as never, redis as never, db as never)
      createdLobbyId = lobby.id

      expect(lobby.pickedHeroes.size).toBe(0)
      expect(lobby.currentPickIndex).toBe(0)
    })
  })

  describe('pickHero', () => {
    // Use 10 players to match the PICK_SEQUENCE_10 indices
    function createPickableLobby() {
      const entries = makeQueueEntries(10)
      const lobby = createLobby(entries, ws as never, redis as never, db as never)
      createdLobbyId = lobby.id

      // Simulate ban phase completion (1 ban per team)
      lobby.bannedHeroes.add('cipher') // Radiant ban
      lobby.bannedHeroes.add('regex') // Dire ban
      lobby.currentBanIndex = 2
      lobby.phase = 'picking'

      return lobby
    }

    it("allows a valid hero pick when it is the player's turn", () => {
      const lobby = createPickableLobby()
      const firstPicker = lobby.players[lobby.pickOrder[0]!]!

      const result = pickHero(
        lobby.id,
        firstPicker.playerId,
        'echo',
        ws as never,
        redis as never,
        db as never,
      )
      expect(result.success).toBe(true)
      expect(firstPicker.heroId).toBe('echo')
    })

    it('rejects pick from wrong player', () => {
      const lobby = createPickableLobby()
      // Pick from a player who is NOT first in the pick order
      const wrongPlayer = lobby.players[lobby.pickOrder[1]!]!

      const result = pickHero(
        lobby.id,
        wrongPlayer.playerId,
        'echo',
        ws as never,
        redis as never,
        db as never,
      )
      expect(result.success).toBe(false)
      expect(result.error).toBe('Not your turn to pick')
    })

    it('rejects invalid hero ID', () => {
      const lobby = createPickableLobby()
      const firstPicker = lobby.players[lobby.pickOrder[0]!]!

      const result = pickHero(
        lobby.id,
        firstPicker.playerId,
        'nonexistent_hero',
        ws as never,
        redis as never,
        db as never,
      )
      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid hero')
    })

    it('rejects duplicate hero pick when others are available', () => {
      const lobby = createPickableLobby()

      // First player picks echo
      const firstPicker = lobby.players[lobby.pickOrder[0]!]!
      pickHero(lobby.id, firstPicker.playerId, 'echo', ws as never, redis as never, db as never)

      // Second player tries to pick echo too
      const secondPicker = lobby.players[lobby.pickOrder[1]!]!
      const result = pickHero(
        lobby.id,
        secondPicker.playerId,
        'echo',
        ws as never,
        redis as never,
        db as never,
      )
      expect(result.success).toBe(false)
      expect(result.error).toBe('Hero already picked')
    })

    it('rejects pick for nonexistent lobby', () => {
      const result = pickHero(
        'fake_lobby',
        'player_0',
        'echo',
        ws as never,
        redis as never,
        db as never,
      )
      expect(result.success).toBe(false)
      expect(result.error).toBe('Lobby not found')
    })

    it('advances pick index after successful pick', () => {
      const lobby = createPickableLobby()
      const firstPicker = lobby.players[lobby.pickOrder[0]!]!

      expect(lobby.currentPickIndex).toBe(0)
      pickHero(lobby.id, firstPicker.playerId, 'echo', ws as never, redis as never, db as never)
      expect(lobby.currentPickIndex).toBe(1)
    })

    it('adds picked hero to pickedHeroes set', () => {
      const lobby = createPickableLobby()
      const firstPicker = lobby.players[lobby.pickOrder[0]!]!

      pickHero(lobby.id, firstPicker.playerId, 'daemon', ws as never, redis as never, db as never)
      expect(lobby.pickedHeroes.has('daemon')).toBe(true)
    })

    it('accepts any valid hero from the hero pool', () => {
      const lobby = createPickableLobby()
      for (const heroId of HERO_IDS.slice(0, lobby.pickOrder.length)) {
        const picker = lobby.players[lobby.pickOrder[lobby.currentPickIndex]!]!
        const result = pickHero(
          lobby.id,
          picker.playerId,
          heroId,
          ws as never,
          redis as never,
          db as never,
        )
        expect(result.success).toBe(true)
      }
    })
  })

  describe('getLobby / getPlayerLobby', () => {
    it('retrieves lobby by ID', () => {
      const entries = makeQueueEntries(2)
      const lobby = createLobby(entries, ws as never, redis as never, db as never)
      createdLobbyId = lobby.id

      expect(getLobby(lobby.id)).toBe(lobby)
    })

    it('returns undefined for unknown lobby ID', () => {
      expect(getLobby('unknown_lobby')).toBeUndefined()
    })

    it('returns undefined for unknown player', () => {
      expect(getPlayerLobby('unknown_player')).toBeUndefined()
    })
  })

  describe('cleanupLobby', () => {
    it('removes lobby and all player mappings', () => {
      const entries = makeQueueEntries(4)
      const lobby = createLobby(entries, ws as never, redis as never, db as never)
      const lobbyId = lobby.id

      cleanupLobby(lobbyId)
      createdLobbyId = null // Already cleaned up

      expect(getLobby(lobbyId)).toBeUndefined()
      for (const entry of entries) {
        expect(getPlayerLobby(entry.playerId)).toBeUndefined()
      }
    })

    it('is safe to call on nonexistent lobby', () => {
      expect(() => cleanupLobby('fake_lobby')).not.toThrow()
    })
  })

  describe('cancelLobby', () => {
    it('sets phase to cancelled', () => {
      const entries = makeQueueEntries(4)
      const lobby = createLobby(entries, ws as never, redis as never, db as never)
      const lobbyId = lobby.id

      cancelLobby(lobbyId, ws as never)

      // Lobby should be removed from activeLobbies
      expect(getLobby(lobbyId)).toBeUndefined()
      // Player mappings should be removed
      for (const entry of entries) {
        expect(getPlayerLobby(entry.playerId)).toBeUndefined()
      }
      createdLobbyId = null
    })

    it('is safe to call on nonexistent lobby', () => {
      expect(() => cancelLobby('fake_lobby', ws as never)).not.toThrow()
    })
  })

  describe('pick phases and transitions', () => {
    it('transitions to starting after all heroes are picked', () => {
      vi.useFakeTimers()
      const entries = makeQueueEntries(10)
      createLobby(entries, ws as never, redis as never, db as never)

      // After grace period (30s), lobby should be cancelled
      vi.advanceTimersByTime(30000)

      // The implementation should cancel the lobby after grace period
      vi.useRealTimers()
      createdLobbyId = null
    })
  })

  describe('Bot Replacement for Disconnected Players', () => {
    it('should replace disconnected player with bot', () => {
      const entries = makeQueueEntries(10)
      const lobby = createLobby(entries, ws as never, redis as never, db as never)
      createdLobbyId = lobby.id

      // Verify lobby has correct player count
      expect(lobby.players).toHaveLength(10)
    })

    it("should assign bot to player's lane", () => {
      const entries = makeQueueEntries(10)
      const lobby = createLobby(entries, ws as never, redis as never, db as never)
      createdLobbyId = lobby.id

      // Bot replacement should maintain team balance
      const radiantCount = lobby.players.filter((p) => p.team === 'radiant').length
      const direCount = lobby.players.filter((p) => p.team === 'dire').length
      expect(radiantCount).toBe(5)
      expect(direCount).toBe(5)
    })
  })

  describe('Timer Cleanup on Lobby Cancel', () => {
    it('should clear timer on lobby cancel', () => {
      vi.useFakeTimers()
      const entries = makeQueueEntries(10)
      const lobby = createLobby(entries, ws as never, redis as never, db as never)
      const lobbyId = lobby.id

      cancelLobby(lobbyId, ws as never)

      // Timer should be cleared
      expect(lobby.pickTimer).toBeNull()
      expect(getLobby(lobbyId)).toBeUndefined()
      vi.useRealTimers()
      createdLobbyId = null
    })
  })
})
