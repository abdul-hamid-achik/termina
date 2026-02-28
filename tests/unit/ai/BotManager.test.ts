import { describe, it, expect, beforeEach } from 'vitest'
import {
  createBotPlayers,
  isBot,
  registerBots,
  getBotPlayerIds,
  getBotLane,
  cleanupGame,
} from '../../../server/game/ai/BotManager'

describe('BotManager', () => {
  describe('isBot', () => {
    it('returns true for bot player IDs', () => {
      expect(isBot('bot_alpha')).toBe(true)
      expect(isBot('bot_beta')).toBe(true)
      expect(isBot('bot_0')).toBe(true)
    })

    it('returns false for human player IDs', () => {
      expect(isBot('player1')).toBe(false)
      expect(isBot('user_alpha')).toBe(false)
      expect(isBot('alphabot')).toBe(false)
    })
  })

  describe('createBotPlayers', () => {
    it('creates the requested number of bots', () => {
      const bots = createBotPlayers(3, [])
      expect(bots).toHaveLength(3)
    })

    it('creates bots with unique IDs', () => {
      const bots = createBotPlayers(5, [])
      const ids = bots.map((b) => b.playerId)
      expect(new Set(ids).size).toBe(5)
    })

    it('all bot IDs start with "bot_"', () => {
      const bots = createBotPlayers(5, [])
      for (const b of bots) {
        expect(b.playerId.startsWith('bot_')).toBe(true)
      }
    })

    it('avoids collisions with existing player IDs', () => {
      const existing = ['bot_alpha']
      const bots = createBotPlayers(3, existing)
      for (const b of bots) {
        expect(b.playerId).not.toBe('bot_alpha')
      }
    })

    it('sets mmr to 1000 for all bots', () => {
      const bots = createBotPlayers(3, [])
      for (const b of bots) {
        expect(b.mmr).toBe(1000)
      }
    })

    it('sets mode to ranked_5v5', () => {
      const bots = createBotPlayers(2, [])
      for (const b of bots) {
        expect(b.mode).toBe('ranked_5v5')
      }
    })

    it('creates zero bots when count is 0', () => {
      const bots = createBotPlayers(0, [])
      expect(bots).toHaveLength(0)
    })
  })

  describe('registerBots and getBotPlayerIds', () => {
    beforeEach(() => {
      cleanupGame('test-game')
    })

    it('registers bots for a game', () => {
      const players = [
        { playerId: 'bot_alpha', team: 'radiant' as const },
        { playerId: 'bot_beta', team: 'dire' as const },
        { playerId: 'human1', team: 'radiant' as const },
      ]
      registerBots('test-game', players)

      const botIds = getBotPlayerIds('test-game')
      expect(botIds).toContain('bot_alpha')
      expect(botIds).toContain('bot_beta')
      expect(botIds).not.toContain('human1')
    })

    it('returns empty array for unknown game', () => {
      expect(getBotPlayerIds('unknown-game')).toEqual([])
    })
  })

  describe('getBotLane', () => {
    beforeEach(() => {
      cleanupGame('test-game')
    })

    it('assigns lanes to bots', () => {
      const players = [
        { playerId: 'bot_alpha', team: 'radiant' as const },
        { playerId: 'bot_beta', team: 'radiant' as const },
        { playerId: 'bot_gamma', team: 'radiant' as const },
        { playerId: 'bot_delta', team: 'radiant' as const },
        { playerId: 'bot_epsilon', team: 'radiant' as const },
      ]
      registerBots('test-game', players)

      // Lane pattern: top, top, mid, bot, bot
      expect(getBotLane('test-game', 'bot_alpha')).toBe('top')
      expect(getBotLane('test-game', 'bot_beta')).toBe('top')
      expect(getBotLane('test-game', 'bot_gamma')).toBe('mid')
      expect(getBotLane('test-game', 'bot_delta')).toBe('bot')
      expect(getBotLane('test-game', 'bot_epsilon')).toBe('bot')
    })

    it('defaults to mid for unknown bot', () => {
      registerBots('test-game', [])
      expect(getBotLane('test-game', 'unknown-bot')).toBe('mid')
    })

    it('defaults to mid for unknown game', () => {
      expect(getBotLane('unknown-game', 'bot_alpha')).toBe('mid')
    })
  })

  describe('cleanupGame', () => {
    it('removes bot tracking for a game', () => {
      const players = [
        { playerId: 'bot_alpha', team: 'radiant' as const },
      ]
      registerBots('test-game', players)
      expect(getBotPlayerIds('test-game')).toHaveLength(1)

      cleanupGame('test-game')
      expect(getBotPlayerIds('test-game')).toEqual([])
    })

    it('does not crash when cleaning up unknown game', () => {
      expect(() => cleanupGame('nonexistent')).not.toThrow()
    })
  })
})
