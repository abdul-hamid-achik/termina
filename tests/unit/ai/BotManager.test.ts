import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createBotPlayers,
  isBot,
  registerBots,
  getBotPlayerIds,
  getBotLane,
  getBotDifficulty,
  cleanupGame,
} from '../../../server/game/ai/BotManager'
import * as BotAI from '../../../server/game/ai/BotAI'

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
        { playerId: 'bot_alpha', team: 'radiant' as const, heroId: 'echo' },
        { playerId: 'bot_beta', team: 'dire' as const, heroId: 'sentry' },
        { playerId: 'human1', team: 'radiant' as const, heroId: 'daemon' },
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

    it('assigns lanes to bots based on hero roles', () => {
      const players = [
        { playerId: 'bot_alpha', team: 'radiant' as const, heroId: 'echo' }, // carry -> bot
        { playerId: 'bot_beta', team: 'radiant' as const, heroId: 'sentry' }, // support
        { playerId: 'bot_gamma', team: 'radiant' as const, heroId: 'daemon' }, // assassin
        { playerId: 'bot_delta', team: 'radiant' as const, heroId: 'kernel' }, // tank
        { playerId: 'bot_epsilon', team: 'radiant' as const, heroId: 'regex' }, // mage
      ]
      registerBots('test-game', players)

      // Priority order: carry, mage, assassin, tank, support
      // 1. carry (bot_alpha) -> preferred ['bot', 'top', 'mid'] -> bot=0 -> assign 'bot'
      // 2. mage (bot_epsilon) -> preferred ['mid', 'top', 'bot'] -> mid=0 -> assign 'mid'
      // 3. assassin (bot_gamma) -> preferred ['mid', 'top', 'bot'] -> mid=1 < 2 -> assign 'mid'
      // 4. tank (bot_delta) -> preferred ['top', 'mid', 'bot'] -> top=0 -> assign 'top'
      // 5. support (bot_beta) -> preferred ['mid', 'bot', 'top'] -> mid=2 full -> bot=1 -> assign 'bot'
      expect(getBotLane('test-game', 'bot_alpha')).toBe('bot') // carry
      expect(getBotLane('test-game', 'bot_epsilon')).toBe('mid') // mage
      expect(getBotLane('test-game', 'bot_gamma')).toBe('mid') // assassin (mid has room)
      expect(getBotLane('test-game', 'bot_delta')).toBe('top') // tank
      expect(getBotLane('test-game', 'bot_beta')).toBe('bot') // support (mid full)
    })

    it('defaults to mid for unknown bot', () => {
      registerBots('test-game', [])
      expect(getBotLane('test-game', 'unknown-bot')).toBe('mid')
    })

    it('defaults to mid for unknown game', () => {
      expect(getBotLane('unknown-game', 'bot_alpha')).toBe('mid')
    })
  })

  describe('register options (the tutorial path: forceLane + difficulty)', () => {
    beforeEach(() => {
      cleanupGame('test-game')
    })

    const tutorialBots = [
      { playerId: 'bot_ally', team: 'radiant' as const, heroId: 'echo' }, // carry → bot normally
      { playerId: 'bot_enemy0', team: 'dire' as const, heroId: 'kernel' }, // tank → top normally
    ]

    it('forceLane pins every bot to one lane regardless of role', () => {
      registerBots('test-game', tutorialBots, { forceLane: 'mid' })
      expect(getBotLane('test-game', 'bot_ally')).toBe('mid')
      expect(getBotLane('test-game', 'bot_enemy0')).toBe('mid')
    })

    it('applies the chosen difficulty alongside forceLane', () => {
      registerBots('test-game', tutorialBots, { forceLane: 'mid', difficulty: 'easy' })
      expect(getBotDifficulty('test-game', 'bot_ally')).toBe('easy')
      expect(getBotDifficulty('test-game', 'bot_enemy0')).toBe('easy')
      expect(getBotLane('test-game', 'bot_ally')).toBe('mid')
    })

    it('still accepts a bare difficulty string as the 3rd arg (back-compat)', () => {
      registerBots('test-game', tutorialBots, 'hard')
      expect(getBotDifficulty('test-game', 'bot_ally')).toBe('hard')
      // No forceLane → role-based assignment still runs.
      expect(getBotLane('test-game', 'bot_ally')).toBe('bot') // carry
    })
  })

  describe('availableLanes (the 3v3 two-lane map path)', () => {
    beforeEach(() => {
      cleanupGame('test-game')
    })

    const twoLaneBots = [
      { playerId: 'bot_carry', team: 'radiant' as const, heroId: 'echo' }, // carry → bot normally
      { playerId: 'bot_tank', team: 'radiant' as const, heroId: 'kernel' }, // tank → top normally
      { playerId: 'bot_support', team: 'dire' as const, heroId: 'sentry' }, // support → mid/bot
    ]

    it('restricts lane assignment to only the provided lanes', () => {
      // Two-lane map: top + mid only, no bot.
      registerBots('test-game', twoLaneBots, { availableLanes: ['top', 'mid'] })

      // carry would normally go 'bot' — remapped to its next preferred lane.
      const carryLane = getBotLane('test-game', 'bot_carry')
      expect(['top', 'mid']).toContain(carryLane)
      const tankLane = getBotLane('test-game', 'bot_tank')
      expect(['top', 'mid']).toContain(tankLane)
      const supportLane = getBotLane('test-game', 'bot_support')
      expect(['top', 'mid']).toContain(supportLane)
    })

    it('never assigns a lane outside availableLanes', () => {
      registerBots('test-game', twoLaneBots, { availableLanes: ['top', 'mid'] })
      for (const bot of twoLaneBots) {
        expect(getBotLane('test-game', bot.playerId)).not.toBe('bot')
        expect(getBotLane('test-game', bot.playerId)).not.toBe('jungle')
      }
    })

    it('forceLane wins over availableLanes when both are set', () => {
      registerBots('test-game', twoLaneBots, {
        forceLane: 'mid',
        availableLanes: ['top', 'mid'],
      })
      expect(getBotLane('test-game', 'bot_carry')).toBe('mid')
      expect(getBotLane('test-game', 'bot_tank')).toBe('mid')
      expect(getBotLane('test-game', 'bot_support')).toBe('mid')
    })
  })

  describe('cleanupGame', () => {
    it('removes bot tracking for a game', () => {
      const players = [{ playerId: 'bot_alpha', team: 'radiant' as const, heroId: 'echo' }]
      registerBots('test-game', players)
      expect(getBotPlayerIds('test-game')).toHaveLength(1)

      cleanupGame('test-game')
      expect(getBotPlayerIds('test-game')).toEqual([])
    })

    it('does not crash when cleaning up unknown game', () => {
      expect(() => cleanupGame('nonexistent')).not.toThrow()
    })

    it("clears each bot's BotAI combo state (fixes a comboStates leak)", () => {
      // comboStates (BotAI) is keyed by bot id and only pruned mid-combo, so it
      // leaked an entry per bot. cleanupGame must now clear it for every bot.
      const spy = vi.spyOn(BotAI, 'cleanupBotState')
      registerBots('leak-game', [
        { playerId: 'bot_a', team: 'radiant', heroId: 'echo' },
        { playerId: 'bot_b', team: 'dire', heroId: 'cron' },
      ])
      cleanupGame('leak-game')
      expect(spy).toHaveBeenCalledWith('bot_a')
      expect(spy).toHaveBeenCalledWith('bot_b')
      spy.mockRestore()
    })
  })

  describe('Bot Name Pool Expansion', () => {
    it('should generate unique names for >10 bots', () => {
      const bots = createBotPlayers(15, [])
      const ids = bots.map((b) => b.playerId)

      expect(bots).toHaveLength(15)
      expect(new Set(ids).size).toBe(15)
    })

    it('should generate unique names for >50 bots', () => {
      const bots = createBotPlayers(60, [])
      const ids = bots.map((b) => b.playerId)

      expect(bots).toHaveLength(60)
      expect(new Set(ids).size).toBe(60)
      for (const id of ids) {
        expect(id.startsWith('bot_')).toBe(true)
      }
    })
  })
})
