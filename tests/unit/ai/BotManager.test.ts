import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createBotPlayers,
  isBot,
  registerBots,
  getBotPlayerIds,
  getBotLane,
  getBotDifficulty,
  convertToBot,
  isGameBot,
  cleanupGame,
  difficultyForMmr,
  parseBotDifficulty,
  BOT_DIFFICULTY_CONFIGS,
} from '~~/server/game/ai/BotManager'
import type { BotDifficulty } from '~~/server/game/ai/BotManager'
import * as BotAI from '~~/server/game/ai/BotAI'

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
        { playerId: 'bot_alpha', team: 'chaff' as const, heroId: 'echo' },
        { playerId: 'bot_beta', team: 'audit' as const, heroId: 'sentry' },
        { playerId: 'human1', team: 'chaff' as const, heroId: 'daemon' },
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
        { playerId: 'bot_alpha', team: 'chaff' as const, heroId: 'echo' }, // carry -> bot
        { playerId: 'bot_beta', team: 'chaff' as const, heroId: 'sentry' }, // support
        { playerId: 'bot_gamma', team: 'chaff' as const, heroId: 'daemon' }, // assassin
        { playerId: 'bot_delta', team: 'chaff' as const, heroId: 'kernel' }, // tank
        { playerId: 'bot_epsilon', team: 'chaff' as const, heroId: 'regex' }, // mage
      ]
      registerBots('test-game', players)

      // Priority order: carry, mage, assassin, tank, support
      // 1. carry (bot_alpha) -> preferred ['shallows', 'seawall', 'coldstore'] -> bot=0 -> assign 'shallows'
      // 2. mage (bot_epsilon) -> preferred ['coldstore', 'seawall', 'shallows'] -> mid=0 -> assign 'coldstore'
      // 3. assassin (bot_gamma) -> preferred ['coldstore', 'seawall', 'shallows'] -> mid=1 < 2 -> assign 'coldstore'
      // 4. tank (bot_delta) -> preferred ['seawall', 'coldstore', 'shallows'] -> top=0 -> assign 'seawall'
      // 5. support (bot_beta) -> preferred ['coldstore', 'shallows', 'seawall'] -> mid=2 full -> bot=1 -> assign 'shallows'
      expect(getBotLane('test-game', 'bot_alpha')).toBe('shallows') // carry
      expect(getBotLane('test-game', 'bot_epsilon')).toBe('coldstore') // mage
      expect(getBotLane('test-game', 'bot_gamma')).toBe('coldstore') // assassin (mid has room)
      expect(getBotLane('test-game', 'bot_delta')).toBe('seawall') // tank
      expect(getBotLane('test-game', 'bot_beta')).toBe('shallows') // support (mid full)
    })

    it('defaults to mid for unknown bot', () => {
      registerBots('test-game', [])
      expect(getBotLane('test-game', 'unknown-bot')).toBe('coldstore')
    })

    it('defaults to mid for unknown game', () => {
      expect(getBotLane('unknown-game', 'bot_alpha')).toBe('coldstore')
    })
  })

  describe('register options (the tutorial path: forceLane + difficulty)', () => {
    beforeEach(() => {
      cleanupGame('test-game')
    })

    const tutorialBots = [
      { playerId: 'bot_ally', team: 'chaff' as const, heroId: 'echo' }, // carry → bot normally
      { playerId: 'bot_enemy0', team: 'audit' as const, heroId: 'kernel' }, // tank → top normally
    ]

    it('forceLane pins every bot to one lane regardless of role', () => {
      registerBots('test-game', tutorialBots, { forceLane: 'coldstore' })
      expect(getBotLane('test-game', 'bot_ally')).toBe('coldstore')
      expect(getBotLane('test-game', 'bot_enemy0')).toBe('coldstore')
    })

    it('applies the chosen difficulty alongside forceLane', () => {
      registerBots('test-game', tutorialBots, { forceLane: 'coldstore', difficulty: 'easy' })
      expect(getBotDifficulty('test-game', 'bot_ally')).toBe('easy')
      expect(getBotDifficulty('test-game', 'bot_enemy0')).toBe('easy')
      expect(getBotLane('test-game', 'bot_ally')).toBe('coldstore')
    })

    it('still accepts a bare difficulty string as the 3rd arg (back-compat)', () => {
      registerBots('test-game', tutorialBots, 'hard')
      expect(getBotDifficulty('test-game', 'bot_ally')).toBe('hard')
      // No forceLane → role-based assignment still runs.
      expect(getBotLane('test-game', 'bot_ally')).toBe('shallows') // carry
    })
  })

  describe('availableLanes (the 3v3 two-lane map path)', () => {
    beforeEach(() => {
      cleanupGame('test-game')
    })

    const twoLaneBots = [
      { playerId: 'bot_carry', team: 'chaff' as const, heroId: 'echo' }, // carry → bot normally
      { playerId: 'bot_tank', team: 'chaff' as const, heroId: 'kernel' }, // tank → top normally
      { playerId: 'bot_support', team: 'audit' as const, heroId: 'sentry' }, // support → mid/bot
    ]

    it('restricts lane assignment to only the provided lanes', () => {
      // Two-lane map: top + mid only, no bot.
      registerBots('test-game', twoLaneBots, { availableLanes: ['seawall', 'coldstore'] })

      // carry would normally go 'shallows' — remapped to its next preferred lane.
      const carryLane = getBotLane('test-game', 'bot_carry')
      expect(['seawall', 'coldstore']).toContain(carryLane)
      const tankLane = getBotLane('test-game', 'bot_tank')
      expect(['seawall', 'coldstore']).toContain(tankLane)
      const supportLane = getBotLane('test-game', 'bot_support')
      expect(['seawall', 'coldstore']).toContain(supportLane)
    })

    it('never assigns a lane outside availableLanes', () => {
      registerBots('test-game', twoLaneBots, { availableLanes: ['seawall', 'coldstore'] })
      for (const bot of twoLaneBots) {
        expect(getBotLane('test-game', bot.playerId)).not.toBe('shallows')
        expect(getBotLane('test-game', bot.playerId)).not.toBe('jungle')
      }
    })

    it('forceLane wins over availableLanes when both are set', () => {
      registerBots('test-game', twoLaneBots, {
        forceLane: 'coldstore',
        availableLanes: ['seawall', 'coldstore'],
      })
      expect(getBotLane('test-game', 'bot_carry')).toBe('coldstore')
      expect(getBotLane('test-game', 'bot_tank')).toBe('coldstore')
      expect(getBotLane('test-game', 'bot_support')).toBe('coldstore')
    })
  })

  describe('convertToBot / isGameBot (AFK takeover)', () => {
    beforeEach(() => {
      cleanupGame('afk-game')
    })

    it('adds a human to the bot roster with a lane + difficulty', () => {
      expect(isGameBot('afk-game', 'human1')).toBe(false)

      const converted = convertToBot('afk-game', 'human1')
      expect(converted).toBe(true)
      expect(isGameBot('afk-game', 'human1')).toBe(true)
      expect(getBotPlayerIds('afk-game')).toContain('human1')
      // Defaults so the GameLoop bot driver can act for the slot.
      expect(getBotLane('afk-game', 'human1')).toBe('coldstore')
      expect(getBotDifficulty('afk-game', 'human1')).toBe('medium')
    })

    it('honours an explicit lane + difficulty', () => {
      convertToBot('afk-game', 'human2', 'seawall', 'hard')
      expect(getBotLane('afk-game', 'human2')).toBe('seawall')
      expect(getBotDifficulty('afk-game', 'human2')).toBe('hard')
    })

    it('is idempotent — only the first conversion returns true', () => {
      expect(convertToBot('afk-game', 'human3')).toBe(true)
      expect(convertToBot('afk-game', 'human3')).toBe(false)
      expect(getBotPlayerIds('afk-game').filter((id) => id === 'human3')).toHaveLength(1)
    })

    it('coexists with real bots already registered for the game', () => {
      registerBots('afk-game', [{ playerId: 'bot_alpha', team: 'chaff', heroId: 'echo' }])
      convertToBot('afk-game', 'human4')
      const ids = getBotPlayerIds('afk-game')
      expect(ids).toContain('bot_alpha')
      expect(ids).toContain('human4')
    })

    it('isGameBot returns false for an unknown game', () => {
      expect(isGameBot('no-such-game', 'human1')).toBe(false)
    })
  })

  describe('cleanupGame', () => {
    it('removes bot tracking for a game', () => {
      const players = [{ playerId: 'bot_alpha', team: 'chaff' as const, heroId: 'echo' }]
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
        { playerId: 'bot_a', team: 'chaff', heroId: 'echo' },
        { playerId: 'bot_b', team: 'audit', heroId: 'cron' },
      ])
      cleanupGame('leak-game')
      expect(spy).toHaveBeenCalledWith('bot_a')
      expect(spy).toHaveBeenCalledWith('bot_b')
      spy.mockRestore()
    })
  })

  describe('difficultyForMmr (production reaches hard/unfair at last)', () => {
    it('maps the MMR bands onto the four difficulties', () => {
      expect(difficultyForMmr(500)).toBe('easy')
      expect(difficultyForMmr(899)).toBe('easy')
      expect(difficultyForMmr(900)).toBe('medium')
      expect(difficultyForMmr(1399)).toBe('medium')
      expect(difficultyForMmr(1400)).toBe('hard')
      expect(difficultyForMmr(1999)).toBe('hard')
      expect(difficultyForMmr(2000)).toBe('unfair')
      expect(difficultyForMmr(4000)).toBe('unfair')
    })

    it('reaches every configured difficulty — none of them is dead config', () => {
      const reachable = new Set(
        [400, 1000, 1600, 2500].map((mmr) => difficultyForMmr(mmr) as string),
      )
      expect(reachable).toEqual(new Set(Object.keys(BOT_DIFFICULTY_CONFIGS)))
    })
  })

  describe('parseBotDifficulty (untrusted launcher input)', () => {
    it('accepts each known difficulty', () => {
      for (const d of Object.keys(BOT_DIFFICULTY_CONFIGS)) {
        expect(parseBotDifficulty(d)).toBe(d)
      }
    })

    it('rejects anything else, so garbage can never reach registerBots', () => {
      for (const raw of ['EASY', 'impossible', '', 0, null, undefined, {}, ['hard']]) {
        expect(parseBotDifficulty(raw)).toBeUndefined()
      }
    })
  })

  describe('difficulty configs', () => {
    const order: BotDifficulty[] = ['easy', 'medium', 'hard', 'unfair']

    it('every combat knob rises monotonically with difficulty', () => {
      const chances = order.map((d) => BOT_DIFFICULTY_CONFIGS[d].abilityComboChance)
      const accuracy = order.map((d) => BOT_DIFFICULTY_CONFIGS[d].lastHitAccuracy)
      expect(chances).toEqual([...chances].sort((a, b) => a - b))
      expect(accuracy).toEqual([...accuracy].sort((a, b) => a - b))
      expect(new Set(chances).size).toBe(order.length)
      expect(new Set(accuracy).size).toBe(order.length)
    })

    it('only easy skips denying', () => {
      expect(BOT_DIFFICULTY_CONFIGS.easy.denyAwareness).toBe(false)
      for (const d of ['medium', 'hard', 'unfair'] as const) {
        expect(BOT_DIFFICULTY_CONFIGS[d].denyAwareness).toBe(true)
      }
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
