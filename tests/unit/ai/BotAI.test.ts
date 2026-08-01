import { describe, it, expect, afterEach } from 'vitest'
import {
  decideBotAction,
  getAbilityTarget,
  isOwnSide,
  sequenceBwCost,
  buildOrderForRole,
  tryUseCombatItem,
  tryPanicDefensiveItem,
  tryPlaceWard,
  shouldRetreatFromThreat,
} from '~~/server/game/ai/BotAI'
import { cleanupBotState } from '~~/server/game/ai/BotAI'
import { registerBots, cleanupGame } from '~~/server/game/ai/BotManager'
import type { BotDifficultyConfig, BotDifficulty } from '~~/server/game/ai/BotManager'
import type { GameState, PlayerState, WaveUnitState } from '~~/shared/types/game'
import type { AbilityDef, AbilityEffect } from '~~/shared/types/hero'
import { HEROES } from '~~/shared/constants/heroes'
import { getItem } from '~~/shared/constants/items'
import { ZONES } from '~~/shared/constants/zones'
import { initializeZoneStates, initializeIce } from '~~/server/game/map/zones'
import { findPath } from '~~/server/game/map/topology'
import { initializeTerminals } from '~~/server/game/engine/TerminalSystem'

/**
 * Build a synthetic ability def for targeting tests. `targetType` is widened to
 * string so we can pass 'ally' even before the shared TargetType union gains it
 * (hero data is edited in parallel) — the bot routes ally casts defensively off
 * this raw field rather than hardcoded hero names.
 */
function makeAbility(
  targetType: string,
  effects: AbilityEffect[],
  overrides: Partial<AbilityDef> = {},
): AbilityDef {
  return {
    id: 'test-ability',
    name: 'Test Ability',
    description: '',
    bwCost: 50,
    cooldownCycles: 4,
    targetType: targetType as AbilityDef['targetType'],
    effects,
    ...overrides,
  }
}

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'bot_alpha',
    name: 'bot_alpha',
    team: 'chaff',
    heroId: 'echo',
    zone: 'coldstore-t1-chaff',
    integ: 500,
    maxInteg: 500,
    bw: 200,
    maxBw: 200,
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
    cycle: 10,
    phase: 'playing',
    teams: {
      chaff: { id: 'chaff', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
      audit: { id: 'audit', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
    },
    players: {},
    zones: initializeZoneStates(),
    waves: [],
    neutrals: [],
    ice: initializeIce(),
    terminals: initializeTerminals(),
    caches: [],
    tenant: { alive: true, integ: 5000, maxInteg: 5000, deathCycle: null },
    backup: null,
    events: [],
    surrenderVotes: { chaff: new Set(), audit: new Set() },
    timeOfDay: 'day',
    dayNightCycle: 0,
    ...overrides,
  }
}

/**
 * Register `botIds` at an explicit difficulty and hand back the game id to pass
 * as decideBotAction's 4th argument. Casting and last-hitting are gated on
 * per-cycle difficulty rolls, so a test about ability/targeting LOGIC has to pin
 * the difficulty rather than inherit the unregistered-game 'medium' default,
 * whose rolls make the outcome depend on the fixture's cycle.
 */
const TUNED_GAME = 'bot-ai-test-tuned'
function atDifficulty(difficulty: BotDifficulty, ...botIds: string[]): string {
  registerBots(
    TUNED_GAME,
    botIds.map((playerId) => ({ playerId, team: 'chaff' as const, heroId: null })),
    difficulty,
  )
  return TUNED_GAME
}
/** `unfair` casts on every combat cycle and never misses a last hit. */
const alwaysCasts = (...botIds: string[]) => atDifficulty('unfair', ...botIds)

afterEach(() => {
  cleanupGame(TUNED_GAME)
  // tryCombo parks a mid-combo cursor keyed by bot id; leaking it makes the NEXT
  // test's first cast the second step of the previous test's rotation.
  cleanupBotState('bot_alpha')
})

describe('BotAI - decideBotAction', () => {
  describe('dead bot', () => {
    it('returns null when bot is dead', () => {
      const bot = makePlayer({ alive: false, integ: 0 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      expect(decideBotAction(state, bot, 'coldstore')).toBeNull()
    })
  })

  describe('fountain behavior', () => {
    it('buys items when at fountain with enough gold', () => {
      const bot = makePlayer({ zone: 'rookery-anchor', scrip: 600 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'coldstore')
      // Defensive consumables are stocked first
      expect(action).toEqual({ type: 'buy', item: 'trauma_patch' })
    })

    it('sources build-item affordability from the canonical shop cost (no hardcoded map)', () => {
      const bladesCost = getItem('edge_kit')!.cost
      const stocked: (string | null)[] = ['trauma_patch', 'recall_token', null, null, null, null]

      // Exactly the real cost → buys the first build item.
      const rich = makePlayer({
        zone: 'rookery-anchor',
        integ: 500,
        maxInteg: 500,
        scrip: bladesCost,
        items: [...stocked] as PlayerState['items'],
      })
      expect(
        decideBotAction(makeGameState({ players: { [rich.id]: rich } }), rich, 'coldstore'),
      ).toEqual({
        type: 'buy',
        item: 'edge_kit',
      })

      // One scrip short → does not buy it (the build order stops, not skips).
      const poor = makePlayer({
        zone: 'rookery-anchor',
        integ: 500,
        maxInteg: 500,
        scrip: bladesCost - 1,
        items: [...stocked] as PlayerState['items'],
      })
      expect(
        decideBotAction(makeGameState({ players: { [poor.id]: poor } }), poor, 'coldstore'),
      ).not.toEqual({ type: 'buy', item: 'edge_kit' })
    })

    describe('role-aware itemisation', () => {
      it('each role build leads with a stat that fits the role', () => {
        const stat = (id: string, k: string) =>
          (getItem(id)!.stats as Record<string, number>)[k] ?? 0
        expect(stat(buildOrderForRole('carry')[0]!, 'attack')).toBeGreaterThan(0)
        expect(stat(buildOrderForRole('assassin')[0]!, 'attack')).toBeGreaterThan(0)
        expect(stat(buildOrderForRole('tank')[0]!, 'integ')).toBeGreaterThan(0)
        expect(stat(buildOrderForRole('offlaner')[0]!, 'integ')).toBeGreaterThan(0)
        expect(stat(buildOrderForRole('mage')[0]!, 'bw')).toBeGreaterThan(0)
        expect(stat(buildOrderForRole('support')[0]!, 'bw')).toBeGreaterThan(0)
      })

      it('falls back to the shared core build for an unknown role', () => {
        expect(buildOrderForRole(undefined)[0]).toBe('edge_kit')
      })

      it('every role-build item exists and grants an engine-consumed stat', () => {
        const STAT_KEYS = ['integ', 'bw', 'attack', 'plate', 'ice']
        const roles = ['carry', 'assassin', 'tank', 'offlaner', 'mage', 'support'] as const
        for (const role of roles) {
          for (const id of buildOrderForRole(role)) {
            const item = getItem(id)
            expect(item, `${role} build item ${id} should exist`).toBeDefined()
            const s = item!.stats as Record<string, number>
            expect(
              STAT_KEYS.some((k) => (s[k] ?? 0) > 0),
              `${id} should grant a real stat`,
            ).toBe(true)
          }
        }
      })

      it('a tank bot itemises toward INTEG (clot_ring, not edge_kit)', () => {
        const stocked: (string | null)[] = ['trauma_patch', 'recall_token', null, null, null, null]
        const tank = makePlayer({
          heroId: 'kernel', // role: tank
          zone: 'rookery-anchor',
          integ: 500,
          maxInteg: 500,
          scrip: getItem('clot_ring')!.cost,
          items: [...stocked] as PlayerState['items'],
        })
        expect(
          decideBotAction(makeGameState({ players: { [tank.id]: tank } }), tank, 'coldstore'),
        ).toEqual({ type: 'buy', item: 'clot_ring' })
      })
    })

    it('stays at fountain to heal when INTEG is low', () => {
      const bot = makePlayer({ zone: 'rookery-anchor', integ: 100, maxInteg: 500, scrip: 0 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'coldstore')
      expect(action).toBeNull()
    })

    it('moves to lane when at fountain with full INTEG and nothing to buy', () => {
      const bot = makePlayer({
        zone: 'rookery-anchor',
        integ: 500,
        maxInteg: 500,
        scrip: 0,
        items: [
          'bulk_lattice',
          'null_pointer',
          'garbage_collector',
          'jump_shunt',
          'stack_overflow',
          'segfault_blade',
        ],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'coldstore')
      expect(action).toEqual({ type: 'move', zone: 'rookery-terminal' })
    })
  })

  describe('retreat behavior', () => {
    it('retreats to fountain when INTEG is below 25%', () => {
      const bot = makePlayer({ zone: 'coldstore-t1-chaff', integ: 100, maxInteg: 500 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'coldstore')
      expect(action).not.toBeNull()
      expect(action!.type).toBe('move')
      if (action!.type === 'move') {
        expect(action!.zone).toBe('coldstore-t2-chaff')
      }
    })

    it('does not retreat when INTEG is above retreat threshold', () => {
      const bot = makePlayer({ zone: 'coldstore-t1-chaff', integ: 180, maxInteg: 500 }) // 36% INTEG
      const allyWave = {
        id: 'c1',
        team: 'chaff' as const,
        zone: 'coldstore-t1-chaff',
        integ: 300,
        type: 'line' as const,
      }
      const state = makeGameState({ players: { [bot.id]: bot }, waves: [allyWave] })
      const action = decideBotAction(state, bot, 'coldstore')
      // 180/500 = 36% => above 30% retreat threshold, advances with wave support
      expect(action).not.toBeNull()
      expect(action!.type).toBe('move')
      // Should advance along lane (forward), not retreat (backward toward base)
      if (action!.type === 'move') {
        expect(action!.zone).toBe('coldstore-cross') // forward, not coldstore-t2-chaff (backward)
      }
    })

    it('holds position at the frontier without wave support', () => {
      const bot = makePlayer({ zone: 'coldstore-t1-chaff', integ: 400, maxInteg: 500 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      // Next zone is coldstore-cross (neutral territory) and no allied waves — wait
      expect(decideBotAction(state, bot, 'coldstore')).toBeNull()
    })

    it('blinks out of a slow when retreating with a Jump Shunt ready', () => {
      // A slowed retreat-move has up to an 80% chance to fizzle, leaving the bot
      // to die. Blink ignores the slow, so it should escape with the item instead.
      const bot = makePlayer({
        zone: 'coldstore-t1-chaff',
        integ: 100,
        maxInteg: 500,
        items: ['jump_shunt', null, null, null, null, null],
        buffs: [{ id: 'slow', stacks: 40, cyclesRemaining: 2, source: 'enemy1' }],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'coldstore')
      expect(action).toEqual({ type: 'use', item: 'jump_shunt', target: 'coldstore-t2-chaff' })
    })

    it('walks (saving the Blink) when retreating unimpaired', () => {
      // No slow/root — a normal move is free and certain, so don't waste the
      // 12-cycle Blink cooldown.
      const bot = makePlayer({
        zone: 'coldstore-t1-chaff',
        integ: 100,
        maxInteg: 500,
        items: ['jump_shunt', null, null, null, null, null],
        buffs: [],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'coldstore')
      expect(action).toEqual({ type: 'move', zone: 'coldstore-t2-chaff' })
    })

    it('uses Shove Splice to escape a slow when it has no Blink', () => {
      // Shove Splice auto-disengages toward our fountain — a second escape tool
      // that, like Blink, ignores the slow. No target needed (it aims home).
      const bot = makePlayer({
        zone: 'coldstore-t1-chaff',
        integ: 100,
        maxInteg: 500,
        items: ['shove_splice', null, null, null, null, null],
        buffs: [{ id: 'slow', stacks: 40, cyclesRemaining: 2, source: 'enemy1' }],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'coldstore')
      expect(action).toEqual({ type: 'use', item: 'shove_splice' })
    })

    it('prefers Blink over Shove Splice when holding both (exact retreat zone)', () => {
      const bot = makePlayer({
        zone: 'coldstore-t1-chaff',
        integ: 100,
        maxInteg: 500,
        items: ['jump_shunt', 'shove_splice', null, null, null, null],
        buffs: [{ id: 'slow', stacks: 40, cyclesRemaining: 2, source: 'enemy1' }],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'coldstore')
      expect(action).toEqual({ type: 'use', item: 'jump_shunt', target: 'coldstore-t2-chaff' })
    })
  })

  describe('combat - hero targeting', () => {
    it('attacks enemy hero in same zone', () => {
      const bot = makePlayer({
        zone: 'coldstore-cross',
        integ: 400,
        maxInteg: 500,
        bw: 0,
        cooldowns: { q: 1, w: 1, e: 1, r: 1 },
      })
      const enemy = makePlayer({
        id: 'enemy1',
        team: 'audit',
        zone: 'coldstore-cross',
        integ: 300,
        maxInteg: 500,
      })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'coldstore')
      expect(action).toEqual({ type: 'attack', target: { kind: 'hero', name: 'enemy1' } })
    })

    it('targets lowest INTEG enemy hero', () => {
      const bot = makePlayer({
        zone: 'coldstore-cross',
        integ: 400,
        maxInteg: 500,
        bw: 0,
        cooldowns: { q: 1, w: 1, e: 1, r: 1 },
      })
      const enemy1 = makePlayer({
        id: 'enemy1',
        team: 'audit',
        zone: 'coldstore-cross',
        integ: 300,
      })
      const enemy2 = makePlayer({
        id: 'enemy2',
        team: 'audit',
        zone: 'coldstore-cross',
        integ: 100,
      })
      const state = makeGameState({
        players: { [bot.id]: bot, enemy1, enemy2 },
      })
      const action = decideBotAction(state, bot, 'coldstore')
      expect(action).not.toBeNull()
      if (action!.type === 'attack') {
        expect(action!.target).toEqual({ kind: 'hero', name: 'enemy2' })
      }
    })

    it('does not attack dead enemy heroes', () => {
      const bot = makePlayer({ zone: 'coldstore-cross', integ: 400, maxInteg: 500, bw: 0 })
      const deadEnemy = makePlayer({
        id: 'enemy1',
        team: 'audit',
        zone: 'coldstore-cross',
        integ: 0,
        alive: false,
      })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: deadEnemy } })
      const action = decideBotAction(state, bot, 'coldstore')
      // Should not target the dead enemy (may hold position or move)
      expect(action?.type ?? 'hold').not.toBe('attack')
    })
  })

  describe('combat - ability usage', () => {
    it('casts ability when enemy is present and ability is off cooldown', () => {
      const bot = makePlayer({ zone: 'coldstore-cross', integ: 400, maxInteg: 500, bw: 300 })
      const enemy = makePlayer({
        id: 'enemy1',
        team: 'audit',
        zone: 'coldstore-cross',
        integ: 300,
      })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'coldstore', alwaysCasts(bot.id))
      // Should try to cast (r first in priority order)
      expect(action).not.toBeNull()
      expect(action!.type).toBe('cast')
    })

    it('does not cast when on cooldown', () => {
      const bot = makePlayer({
        zone: 'coldstore-cross',
        integ: 400,
        maxInteg: 500,
        bw: 300,
        cooldowns: { q: 5, w: 5, e: 5, r: 5 },
      })
      const enemy = makePlayer({
        id: 'enemy1',
        team: 'audit',
        zone: 'coldstore-cross',
        integ: 300,
      })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'coldstore')
      // All abilities on cooldown, should attack instead
      expect(action).toEqual({ type: 'attack', target: { kind: 'hero', name: 'enemy1' } })
    })

    it('does not cast when not enough BW', () => {
      const bot = makePlayer({
        zone: 'coldstore-cross',
        integ: 400,
        maxInteg: 500,
        bw: 0,
        maxBw: 200,
        cooldowns: { q: 0, w: 0, e: 1, r: 0 }, // E costs 0 mana, so put it on CD
      })
      const enemy = makePlayer({
        id: 'enemy1',
        team: 'audit',
        zone: 'coldstore-cross',
        integ: 300,
      })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'coldstore')
      // No BW, should attack
      expect(action).toEqual({ type: 'attack', target: { kind: 'hero', name: 'enemy1' } })
    })

    it('does not cast an ability it can only afford at rank 1', () => {
      // Echo Q costs 40 at rank 1 and 70 at rank 4 (level 7). A bot holding 55
      // mana used to read the registry's rank-1 headline, queue the cast, and
      // have the resolver refuse it for insufficient BW — one wasted cycle per
      // cycle, for the rest of the game. W/E/R are parked so Q is the only
      // candidate and the outcome is unambiguous.
      const bot = makePlayer({
        heroId: 'echo',
        level: 7,
        zone: 'coldstore-cross',
        integ: 400,
        maxInteg: 500,
        bw: 55,
        maxBw: 300,
        cooldowns: { q: 0, w: 5, e: 5, r: 5 },
      })
      const enemy = makePlayer({ id: 'enemy1', team: 'audit', zone: 'coldstore-cross', integ: 300 })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'coldstore', alwaysCasts(bot.id))
      expect(action).toEqual({ type: 'attack', target: { kind: 'hero', name: 'enemy1' } })
    })

    it('casts once it holds the rank cost', () => {
      const bot = makePlayer({
        heroId: 'echo',
        level: 7,
        zone: 'coldstore-cross',
        integ: 400,
        maxInteg: 500,
        bw: 70,
        maxBw: 300,
        cooldowns: { q: 0, w: 5, e: 5, r: 5 },
      })
      const enemy = makePlayer({ id: 'enemy1', team: 'audit', zone: 'coldstore-cross', integ: 300 })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'coldstore', alwaysCasts(bot.id))
      expect(action).toMatchObject({ type: 'cast', ability: 'q' })
    })

    it('holds Cache Eviction (R) at low stored energy, casting a non-ult instead', () => {
      // Cache's R deals black damage EQUAL to stored energy; at ~0 energy it's a
      // 50-cycle cooldown spent on a lone slow. The bot must NOT open the fight
      // with R — it should cast a non-energy ability (Q) and build energy first.
      const bot = makePlayer({
        heroId: 'cache',
        level: 6,
        zone: 'coldstore-cross',
        integ: 400,
        maxInteg: 500,
        bw: 300,
        maxBw: 300,
        // W/E parked so the scripted combo can't open — this test is about the
        // generic cast-priority path, which is where the resource guard lives.
        cooldowns: { q: 0, w: 5, e: 5, r: 0 },
        buffs: [{ id: 'cachedEnergy', stacks: 10, cyclesRemaining: 9999, source: 'bot_alpha' }],
      })
      const enemy = makePlayer({ id: 'enemy1', team: 'audit', zone: 'coldstore-cross', integ: 300 })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'coldstore', alwaysCasts(bot.id))
      expect(action?.type).toBe('cast')
      expect((action as { ability: string }).ability).not.toBe('r')
    })

    it('fires Cache Eviction (R) once stored energy is worth bursting', () => {
      const bot = makePlayer({
        heroId: 'cache',
        level: 6,
        zone: 'coldstore-cross',
        integ: 400,
        maxInteg: 500,
        bw: 300,
        maxBw: 300,
        cooldowns: { q: 0, w: 5, e: 5, r: 0 },
        buffs: [{ id: 'cachedEnergy', stacks: 120, cyclesRemaining: 9999, source: 'bot_alpha' }],
      })
      const enemy = makePlayer({ id: 'enemy1', team: 'audit', zone: 'coldstore-cross', integ: 300 })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'coldstore', alwaysCasts(bot.id))
      expect(action).toMatchObject({ type: 'cast', ability: 'r' })
    })

    it('does not burn the cycle on Echo Feedback Loop (E) at 0 stacks (resolver would reject it)', () => {
      // Echo's E hard-fails at 0 feedback stacks. With Q/W/R on cooldown, the
      // unguarded bot would submit E anyway and waste its action on a guaranteed
      // rejection — it should attack to BUILD stacks instead.
      const bot = makePlayer({
        heroId: 'echo',
        level: 6,
        zone: 'coldstore-cross',
        integ: 400,
        maxInteg: 500,
        bw: 300,
        maxBw: 300,
        cooldowns: { q: 5, w: 5, e: 0, r: 5 }, // only E is off cooldown
        buffs: [], // 0 feedback stacks → E would be rejected
      })
      const enemy = makePlayer({ id: 'enemy1', team: 'audit', zone: 'coldstore-cross', integ: 300 })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'coldstore')
      expect(action).toEqual({ type: 'attack', target: { kind: 'hero', name: 'enemy1' } })
    })

    it('casts Echo Feedback Loop (E) once stacks are built', () => {
      const bot = makePlayer({
        heroId: 'echo',
        level: 6,
        zone: 'coldstore-cross',
        integ: 400,
        maxInteg: 500,
        bw: 300,
        maxBw: 300,
        cooldowns: { q: 5, w: 5, e: 0, r: 5 },
        buffs: [{ id: 'feedbackLoop', stacks: 40, cyclesRemaining: 9999, source: 'bot_alpha' }],
      })
      const enemy = makePlayer({ id: 'enemy1', team: 'audit', zone: 'coldstore-cross', integ: 300 })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'coldstore', alwaysCasts(bot.id))
      expect(action).toMatchObject({ type: 'cast', ability: 'e' })
    })
  })

  describe('combat - wave targeting', () => {
    it('aims at the lowest-INTEG enemy wave when the last-hit roll lands', () => {
      const bot = makePlayer({ zone: 'coldstore-t1-chaff', integ: 400, maxInteg: 500, bw: 0 })
      const waves: WaveUnitState[] = [
        { id: 'wave-1', team: 'audit', zone: 'coldstore-t1-chaff', integ: 200, type: 'line' },
        { id: 'wave-2', team: 'audit', zone: 'coldstore-t1-chaff', integ: 50, type: 'sweep' },
      ]
      const state = makeGameState({ players: { [bot.id]: bot }, waves })
      // `unfair` is lastHitAccuracy 1.0 — the roll can never fail.
      const action = decideBotAction(state, bot, 'coldstore', atDifficulty('unfair', bot.id))
      expect(action).toEqual({ type: 'attack', target: { kind: 'wave', index: 1 } })
    })

    it('a missed last hit re-aims at the SECOND-lowest wave — never at nothing', () => {
      // The miss must cost the scrip, not the cycle. Returning null on a failed
      // roll was the original standstill bug: bots stopped out-clearing the
      // incoming wave and never reached a ice (see BotForwardProgress).
      // Tick 30's lasthit roll is 0.91, above every accuracy below `unfair`.
      const bot = makePlayer({ zone: 'coldstore-t1-chaff', integ: 400, maxInteg: 500, bw: 0 })
      const waves: WaveUnitState[] = [
        { id: 'wave-1', team: 'audit', zone: 'coldstore-t1-chaff', integ: 200, type: 'line' },
        { id: 'wave-2', team: 'audit', zone: 'coldstore-t1-chaff', integ: 50, type: 'sweep' },
        { id: 'wave-3', team: 'audit', zone: 'coldstore-t1-chaff', integ: 120, type: 'line' },
      ]
      const state = makeGameState({ cycle: 30, players: { [bot.id]: bot }, waves })
      expect(decideBotAction(state, bot, 'coldstore', atDifficulty('medium', bot.id))).toEqual({
        type: 'attack',
        target: { kind: 'wave', index: 2 },
      })
      // Same cycle, perfect accuracy → the true lowest.
      expect(decideBotAction(state, bot, 'coldstore', atDifficulty('unfair', bot.id))).toEqual({
        type: 'attack',
        target: { kind: 'wave', index: 1 },
      })
    })

    it('still swings at a lone wave on a missed roll (no second-lowest to fall back to)', () => {
      const bot = makePlayer({ zone: 'coldstore-t1-chaff', integ: 400, maxInteg: 500, bw: 0 })
      const waves: WaveUnitState[] = [
        { id: 'wave-1', team: 'audit', zone: 'coldstore-t1-chaff', integ: 200, type: 'line' },
      ]
      const state = makeGameState({ cycle: 30, players: { [bot.id]: bot }, waves })
      expect(decideBotAction(state, bot, 'coldstore', atDifficulty('easy', bot.id))).toEqual({
        type: 'attack',
        target: { kind: 'wave', index: 0 },
      })
    })

    it('ignores friendly waves', () => {
      const bot = makePlayer({ zone: 'coldstore-t1-chaff', integ: 400, maxInteg: 500, bw: 0 })
      const waves: WaveUnitState[] = [
        { id: 'wave-1', team: 'chaff', zone: 'coldstore-t1-chaff', integ: 100, type: 'line' },
      ]
      const state = makeGameState({ players: { [bot.id]: bot }, waves })
      const action = decideBotAction(state, bot, 'coldstore')
      // No enemies, should move forward
      expect(action!.type).toBe('move')
    })

    it('attacks the wave even when it cannot secure the last hit', () => {
      // A high-HP enemy wave (no guaranteed last hit) must still draw an
      // attack — the old code returned null on a failed last-hit roll, leaving
      // bots idling in lane instead of pushing the wave.
      const bot = makePlayer({ zone: 'coldstore-t1-chaff', integ: 400, maxInteg: 500, bw: 0 })
      const waves: WaveUnitState[] = [
        { id: 'wave-1', team: 'audit', zone: 'coldstore-t1-chaff', integ: 200, type: 'line' },
      ]
      const state = makeGameState({ players: { [bot.id]: bot }, waves })
      const action = decideBotAction(state, bot, 'coldstore')
      expect(action).toEqual({ type: 'attack', target: { kind: 'wave', index: 0 } })
    })
  })

  describe('ice targeting', () => {
    it('attacks enemy ice when allied waves are present', () => {
      const bot = makePlayer({ zone: 'coldstore-t1-audit', integ: 400, maxInteg: 500, bw: 0 })
      const alliedWaves: WaveUnitState[] = [
        { id: 'wave-1', team: 'chaff', zone: 'coldstore-t1-audit', integ: 400, type: 'line' },
      ]
      const state = makeGameState({
        players: { [bot.id]: bot },
        waves: alliedWaves,
      })
      const action = decideBotAction(state, bot, 'coldstore')
      expect(action).not.toBeNull()
      expect(action!.type).toBe('attack')
      if (action!.type === 'attack') {
        expect(action!.target).toEqual({ kind: 'ice', zone: 'coldstore-t1-audit' })
      }
    })

    it('does not attack ice without allied waves', () => {
      const bot = makePlayer({ zone: 'coldstore-t1-audit', integ: 400, maxInteg: 500, bw: 0 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'coldstore')
      // No allied waves -> holds position (deep in enemy territory, no support)
      expect(action?.type ?? 'hold').not.toBe('attack')
    })
  })

  describe('movement - lane pathing', () => {
    it('moves forward along assigned lane with wave support', () => {
      const bot = makePlayer({ zone: 'coldstore-t1-chaff', integ: 400, maxInteg: 500, bw: 0 })
      const allyWave = {
        id: 'c1',
        team: 'chaff' as const,
        zone: 'coldstore-t1-chaff',
        integ: 300,
        type: 'line' as const,
      }
      const state = makeGameState({ players: { [bot.id]: bot }, waves: [allyWave] })
      const action = decideBotAction(state, bot, 'coldstore')
      expect(action).toEqual({ type: 'move', zone: 'coldstore-cross' })
    })

    it('advances freely on its own side of the map', () => {
      const bot = makePlayer({ zone: 'coldstore-t3-chaff', integ: 400, maxInteg: 500, bw: 0 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'coldstore')
      expect(action).toEqual({ type: 'move', zone: 'coldstore-t2-chaff' })
    })

    it('advances across the frontier to join a wave waiting one zone ahead', () => {
      // Frontier bot (own t1) with an allied wave in the NEXT zone (the river)
      // but none co-located. The old standstill only checked the bot's CURRENT
      // zone for wave support, so it froze here; forward progress now follows
      // the wave ahead so the bot pushes out of its own half.
      const bot = makePlayer({ zone: 'coldstore-t1-chaff', integ: 400, maxInteg: 500, bw: 0 })
      const waves: WaveUnitState[] = [
        { id: 'wave-1', team: 'chaff', zone: 'coldstore-cross', integ: 300, type: 'line' },
      ]
      const state = makeGameState({ players: { [bot.id]: bot }, waves })
      const action = decideBotAction(state, bot, 'coldstore')
      expect(action).toEqual({ type: 'move', zone: 'coldstore-cross' })
    })

    it('moves toward lane start when off-lane', () => {
      const bot = makePlayer({ zone: 'silt-chaff-upper', integ: 400, maxInteg: 500, bw: 0 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'coldstore')
      // Should pathfind toward coldstore-t3-chaff (the first lane zone after fountain/base)
      expect(action).not.toBeNull()
      expect(action!.type).toBe('move')
    })
  })

  describe('shopping', () => {
    it('stocks defensive consumables before core items', () => {
      const bot = makePlayer({ zone: 'rookery-anchor', scrip: 600 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      expect(decideBotAction(state, bot, 'coldstore')).toEqual({
        type: 'buy',
        item: 'trauma_patch',
      })

      const withSalve = makePlayer({
        zone: 'rookery-anchor',
        scrip: 450,
        items: ['trauma_patch', null, null, null, null, null],
      })
      const state2 = makeGameState({ players: { [withSalve.id]: withSalve } })
      expect(decideBotAction(state2, withSalve, 'coldstore')).toEqual({
        type: 'buy',
        item: 'recall_token',
      })
    })

    it('buys first item in build order once consumables are stocked', () => {
      const bot = makePlayer({
        zone: 'rookery-anchor',
        scrip: 600,
        items: ['trauma_patch', 'recall_token', null, null, null, null],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'coldstore')
      // edge_kit: +12 attack — a stat the engine actually consumes
      expect(action).toEqual({ type: 'buy', item: 'edge_kit' })
    })

    it('skips items already owned', () => {
      const bot = makePlayer({
        zone: 'rookery-anchor',
        scrip: 1500,
        items: ['trauma_patch', 'recall_token', 'edge_kit', null, null, null],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'coldstore')
      expect(action).toEqual({ type: 'buy', item: 'null_pointer' })
    })

    it('does not buy when inventory is full', () => {
      const bot = makePlayer({
        zone: 'rookery-anchor',
        scrip: 10000,
        items: [
          'bulk_lattice',
          'null_pointer',
          'garbage_collector',
          'jump_shunt',
          'stack_overflow',
          'segfault_blade',
        ],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'coldstore')
      // Can't buy, inventory full, should move to lane
      expect(action).toEqual({ type: 'move', zone: 'rookery-terminal' })
    })

    it('does not buy when scrip is insufficient', () => {
      const bot = makePlayer({ zone: 'rookery-anchor', scrip: 20 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'coldstore')
      // Can't afford anything (cheapest consumable is 50sc), integ is full so should move to lane
      expect(action).toEqual({ type: 'move', zone: 'rookery-terminal' })
    })
  })

  describe('talent selection', () => {
    it('banks an unlocked talent during a lull (no enemy hero in zone)', () => {
      // coldstore-t1-chaff lane, level 10, no talents, full INTEG, no enemies → pick tier 10.
      const bot = makePlayer({ zone: 'coldstore-t1-chaff', level: 10 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'coldstore')
      expect(action).toEqual({ type: 'select_talent', tier: 10, talentId: 'echo_10_left' })
    })

    it('does not pick a talent before reaching the tier', () => {
      const bot = makePlayer({ zone: 'coldstore-t1-chaff', level: 9 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'coldstore')
      expect(action?.type).not.toBe('select_talent')
    })

    it('advances to the next unchosen tier', () => {
      const bot = makePlayer({
        zone: 'coldstore-t1-chaff',
        level: 16,
        talents: { tier10: 'echo_10_left', tier15: null, tier20: null, tier25: null },
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'coldstore')
      expect(action).toMatchObject({ type: 'select_talent', tier: 15 })
    })

    it('fights instead of picking a talent when an enemy hero is in zone', () => {
      const bot = makePlayer({
        zone: 'coldstore-cross',
        level: 10,
        integ: 500,
        maxInteg: 500,
        bw: 300,
      })
      const enemy = makePlayer({ id: 'enemy1', team: 'audit', zone: 'coldstore-cross', integ: 300 })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'coldstore')
      expect(action?.type).not.toBe('select_talent')
    })
  })

  describe('priority ordering', () => {
    it('prioritizes retreat over combat when INTEG < 25%', () => {
      const bot = makePlayer({ zone: 'coldstore-cross', integ: 50, maxInteg: 500, bw: 300 })
      const enemy = makePlayer({
        id: 'enemy1',
        team: 'audit',
        zone: 'coldstore-cross',
        integ: 300,
      })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'coldstore')
      // Should retreat despite enemy presence
      expect(action!.type).toBe('move')
    })

    it('prioritizes abilities over basic attack', () => {
      const bot = makePlayer({ zone: 'coldstore-cross', integ: 400, maxInteg: 500, bw: 300 })
      const enemy = makePlayer({
        id: 'enemy1',
        team: 'audit',
        zone: 'coldstore-cross',
        integ: 300,
      })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'coldstore', alwaysCasts(bot.id))
      expect(action!.type).toBe('cast')
    })

    it('prioritizes hero attacks over wave attacks', () => {
      const bot = makePlayer({
        zone: 'coldstore-cross',
        integ: 400,
        maxInteg: 500,
        bw: 0,
        cooldowns: { q: 1, w: 1, e: 1, r: 1 },
      })
      const enemy = makePlayer({
        id: 'enemy1',
        team: 'audit',
        zone: 'coldstore-cross',
        integ: 300,
      })
      const waves: WaveUnitState[] = [
        { id: 'wave-1', team: 'audit', zone: 'coldstore-cross', integ: 100, type: 'line' },
      ]
      const state = makeGameState({
        players: { [bot.id]: bot, enemy1: enemy },
        waves,
      })
      const action = decideBotAction(state, bot, 'coldstore')
      expect(action).toEqual({ type: 'attack', target: { kind: 'hero', name: 'enemy1' } })
    })
  })

  describe('cache pickup', () => {
    it('issues a cache command when standing on a cache (not a wasted Q cast)', () => {
      const bot = makePlayer({
        zone: 'cache-seawall',
        integ: 500,
        maxInteg: 500,
        bw: 300,
        cooldowns: { q: 0, w: 0, e: 0, r: 0 },
      })
      const state = makeGameState({
        players: { [bot.id]: bot },
        caches: [{ zone: 'cache-seawall', type: 'haste', cycle: 5 }],
      })
      const action = decideBotAction(state, bot, 'coldstore')
      expect(action).toEqual({ type: 'grab' })
    })
  })

  describe('support ability targeting', () => {
    it('heals the most-hurt ally instead of the lowest-INTEG enemy', () => {
      const bot = makePlayer({
        id: 'bot_alpha',
        heroId: 'sentry',
        zone: 'coldstore-cross',
        integ: 600,
        maxInteg: 600,
        bw: 100,
        maxBw: 350,
        cooldowns: { q: 0, w: 5, e: 5, r: 5 },
      })
      const ally = makePlayer({
        id: 'bot_ally',
        team: 'chaff',
        zone: 'coldstore-cross',
        integ: 150,
        maxInteg: 600,
      })
      const enemy = makePlayer({
        id: 'enemy1',
        team: 'audit',
        zone: 'coldstore-cross',
        integ: 100, // lowest INTEG overall — the old code would heal-target this enemy
        maxInteg: 500,
      })
      const state = makeGameState({
        players: { [bot.id]: bot, bot_ally: ally, enemy1: enemy },
      })
      const action = decideBotAction(state, bot, 'coldstore', alwaysCasts(bot.id))
      expect(action).toEqual({
        type: 'cast',
        ability: 'q',
        target: { kind: 'hero', name: 'bot_ally' },
      })
    })

    it('heals itself when hurt and no ally needs it more', () => {
      const bot = makePlayer({
        id: 'bot_alpha',
        heroId: 'sentry',
        zone: 'coldstore-cross',
        integ: 300,
        maxInteg: 600,
        bw: 100,
        maxBw: 350,
        cooldowns: { q: 0, w: 5, e: 5, r: 5 },
      })
      const enemy = makePlayer({
        id: 'enemy1',
        team: 'audit',
        zone: 'coldstore-cross',
        integ: 100,
        maxInteg: 500,
      })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'coldstore', alwaysCasts(bot.id))
      expect(action).toEqual({
        type: 'cast',
        ability: 'q',
        target: { kind: 'hero', name: 'bot_alpha' },
      })
    })

    it('does not waste heals when the team is healthy — attacks instead', () => {
      const bot = makePlayer({
        id: 'bot_alpha',
        heroId: 'sentry',
        zone: 'coldstore-cross',
        integ: 600,
        maxInteg: 600,
        bw: 100,
        maxBw: 350,
        cooldowns: { q: 0, w: 5, e: 5, r: 5 },
      })
      const enemy = makePlayer({
        id: 'enemy1',
        team: 'audit',
        zone: 'coldstore-cross',
        integ: 100,
        maxInteg: 500,
      })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'coldstore')
      expect(action).toEqual({ type: 'attack', target: { kind: 'hero', name: 'enemy1' } })
    })

    it('still targets the lowest-INTEG enemy with damage abilities', () => {
      const bot = makePlayer({
        heroId: 'echo',
        zone: 'coldstore-cross',
        integ: 400,
        maxInteg: 500,
        bw: 300,
        cooldowns: { q: 0, w: 5, e: 5, r: 5 },
      })
      const ally = makePlayer({
        id: 'bot_ally',
        team: 'chaff',
        zone: 'coldstore-cross',
        integ: 50,
        maxInteg: 500,
      })
      const enemy1 = makePlayer({
        id: 'enemy1',
        team: 'audit',
        zone: 'coldstore-cross',
        integ: 300,
      })
      const enemy2 = makePlayer({
        id: 'enemy2',
        team: 'audit',
        zone: 'coldstore-cross',
        integ: 100,
      })
      const state = makeGameState({
        players: { [bot.id]: bot, bot_ally: ally, enemy1, enemy2 },
      })
      const action = decideBotAction(state, bot, 'coldstore', alwaysCasts(bot.id))
      expect(action).toEqual({
        type: 'cast',
        ability: 'q',
        target: { kind: 'hero', name: 'enemy2' },
      })
    })
  })

  describe('defensive consumables', () => {
    it('pops a healing salve when hurt and out of combat', () => {
      const bot = makePlayer({
        zone: 'coldstore-t1-chaff',
        integ: 250,
        maxInteg: 500,
        items: ['trauma_patch', null, null, null, null, null],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'coldstore')
      expect(action).toEqual({ type: 'use', item: 'trauma_patch' })
    })

    it('does not re-pop a salve while regen is already active', () => {
      const bot = makePlayer({
        zone: 'coldstore-t1-chaff',
        integ: 250,
        maxInteg: 500,
        items: ['trauma_patch', null, null, null, null, null],
        buffs: [
          { id: 'trauma_patch_regen', stacks: 50, cyclesRemaining: 3, source: 'trauma_patch' },
        ],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'coldstore')
      expect(action?.type).not.toBe('use')
    })

    it('does not pop a salve while enemies are in the zone', () => {
      const bot = makePlayer({
        zone: 'coldstore-cross',
        integ: 250,
        maxInteg: 500,
        items: ['trauma_patch', null, null, null, null, null],
      })
      const enemy = makePlayer({ id: 'enemy1', team: 'audit', zone: 'coldstore-cross', integ: 400 })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'coldstore')
      expect(action?.type).not.toBe('use')
    })

    it('teleports home when retreating from deep map positions', () => {
      const bot = makePlayer({
        zone: 'coldstore-t1-audit',
        integ: 100,
        maxInteg: 500,
        items: ['recall_token', null, null, null, null, null],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'coldstore')
      expect(action).toEqual({ type: 'use', item: 'recall_token' })
    })

    it('walks home instead of TPing when already near the fountain', () => {
      const bot = makePlayer({
        zone: 'coldstore-t3-chaff',
        integ: 100,
        maxInteg: 500,
        items: ['recall_token', null, null, null, null, null],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'coldstore')
      expect(action).toEqual({ type: 'move', zone: 'rookery-terminal' })
    })

    it('stands still while channeling a teleport', () => {
      const bot = makePlayer({
        zone: 'coldstore-t1-chaff',
        integ: 100,
        maxInteg: 500,
        buffs: [{ id: 'tp_channeling', stacks: 1, cyclesRemaining: 2, source: 'recall_token' }],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      expect(decideBotAction(state, bot, 'coldstore')).toBeNull()
    })
  })

  describe('terminal push', () => {
    it('attacks the enemy terminal when in the enemy base and it is vulnerable', () => {
      const bot = makePlayer({
        zone: 'landing-terminal',
        integ: 400,
        maxInteg: 500,
        bw: 0,
        cooldowns: { q: 1, w: 1, e: 1, r: 1 },
      })
      const terminals = initializeTerminals()
      const state = makeGameState({
        players: { [bot.id]: bot },
        terminals: { ...terminals, audit: { ...terminals.audit, vulnerable: true } },
      })
      const action = decideBotAction(state, bot, 'coldstore')
      expect(action).toEqual({ type: 'attack', target: { kind: 'terminal' } })
    })

    it('does not attack the terminal while it is invulnerable', () => {
      const bot = makePlayer({
        zone: 'landing-terminal',
        integ: 400,
        maxInteg: 500,
        bw: 0,
        cooldowns: { q: 1, w: 1, e: 1, r: 1 },
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'coldstore')
      expect(action).not.toEqual({ type: 'attack', target: { kind: 'terminal' } })
    })

    it('fights defending heroes before the terminal', () => {
      const bot = makePlayer({
        zone: 'landing-terminal',
        integ: 400,
        maxInteg: 500,
        bw: 0,
        cooldowns: { q: 1, w: 1, e: 1, r: 1 },
      })
      const defender = makePlayer({
        id: 'enemy1',
        team: 'audit',
        zone: 'landing-terminal',
        integ: 300,
      })
      const terminals = initializeTerminals()
      const state = makeGameState({
        players: { [bot.id]: bot, enemy1: defender },
        terminals: { ...terminals, audit: { ...terminals.audit, vulnerable: true } },
      })
      const action = decideBotAction(state, bot, 'coldstore')
      expect(action).toEqual({ type: 'attack', target: { kind: 'hero', name: 'enemy1' } })
    })
  })

  describe('rank-0 abilities (not yet learned)', () => {
    it('never casts the ultimate before level 6', () => {
      // Level 1: R is rank 0 (unlocks at 6). With Q/W/E on cooldown the only
      // ability the bot could "afford" is R — but the server rejects an
      // un-unlocked cast, burning the cycle. The bot must fall through to a
      // basic attack instead of emitting a cast for R.
      const bot = makePlayer({
        zone: 'coldstore-cross',
        level: 1,
        integ: 400,
        maxInteg: 500,
        bw: 500,
        maxBw: 500,
        cooldowns: { q: 5, w: 5, e: 5, r: 0 },
      })
      const enemy = makePlayer({ id: 'enemy1', team: 'audit', zone: 'coldstore-cross', integ: 300 })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'coldstore')
      expect(action).toEqual({ type: 'attack', target: { kind: 'hero', name: 'enemy1' } })
    })

    it('casts the ultimate once it is learned at level 6', () => {
      // Sanity counterpart: at level 6 R is rank 1, so the bot is free to use
      // it. Proves the level-1 case above is the rank gate, not a blanket
      // "never cast R".
      const bot = makePlayer({
        zone: 'coldstore-cross',
        level: 6,
        integ: 400,
        maxInteg: 500,
        bw: 500,
        maxBw: 500,
        cooldowns: { q: 5, w: 5, e: 5, r: 0 },
      })
      const enemy = makePlayer({ id: 'enemy1', team: 'audit', zone: 'coldstore-cross', integ: 300 })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'coldstore', alwaysCasts(bot.id))
      expect(action).not.toBeNull()
      expect(action!.type).toBe('cast')
      if (action!.type === 'cast') expect(action!.ability).toBe('r')
    })

    it('emits no cast for any rank-0 slot across all hero levels below unlock', () => {
      // Scan a low level where Q/W/E/R ranks differ and assert that any cast the
      // bot does emit is for a slot whose ability is actually learned. Level 1:
      // Q/W/E rank 1, R rank 0.
      const enemy = makePlayer({ id: 'enemy1', team: 'audit', zone: 'coldstore-cross', integ: 300 })
      for (let i = 0; i < 50; i++) {
        const bot = makePlayer({
          zone: 'coldstore-cross',
          level: 1,
          integ: 400,
          maxInteg: 500,
          bw: 500,
          maxBw: 500,
          cooldowns: { q: 0, w: 0, e: 0, r: 0 },
        })
        const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
        const action = decideBotAction(state, bot, 'coldstore')
        if (action?.type === 'cast') {
          // R is rank 0 at level 1 and must never be emitted
          expect(action.ability).not.toBe('r')
        }
      }
    })
  })

  describe("ally-targeted abilities (targetType 'ally')", () => {
    const buffEffects: AbilityEffect[] = [{ type: 'buff', value: 15, duration: 3 }]
    const healEffects: AbilityEffect[] = [{ type: 'heal', value: 150 }]
    // A position-swap utility: teleport + a defensive buff, no offensive effect.
    const swapEffects: AbilityEffect[] = [
      { type: 'teleport', value: 1 },
      { type: 'buff', value: 1, duration: 1 },
    ]

    function bot() {
      return makePlayer({
        id: 'bot_alpha',
        team: 'chaff',
        zone: 'coldstore-cross',
        integ: 400,
        maxInteg: 500,
      })
    }
    function ally(integ: number) {
      return makePlayer({
        id: 'bot_ally',
        team: 'chaff',
        zone: 'coldstore-cross',
        integ,
        maxInteg: 500,
      })
    }
    function enemy(integ: number) {
      return makePlayer({
        id: 'enemy1',
        team: 'audit',
        zone: 'coldstore-cross',
        integ,
        maxInteg: 500,
      })
    }

    it('routes a supportive ally buff to the lowest-INTEG ally, not an enemy', () => {
      const ability = makeAbility('ally', buffEffects)
      const target = getAbilityTarget(ability, bot(), [enemy(50)], [ally(150), ally(450)])
      expect(target).toEqual({ kind: 'hero', name: 'bot_ally' })
    })

    it('falls back to self when no ally is present (supportive)', () => {
      const ability = makeAbility('ally', healEffects)
      const target = getAbilityTarget(ability, bot(), [enemy(50)], [])
      expect(target).toEqual({ kind: 'hero', name: 'bot_alpha' })
    })

    it('never resolves an ally ability to an enemy, even when the enemy is the lowest INTEG', () => {
      // The lowest-INTEG unit on the board is the enemy — an enemy-target heuristic
      // would aim here. The ally branch must ignore enemies entirely.
      for (const effects of [buffEffects, healEffects, swapEffects]) {
        const ability = makeAbility('ally', effects)
        const target = getAbilityTarget(ability, bot(), [enemy(10)], [ally(120)])
        expect(target).not.toBeNull()
        if (target && target.kind === 'hero') {
          expect(target.name).not.toBe('enemy1')
          expect(['bot_alpha', 'bot_ally']).toContain(target.name)
        }
      }
    })

    it('skips a supportive ally cast when the whole team is healthy', () => {
      const ability = makeAbility('ally', healEffects)
      // bot 490/500, ally 500/500 — both >= 90%
      const healthyBot = makePlayer({
        id: 'bot_alpha',
        team: 'chaff',
        zone: 'coldstore-cross',
        integ: 490,
        maxInteg: 500,
      })
      const target = getAbilityTarget(ability, healthyBot, [enemy(50)], [ally(500)])
      expect(target).toBeUndefined()
    })

    it('routes a utility (teleport+buff) ally ability to the lowest-INTEG friendly, never an enemy', () => {
      const ability = makeAbility('ally', swapEffects)
      // bot 400/500 (80%), ally 250/500 (50%) — ally is the most hurt friendly.
      const target = getAbilityTarget(ability, bot(), [enemy(50)], [ally(250)])
      expect(target).toEqual({ kind: 'hero', name: 'bot_ally' })
    })

    it('targets self for an ally ability when the bot is the most-hurt friendly', () => {
      const ability = makeAbility('ally', swapEffects)
      // bot 400/500 (80%) is hurt; the only ally is full INTEG.
      const target = getAbilityTarget(ability, bot(), [enemy(50)], [ally(500)])
      expect(target).toEqual({ kind: 'hero', name: 'bot_alpha' })
    })

    it('skips a non-heal/shield ally ability when alone (resolver rejects self)', () => {
      // cron.q (pure buff) and proxy.r (position-swap) explicitly reject a
      // self-target with "Target must be an ally". When the bot is alone, the
      // only candidate is itself, so the cast would be rejected — skip it
      // instead of burning the cycle.
      for (const effects of [buffEffects, swapEffects]) {
        const ability = makeAbility('ally', effects)
        const target = getAbilityTarget(ability, bot(), [enemy(50)], [])
        expect(target).toBeUndefined()
      }
    })

    it('still self-casts a heal/shield ally ability when alone (resolver accepts self)', () => {
      // sentry.q/w, proxy.w, cron.w accept the caster as the target, so a
      // hurt-and-alone bot should still cast on itself.
      for (const effects of [
        healEffects,
        [{ type: 'shield', value: 140, duration: 3 }] as AbilityEffect[],
      ]) {
        const ability = makeAbility('ally', effects)
        const target = getAbilityTarget(ability, bot(), [enemy(50)], [])
        expect(target).toEqual({ kind: 'hero', name: 'bot_alpha' })
      }
    })

    it("treats a single-target 'hero' supportive ability the same (ally, never enemy)", () => {
      // Existing behavior preserved for targetType 'hero' shields/heals.
      const ability = makeAbility('hero', [{ type: 'shield', value: 140, duration: 3 }])
      const target = getAbilityTarget(ability, bot(), [enemy(10)], [ally(120)])
      expect(target).toEqual({ kind: 'hero', name: 'bot_ally' })
    })

    it("still aims a single-target 'hero' damage ability at the lowest-INTEG enemy", () => {
      const ability = makeAbility('hero', [{ type: 'damage', value: 100, damageType: 'code' }])
      const target = getAbilityTarget(ability, bot(), [enemy(100), enemy(40)], [ally(120)])
      // lowest-INTEG enemy is the 40-HP one; both share id 'enemy1' here so just
      // assert it picked an enemy, not the ally.
      expect(target).toEqual({ kind: 'hero', name: 'enemy1' })
    })
  })
})

describe('sequenceBwCost (combo affordability)', () => {
  it('sums the BW cost of every ability in the sequence', () => {
    const echo = HEROES.echo!.abilities
    expect(sequenceBwCost('echo', ['e', 'q'], 1)).toBe(echo.e.bwCost + echo.q.bwCost)
    expect(sequenceBwCost('echo', ['q', 'w', 'r'], 1)).toBe(
      echo.q.bwCost + echo.w.bwCost + echo.r.bwCost,
    )
  })

  it('sums the RANK cost, not the rank-1 headline', () => {
    // Echo Q [40,50,60,70] + W [50,60,70,80]: 90 at rank 1, 150 at rank 4. A
    // level-7 bot summing the headline opens a rotation it cannot finish.
    expect(sequenceBwCost('echo', ['q', 'w'], 1)).toBe(90)
    expect(sequenceBwCost('echo', ['q', 'w'], 7)).toBe(150)
  })

  it('returns 0 for an unknown hero', () => {
    expect(sequenceBwCost('not_a_hero', ['q', 'w'], 1)).toBe(0)
  })

  it('is 0 for an empty sequence', () => {
    expect(sequenceBwCost('echo', [], 1)).toBe(0)
  })
})

function makeConfig(overrides: Partial<BotDifficultyConfig> = {}): BotDifficultyConfig {
  return {
    retreatHpPercent: 30,
    reactionDelayTicks: 0,
    abilityComboChance: 0,
    cacheAwareness: false,
    jungleFarming: false,
    threatAssessment: true,
    ...overrides,
  }
}

describe('BotAI - threat assessment (shouldRetreatFromThreat)', () => {
  // Both sides are level-7 Echo, and the enemy's only off-cooldown ability is
  // Q — worth 120 threat if it can be paid for. Echo Q costs 40 at rank 1 and
  // 70 at rank 4 (level 7), so an enemy holding 55 mana scores 50 or 170
  // depending on which number the bot reads. The bot's own threat (50 attack,
  // -25 for sitting under half INTEG, +50 for five kills = 75) puts the tier-2
  // boundary at 75 x 1.35 = 101 — squarely between the two.
  function scenario(enemyMp: number) {
    const bot = makePlayer({
      heroId: 'echo',
      level: 7,
      zone: 'coldstore-cross',
      integ: 175,
      maxInteg: 500,
      bw: 0,
      kills: 5,
    })
    const enemy = makePlayer({
      id: 'enemy1',
      name: 'enemy1',
      team: 'audit',
      heroId: 'echo',
      level: 7,
      zone: 'coldstore-cross',
      integ: 500,
      maxInteg: 500,
      bw: enemyMp,
      cooldowns: { q: 0, w: 5, e: 5, r: 5 },
    })
    return { state: makeGameState({ players: { [bot.id]: bot, enemy1: enemy } }), bot }
  }

  it('holds ground against an enemy who cannot afford the cast at its rank', () => {
    const { state, bot } = scenario(55)
    expect(shouldRetreatFromThreat(state, bot, makeConfig())).toBe(false)
  })

  it('retreats once the enemy holds the rank cost', () => {
    const { state, bot } = scenario(70)
    expect(shouldRetreatFromThreat(state, bot, makeConfig())).toBe(true)
  })
})

/** Inventory of exactly the given item ids, padded to six slots. */
function inv(...ids: string[]): PlayerState['items'] {
  const slots: (string | null)[] = [...ids]
  while (slots.length < 6) slots.push(null)
  return slots as PlayerState['items']
}

describe('BotAI - combat item usage (tryUseCombatItem)', () => {
  const enemy = makePlayer({ id: 'enemy', name: 'enemy', team: 'audit' })

  it('returns null out of a fight (no enemy heroes in zone)', () => {
    const bot = makePlayer({ integ: 100, maxInteg: 500, items: inv('hardshell') })
    expect(tryUseCombatItem(bot, [], [], makeConfig())).toBeNull()
  })

  it('is gated on threatAssessment — naive (easy) bots never micro items', () => {
    const bot = makePlayer({ integ: 100, maxInteg: 500, items: inv('hardshell') })
    expect(tryUseCombatItem(bot, [enemy], [], makeConfig({ threatAssessment: false }))).toBeNull()
  })

  it('pops a defensive item (Hardshell) when hurt in a fight', () => {
    const bot = makePlayer({ integ: 200, maxInteg: 500, items: inv('hardshell') }) // 40%
    expect(tryUseCombatItem(bot, [enemy], [], makeConfig())).toEqual({
      type: 'use',
      item: 'hardshell',
    })
  })

  it('prefers Hardshell over Spite Plate (defensive priority order)', () => {
    const bot = makePlayer({ integ: 200, maxInteg: 500, items: inv('spite_plate', 'hardshell') })
    expect(tryUseCombatItem(bot, [enemy], [], makeConfig())).toEqual({
      type: 'use',
      item: 'hardshell',
    })
    const onlyMail = makePlayer({ integ: 200, maxInteg: 500, items: inv('spite_plate') })
    expect(tryUseCombatItem(onlyMail, [enemy], [], makeConfig())).toEqual({
      type: 'use',
      item: 'spite_plate',
    })
  })

  it('pops a defensive item when outnumbered even at full INTEG', () => {
    const bot = makePlayer({ integ: 500, maxInteg: 500, items: inv('spite_plate') })
    const e2 = makePlayer({ id: 'enemy2', name: 'enemy2', team: 'audit' })
    // 2 enemies vs (0 allies + self) → outnumbered.
    expect(tryUseCombatItem(bot, [enemy, e2], [], makeConfig())).toEqual({
      type: 'use',
      item: 'spite_plate',
    })
  })

  it('does NOT burn a defensive item on a healthy, even fight', () => {
    // Full INTEG, 1v1, only a defensive item → not under pressure, nothing offensive.
    const bot = makePlayer({ integ: 500, maxInteg: 500, items: inv('hardshell') })
    expect(tryUseCombatItem(bot, [enemy], [], makeConfig())).toBeNull()
  })

  it('a support bot pops Lotus Orb (spell-reflect) under pressure', () => {
    const bot = makePlayer({ integ: 300, maxInteg: 500, items: inv('mirror_shell') }) // 60%, hurt
    expect(tryUseCombatItem(bot, [enemy], [], makeConfig())).toEqual({
      type: 'use',
      item: 'mirror_shell',
    })
  })

  it('pops Stack Overflow when an ability is ready to consume the charge', () => {
    const bot = makePlayer({ integ: 500, maxInteg: 500, bw: 200, items: inv('stack_overflow') })
    expect(tryUseCombatItem(bot, [enemy], [], makeConfig())).toEqual({
      type: 'use',
      item: 'stack_overflow',
    })
  })

  it('does NOT pop Stack Overflow with no ability able to consume the charge', () => {
    // Every ability on cooldown → nothing can consume the double-damage charge,
    // so the bot holds it rather than wasting it on a pure right-click.
    const bot = makePlayer({
      integ: 500,
      maxInteg: 500,
      cooldowns: { q: 4, w: 4, e: 4, r: 4 },
      items: inv('stack_overflow'),
    })
    expect(tryUseCombatItem(bot, [enemy], [], makeConfig())).toBeNull()
  })

  it('pops Discord Routine regardless of ability readiness', () => {
    const bot = makePlayer({ integ: 500, maxInteg: 500, bw: 0, items: inv('discord_routine') })
    expect(tryUseCombatItem(bot, [enemy], [], makeConfig())).toEqual({
      type: 'use',
      item: 'discord_routine',
    })
  })

  it('respects item cooldown (item_cd_<id> buff)', () => {
    const bot = makePlayer({
      integ: 100,
      maxInteg: 500,
      items: inv('hardshell'),
      buffs: [{ id: 'item_cd_hardshell', stacks: 1, cyclesRemaining: 10, source: 'x' }],
    })
    expect(tryUseCombatItem(bot, [enemy], [], makeConfig())).toBeNull()
  })

  it('returns null when the bot owns no combat actives', () => {
    const bot = makePlayer({ integ: 100, maxInteg: 500, items: inv() })
    expect(tryUseCombatItem(bot, [enemy], [], makeConfig())).toBeNull()
  })

  it('decideBotAction wires it in: a hurt bot in a fight pops its Hardshell', () => {
    // 60% INTEG avoids the retreat threshold yet is under the defensive-pressure
    // cutoff; default difficulty (medium) has threatAssessment on.
    const bot = makePlayer({
      zone: 'coldstore-cross',
      integ: 300,
      maxInteg: 500,
      items: inv('hardshell'),
    })
    const foe = makePlayer({ id: 'foe', name: 'foe', team: 'audit', zone: 'coldstore-cross' })
    const state = makeGameState({ players: { [bot.id]: bot, [foe.id]: foe } })
    expect(decideBotAction(state, bot, 'coldstore')).toEqual({ type: 'use', item: 'hardshell' })
  })
})

describe('BotAI - targeted combat items (tryUseCombatItem)', () => {
  const lowFoe = makePlayer({ id: 'low', name: 'low', team: 'audit', integ: 100, maxInteg: 600 })
  const highFoe = makePlayer({ id: 'high', name: 'high', team: 'audit', integ: 600, maxInteg: 600 })

  it('hexes the kill target (lowest-INTEG enemy)', () => {
    const bot = makePlayer({ integ: 500, maxInteg: 500, items: inv('lockout_shunt') })
    expect(tryUseCombatItem(bot, [highFoe, lowFoe], [], makeConfig())).toEqual({
      type: 'use',
      item: 'lockout_shunt',
      target: { kind: 'hero', name: 'low' },
    })
  })

  it('dagons the lowest-INTEG enemy', () => {
    const bot = makePlayer({ integ: 500, maxInteg: 500, items: inv('burnout') })
    expect(tryUseCombatItem(bot, [highFoe, lowFoe], [], makeConfig())).toEqual({
      type: 'use',
      item: 'burnout',
      target: { kind: 'hero', name: 'low' },
    })
  })

  it('ethereals the kill target before it would burnout', () => {
    const bot = makePlayer({ integ: 500, maxInteg: 500, items: inv('burnout', 'phase_shim') })
    expect(tryUseCombatItem(bot, [lowFoe], [], makeConfig())).toEqual({
      type: 'use',
      item: 'phase_shim',
      target: { kind: 'hero', name: 'low' },
    })
  })

  it('holds Burnout/Ethereal when the kill target is magic-immune (they would fizzle)', () => {
    const immune = makePlayer({
      id: 'bkb',
      name: 'bkb',
      team: 'audit',
      integ: 100,
      maxInteg: 600,
      buffs: [{ id: 'airgap', stacks: 1, cyclesRemaining: 4, source: 'hardshell' }],
    })
    const bot = makePlayer({ integ: 500, maxInteg: 500, items: inv('burnout', 'phase_shim') })
    expect(tryUseCombatItem(bot, [immune], [], makeConfig())).toBeNull()
  })

  it('cyclones a SECONDARY enemy (healthiest other threat), never the kill target', () => {
    const bot = makePlayer({ integ: 500, maxInteg: 500, items: inv('stasis_shunt') })
    expect(tryUseCombatItem(bot, [lowFoe, highFoe], [], makeConfig())).toEqual({
      type: 'use',
      item: 'stasis_shunt',
      target: { kind: 'hero', name: 'high' },
    })
  })

  it('does not cyclone in a 1v1 (no secondary enemy to remove)', () => {
    const bot = makePlayer({ integ: 500, maxInteg: 500, items: inv('stasis_shunt') })
    expect(tryUseCombatItem(bot, [lowFoe], [], makeConfig())).toBeNull()
  })

  it('prioritises Veil (zone amp) ahead of the targeted nukes', () => {
    const bot = makePlayer({ integ: 500, maxInteg: 500, items: inv('burnout', 'discord_routine') })
    expect(tryUseCombatItem(bot, [lowFoe], [], makeConfig())).toEqual({
      type: 'use',
      item: 'discord_routine',
    })
  })

  it('decideBotAction wires targeted items in: a mage bot dagons the low enemy', () => {
    const bot = makePlayer({
      zone: 'coldstore-cross',
      integ: 500,
      maxInteg: 500,
      items: inv('burnout'),
    })
    const foe = makePlayer({
      id: 'low',
      name: 'low',
      team: 'audit',
      zone: 'coldstore-cross',
      integ: 100,
    })
    const state = makeGameState({ players: { [bot.id]: bot, [foe.id]: foe } })
    expect(decideBotAction(state, bot, 'coldstore')).toEqual({
      type: 'use',
      item: 'burnout',
      target: { kind: 'hero', name: 'low' },
    })
  })
})

describe('BotAI - panic survival items (retreat branch)', () => {
  it('returns an owned, off-cooldown defensive item', () => {
    const bot = makePlayer({ items: inv('spite_plate') })
    expect(tryPanicDefensiveItem(bot, makeConfig())).toEqual({ type: 'use', item: 'spite_plate' })
  })

  it('a support bot can panic with Lotus Orb', () => {
    const bot = makePlayer({ items: inv('mirror_shell') })
    expect(tryPanicDefensiveItem(bot, makeConfig())).toEqual({ type: 'use', item: 'mirror_shell' })
  })

  it('is gated on threatAssessment (easy bots panic-walk instead)', () => {
    const bot = makePlayer({ items: inv('hardshell') })
    expect(tryPanicDefensiveItem(bot, makeConfig({ threatAssessment: false }))).toBeNull()
  })

  it('respects item cooldown', () => {
    const bot = makePlayer({
      items: inv('hardshell'),
      buffs: [{ id: 'item_cd_hardshell', stacks: 1, cyclesRemaining: 8, source: 'x' }],
    })
    expect(tryPanicDefensiveItem(bot, makeConfig())).toBeNull()
  })

  it('decideBotAction: a chased, low-INTEG bot pops Hardshell instead of fleeing to its death', () => {
    // 20% INTEG (below the medium retreat threshold) with an enemy in zone → the
    // retreat branch runs; it can't TP through combat, so it pops the panic item.
    const bot = makePlayer({
      zone: 'coldstore-t1-chaff',
      integ: 100,
      maxInteg: 500,
      items: inv('hardshell'),
    })
    const foe = makePlayer({
      id: 'chaser',
      name: 'chaser',
      team: 'audit',
      zone: 'coldstore-t1-chaff',
    })
    const state = makeGameState({ players: { [bot.id]: bot, [foe.id]: foe } })
    expect(decideBotAction(state, bot, 'coldstore')).toEqual({ type: 'use', item: 'hardshell' })
  })

  it('decideBotAction: a chased bot with no panic item still walks toward the fountain', () => {
    const bot = makePlayer({ zone: 'coldstore-t1-chaff', integ: 100, maxInteg: 500, items: inv() })
    const foe = makePlayer({
      id: 'chaser',
      name: 'chaser',
      team: 'audit',
      zone: 'coldstore-t1-chaff',
    })
    const state = makeGameState({ players: { [bot.id]: bot, [foe.id]: foe } })
    const action = decideBotAction(state, bot, 'coldstore')
    expect(action?.type).toBe('move')
  })
})

describe('BotAI - warding', () => {
  const aWard = {
    team: 'chaff' as const,
    placedTick: 0,
    expiryTick: 100,
    type: 'camtap' as const,
  }
  const zonesWith = (zoneId: string, count: number) => {
    const zones = initializeZoneStates()
    const base = zones[zoneId]!
    zones[zoneId] = { ...base, wards: Array.from({ length: count }, () => ({ ...aWard })) }
    return zones
  }

  it('returns null without an CAMTAP in inventory', () => {
    const bot = makePlayer({ zone: 'cache-seawall', items: inv() })
    expect(tryPlaceWard(makeGameState({ players: { [bot.id]: bot } }), bot)).toBeNull()
  })

  it('wards the strategic zone the bot is standing in', () => {
    const bot = makePlayer({ zone: 'cache-seawall', items: inv('camtap') })
    expect(tryPlaceWard(makeGameState({ players: { [bot.id]: bot } }), bot)).toEqual({
      type: 'tap',
      zone: 'cache-seawall',
    })
  })

  it('wards an adjacent strategic zone (seawall-cross → cache-seawall)', () => {
    const bot = makePlayer({ zone: 'seawall-cross', items: inv('camtap') })
    expect(tryPlaceWard(makeGameState({ players: { [bot.id]: bot } }), bot)).toEqual({
      type: 'tap',
      zone: 'cache-seawall',
    })
  })

  it('does not re-ward a strategic zone the team already covers', () => {
    const bot = makePlayer({ zone: 'cache-seawall', items: inv('camtap') })
    const state = makeGameState({
      players: { [bot.id]: bot },
      zones: zonesWith('cache-seawall', 1),
    })
    expect(tryPlaceWard(state, bot)).toBeNull()
  })

  it('holds the ward when the team is already at the ward limit', () => {
    const bot = makePlayer({ zone: 'cache-seawall', items: inv('camtap') })
    // 3 chaff wards parked elsewhere → at WARD_LIMIT_PER_TEAM.
    const state = makeGameState({
      players: { [bot.id]: bot },
      zones: zonesWith('cache-shallows', 3),
    })
    expect(tryPlaceWard(state, bot)).toBeNull()
  })

  it('returns null when not in or next to a strategic zone', () => {
    const bot = makePlayer({ zone: 'rookery-anchor', items: inv('camtap') })
    expect(tryPlaceWard(makeGameState({ players: { [bot.id]: bot } }), bot)).toBeNull()
  })

  it('a support bot buys an CAMTAP at the fountain', () => {
    const bot = makePlayer({
      heroId: 'sentry', // role: support
      zone: 'rookery-anchor',
      scrip: 600,
      items: inv('trauma_patch', 'recall_token'),
    })
    expect(
      decideBotAction(makeGameState({ players: { [bot.id]: bot } }), bot, 'coldstore'),
    ).toEqual({
      type: 'buy',
      item: 'camtap',
    })
  })

  it('a non-support bot does not buy wards', () => {
    const bot = makePlayer({
      heroId: 'echo', // not support
      zone: 'rookery-anchor',
      scrip: 600,
      items: inv('trauma_patch', 'recall_token'),
    })
    const action = decideBotAction(makeGameState({ players: { [bot.id]: bot } }), bot, 'coldstore')
    expect(action).not.toEqual({ type: 'buy', item: 'camtap' })
  })

  it('decideBotAction wires warding into a calm tick', () => {
    const bot = makePlayer({ heroId: 'sentry', zone: 'cache-seawall', items: inv('camtap') })
    const state = makeGameState({ players: { [bot.id]: bot } })
    expect(decideBotAction(state, bot, 'coldstore')).toEqual({
      type: 'tap',
      zone: 'cache-seawall',
    })
  })
})

describe('BotAI - difficulty actually bites (abilityComboChance)', () => {
  it('easy right-clicks where hard casts, on the same tick', () => {
    // The ability fallback used to take no config at all, so every difficulty
    // fired its ultimate the cycle it came off cooldown and abilityComboChance
    // only changed WHICH ability came out. Tick 30's ability roll is 0.67:
    // above easy's 0.2 and medium's 0.5, below hard's 0.8.
    const bot = makePlayer({
      zone: 'coldstore-cross',
      level: 6,
      integ: 400,
      maxInteg: 500,
      bw: 400,
    })
    const enemy = makePlayer({ id: 'enemy1', team: 'audit', zone: 'coldstore-cross', integ: 300 })
    const state = makeGameState({ cycle: 30, players: { [bot.id]: bot, enemy1: enemy } })

    expect(decideBotAction(state, bot, 'coldstore', atDifficulty('easy', bot.id))).toEqual({
      type: 'attack',
      target: { kind: 'hero', name: 'enemy1' },
    })
    expect(decideBotAction(state, bot, 'coldstore', atDifficulty('hard', bot.id))?.type).toBe(
      'cast',
    )
  })

  it('a bot that fails the roll still acts — it never returns null in a fight', () => {
    const bot = makePlayer({
      zone: 'coldstore-cross',
      level: 6,
      integ: 400,
      maxInteg: 500,
      bw: 400,
    })
    const enemy = makePlayer({ id: 'enemy1', team: 'audit', zone: 'coldstore-cross', integ: 300 })
    for (const cycle of [0, 5, 12, 20, 30, 40, 50]) {
      const state = makeGameState({ cycle, players: { [bot.id]: bot, enemy1: enemy } })
      expect(decideBotAction(state, bot, 'coldstore', atDifficulty('easy', bot.id))).not.toBeNull()
    }
  })
})

describe('BotAI - denying (medium+)', () => {
  const enemy = makePlayer({ id: 'enemy1', team: 'audit', zone: 'coldstore-t1-chaff', integ: 300 })
  /** No BW and every ability parked, so the burn competes with a right-click. */
  const denier = () =>
    makePlayer({
      zone: 'coldstore-t1-chaff',
      integ: 400,
      maxInteg: 500,
      bw: 0,
      cooldowns: { q: 5, w: 5, e: 5, r: 5 },
    })

  it('burns the allied wave inside the resolver window, by zone-local index', () => {
    const bot = denier()
    const waves: WaveUnitState[] = [
      {
        id: 'wave-1',
        team: 'audit',
        zone: 'coldstore-t1-chaff',
        integ: 200,
        maxInteg: 200,
        type: 'line',
      },
      {
        id: 'wave-2',
        team: 'chaff',
        zone: 'coldstore-t1-chaff',
        integ: 40,
        maxInteg: 200,
        type: 'line',
      },
    ]
    const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy }, waves })
    expect(decideBotAction(state, bot, 'coldstore', atDifficulty('medium', bot.id))).toEqual({
      type: 'burn',
      target: { kind: 'wave', index: 1 },
    })
  })

  it('leaves a healthy allied wave alone (outside BURN_HP_THRESHOLD the burn would no-op)', () => {
    const bot = denier()
    const waves: WaveUnitState[] = [
      {
        id: 'wave-1',
        team: 'chaff',
        zone: 'coldstore-t1-chaff',
        integ: 150,
        maxInteg: 200,
        type: 'line',
      },
    ]
    const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy }, waves })
    expect(decideBotAction(state, bot, 'coldstore', atDifficulty('medium', bot.id))).toEqual({
      type: 'attack',
      target: { kind: 'hero', name: 'enemy1' },
    })
  })

  it('easy bots do not burn (denyAwareness off)', () => {
    const bot = denier()
    const waves: WaveUnitState[] = [
      {
        id: 'wave-1',
        team: 'chaff',
        zone: 'coldstore-t1-chaff',
        integ: 40,
        maxInteg: 200,
        type: 'line',
      },
    ]
    const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy }, waves })
    expect(decideBotAction(state, bot, 'coldstore', atDifficulty('easy', bot.id))).toEqual({
      type: 'attack',
      target: { kind: 'hero', name: 'enemy1' },
    })
  })

  it('never burns with no enemy hero around — that just throws away your own wave', () => {
    const bot = denier()
    const waves: WaveUnitState[] = [
      {
        id: 'wave-1',
        team: 'chaff',
        zone: 'coldstore-t1-chaff',
        integ: 40,
        maxInteg: 200,
        type: 'line',
      },
    ]
    const state = makeGameState({ players: { [bot.id]: bot }, waves })
    const action = decideBotAction(state, bot, 'coldstore', atDifficulty('medium', bot.id))
    expect(action?.type).not.toBe('burn')
  })
})

describe('BotAI - ice defence rotation (outnumbered, not undefended)', () => {
  const THREATENED = 'seawall-t1-chaff'

  function breach(defenderIds: string[], attackers: number, botZone = 'seawall-t2-chaff') {
    const bot = makePlayer({ id: 'bot_alpha', zone: botZone, level: 1, integ: 500, maxInteg: 500 })
    const players: Record<string, PlayerState> = { [bot.id]: bot }
    for (const id of defenderIds) {
      players[id] = makePlayer({ id, name: id, team: 'chaff', zone: THREATENED })
    }
    for (let i = 0; i < attackers; i++) {
      const id = `enemy${i}`
      players[id] = makePlayer({ id, name: id, team: 'audit', zone: THREATENED })
    }
    // Lane 'coldstore' so the bot's own lane push can't be confused for a rotation.
    return { bot, state: makeGameState({ players }) }
  }

  it('rotates to a teammate who is outnumbered at the ice', () => {
    const { bot, state } = breach(['bot_bravo'], 2)
    expect(decideBotAction(state, bot, 'coldstore', atDifficulty('medium', bot.id))).toEqual({
      type: 'move',
      zone: THREATENED,
    })
  })

  it('a HUMAN ally running back to defend still summons help', () => {
    // The old predicate was "is any ally already there?", so a human doing the
    // right thing was precisely what told the bots the ice was handled.
    const { bot, state } = breach(['github_7379966'], 2)
    expect(decideBotAction(state, bot, 'coldstore', atDifficulty('medium', bot.id))).toEqual({
      type: 'move',
      zone: THREATENED,
    })
  })

  it('does not rotate into an even fight (defenders match attackers)', () => {
    const { bot, state } = breach(['bot_bravo'], 1)
    const action = decideBotAction(state, bot, 'coldstore', atDifficulty('medium', bot.id))
    expect(action).not.toEqual({ type: 'move', zone: THREATENED })
  })

  it('still answers an undefended ice (no ally present at all)', () => {
    const { bot, state } = breach([], 1)
    expect(decideBotAction(state, bot, 'coldstore', atDifficulty('medium', bot.id))).toEqual({
      type: 'move',
      zone: THREATENED,
    })
  })

  it('will not cross the map for it — the rescue is distance-bounded', () => {
    // seawall-t1-chaff is 3 zones from coldstore-t1-chaff (inside the bound) and 4 from
    // shallows-t1-chaff (outside it): a rescue that lands in five ticks is a lane
    // abandoned for a fight that is already over.
    const near = breach(['bot_bravo'], 2, 'coldstore-t1-chaff')
    expect(
      decideBotAction(near.state, near.bot, 'coldstore', atDifficulty('medium', near.bot.id)),
    ).toEqual({ type: 'move', zone: findPath('coldstore-t1-chaff', THREATENED)[1] })

    // Assigned to its own lane so its ordinary lane push can't be mistaken for
    // (or collide with) the first step of the rescue path.
    const far = breach(['bot_bravo'], 2, 'shallows-t1-chaff')
    expect(
      decideBotAction(far.state, far.bot, 'shallows', atDifficulty('medium', far.bot.id)),
    ).not.toEqual({ type: 'move', zone: findPath('shallows-t1-chaff', THREATENED)[1] })
  })
})

describe('BotAI - Tenant (start condition, steal window, team cooldown)', () => {
  const ROSH_MAX = 5000

  function pitScene(
    opts: {
      cycle?: number
      tenantHp?: number
      level?: number
      allies?: number
      botZone?: string
    } = {},
  ) {
    const bot = makePlayer({
      id: 'bot_alpha',
      heroId: 'echo', // carry — a role that contests Tenant
      level: opts.level ?? 8,
      zone: opts.botZone ?? 'hollow',
      integ: 500,
      maxInteg: 500,
    })
    const players: Record<string, PlayerState> = { [bot.id]: bot }
    for (let i = 0; i < (opts.allies ?? 2); i++) {
      const id = `bot_ally${i}`
      players[id] = makePlayer({ id, name: id, level: 8, zone: 'cache-seawall' })
    }
    return {
      bot,
      state: makeGameState({
        cycle: opts.cycle ?? 40,
        players,
        tenant: {
          alive: true,
          integ: opts.tenantHp ?? ROSH_MAX,
          maxInteg: ROSH_MAX,
          deathCycle: null,
        },
      }),
    }
  }

  const HIT_TENANT = { type: 'attack', target: { kind: 'tenant' } }

  it('STARTS a full-INTEG Tenant with the squad assembled at level 8', () => {
    // The old gate was `hp/maxInteg > 0.4 → return null`. Nothing but a hero can
    // damage Tenant, so in a bots-only match his INTEG never moved and the Backup
    // never dropped.
    const { bot, state } = pitScene()
    expect(decideBotAction(state, bot, 'coldstore', atDifficulty('medium', bot.id))).toEqual(
      HIT_TENANT,
    )
  })

  it('walks to the pit when the squad is assembled but the bot is not there yet', () => {
    const { bot, state } = pitScene({ botZone: 'coldstore-cross' })
    expect(decideBotAction(state, bot, 'coldstore', atDifficulty('medium', bot.id))).toEqual({
      type: 'move',
      zone: 'cache-seawall',
    })
  })

  /**
   * Calling and joining are different jobs, and conflating them deadlocked the
   * objective. The open condition used to require allies ALREADY within two
   * zones of the pit — but no bot walks toward the pit until its team has
   * committed, and the team only commits when someone opens. Nobody could go
   * first, so across 20 simulated matches the Tenant died 0.4 times.
   *
   * After the split (caller near, allies merely able to arrive) the same 20-match
   * run kills him 0.65 times. These two tests pin the mechanism.
   */
  it('opens the call while the squad is still WALKING, not already at the pit', () => {
    // Allies two zones out — they can arrive, they are not there yet. Under the
    // old gate this returned null forever and nobody ever started.
    const bot = makePlayer({
      id: 'bot_alpha',
      heroId: 'echo',
      level: 8,
      zone: 'hollow',
      integ: 500,
      maxInteg: 500,
    })
    const players: Record<string, PlayerState> = { [bot.id]: bot }
    for (let i = 0; i < 2; i++) {
      const id = `bot_ally${i}`
      // Three hops out: able to arrive (TENANT_MAX_TRAVEL_DISTANCE), and OUTSIDE
      // the old two-zone gate — which is exactly the case that used to deadlock.
      players[id] = makePlayer({ id, name: id, level: 8, zone: 'coldstore-t1-chaff' })
    }
    const state = makeGameState({
      cycle: 40,
      players,
      tenant: { alive: true, integ: ROSH_MAX, maxInteg: ROSH_MAX, deathCycle: null },
    })
    expect(decideBotAction(state, bot, 'coldstore', atDifficulty('medium', bot.id))).toEqual(
      HIT_TENANT,
    )
  })

  it('does NOT let a bot across the map make the call', () => {
    // The caller has to be at the pit's door. Otherwise one bot on the far side
    // burns the team's one commitment window on a fight it cannot reach.
    const { bot, state } = pitScene({ botZone: 'landing-anchor' })
    const action = decideBotAction(state, bot, 'coldstore', atDifficulty('medium', bot.id))
    expect(action).not.toEqual(HIT_TENANT)
  })

  it('will not open one alone', () => {
    const { bot, state } = pitScene({ allies: 1 })
    expect(decideBotAction(state, bot, 'coldstore', atDifficulty('medium', bot.id))).not.toEqual(
      HIT_TENANT,
    )
  })

  it('will not open one under level 8', () => {
    const { bot, state } = pitScene({ level: 7 })
    expect(decideBotAction(state, bot, 'coldstore', atDifficulty('medium', bot.id))).not.toEqual(
      HIT_TENANT,
    )
  })

  it('will not open a Tenant already chewed to half — that fight belongs to whoever started it', () => {
    const { bot, state } = pitScene({ tenantHp: ROSH_MAX * 0.5 })
    expect(decideBotAction(state, bot, 'coldstore', atDifficulty('medium', bot.id))).not.toEqual(
      HIT_TENANT,
    )
  })

  it('STEALS a Tenant under 40% with one ally at level 6 (the old opportunistic clause)', () => {
    const { bot, state } = pitScene({ tenantHp: ROSH_MAX * 0.3, level: 6, allies: 1 })
    expect(decideBotAction(state, bot, 'coldstore', atDifficulty('medium', bot.id))).toEqual(
      HIT_TENANT,
    )
  })

  it('a committed team keeps hitting through no-mans-land INTEG for the whole window', () => {
    const gameId = atDifficulty('medium', 'bot_alpha')
    const opened = pitScene({ cycle: 40 })
    expect(decideBotAction(opened.state, opened.bot, 'coldstore', gameId)).toEqual(HIT_TENANT)
    // Same attempt, 5 ticks later, Tenant now at 50% — no longer a legal START,
    // but the team is already committed.
    const midFight = pitScene({ cycle: 45, tenantHp: ROSH_MAX * 0.5 })
    expect(decideBotAction(midFight.state, midFight.bot, 'coldstore', gameId)).toEqual(HIT_TENANT)
  })

  it('locks the team out after the attempt window so it does not camp the pit', () => {
    const gameId = atDifficulty('medium', 'bot_alpha')
    const opened = pitScene({ cycle: 40 })
    expect(decideBotAction(opened.state, opened.bot, 'coldstore', gameId)).toEqual(HIT_TENANT)

    // Window is 20 ticks, lockout 120 more.
    const cooling = pitScene({ cycle: 100 })
    expect(decideBotAction(cooling.state, cooling.bot, 'coldstore', gameId)).not.toEqual(HIT_TENANT)

    // ...and it expires.
    const later = pitScene({ cycle: 200 })
    expect(decideBotAction(later.state, later.bot, 'coldstore', gameId)).toEqual(HIT_TENANT)
  })

  it('a nearly-dead Tenant is still worth stealing during the lockout', () => {
    const gameId = atDifficulty('medium', 'bot_alpha')
    const opened = pitScene({ cycle: 40 })
    expect(decideBotAction(opened.state, opened.bot, 'coldstore', gameId)).toEqual(HIT_TENANT)

    const steal = pitScene({ cycle: 100, tenantHp: ROSH_MAX * 0.2 })
    expect(decideBotAction(steal.state, steal.bot, 'coldstore', gameId)).toEqual(HIT_TENANT)
  })

  it('a committed bot keeps swinging below the START health floor', () => {
    // Tenant hits for 150 a cycle. Holding every bot to the 70% opening floor for
    // the whole fight meant two swings each and a walk-out, and his INTEG crept but
    // never fell — the Backup still never dropped. The hold floor is only high
    // enough that nobody dies in the pit.
    const gameId = atDifficulty('medium', 'bot_alpha')
    const opened = pitScene({ cycle: 40 })
    expect(decideBotAction(opened.state, opened.bot, 'coldstore', gameId)).toEqual(HIT_TENANT)

    const scene = pitScene({ cycle: 46 })
    const withHp = (integ: number) => {
      const hurt = { ...scene.bot, integ }
      return decideBotAction(
        { ...scene.state, players: { ...scene.state.players, [hurt.id]: hurt } },
        hurt,
        'coldstore',
        gameId,
      )
    }
    expect(withHp(275)).toEqual(HIT_TENANT) // 55% — under the start floor, over the hold floor
    expect(withHp(200)).not.toEqual(HIT_TENANT) // 40% — one more Tenant hit is a death
  })

  it('only a core role opens the pit — a support will not start one', () => {
    const { bot, state } = pitScene()
    const support = { ...bot, heroId: 'sentry' }
    expect(
      decideBotAction(
        { ...state, players: { ...state.players, [support.id]: support } },
        support,
        'coldstore',
        atDifficulty('medium', support.id),
      ),
    ).not.toEqual(HIT_TENANT)
  })

  it('but any role piles in once the team has committed', () => {
    // Tenant focuses the lowest-INTEG hero in the pit, so extra bodies spread his
    // damage — a squad that only ever fields cores gets two hits each and leaves.
    const gameId = atDifficulty('medium', 'bot_alpha', 'bot_sentry')
    const opened = pitScene({ cycle: 40 })
    expect(decideBotAction(opened.state, opened.bot, 'coldstore', gameId)).toEqual(HIT_TENANT)

    const joining = pitScene({ cycle: 45 })
    const support = { ...joining.bot, id: 'bot_sentry', name: 'bot_sentry', heroId: 'sentry' }
    expect(
      decideBotAction(
        { ...joining.state, players: { ...joining.state.players, [support.id]: support } },
        support,
        'coldstore',
        gameId,
      ),
    ).toEqual(HIT_TENANT)
  })

  it('easy bots never contest Tenant (threatAssessment off)', () => {
    const { bot, state } = pitScene()
    expect(decideBotAction(state, bot, 'coldstore', atDifficulty('easy', bot.id))).not.toEqual(
      HIT_TENANT,
    )
  })

  it('never routes toward a pit the map does not have', () => {
    const { bot, state } = pitScene({ botZone: 'coldstore-cross' })
    const zones = { ...state.zones }
    delete zones['hollow']
    const action = decideBotAction(
      { ...state, zones },
      bot,
      'coldstore',
      atDifficulty('medium', bot.id),
    )
    expect(action).not.toEqual({ type: 'move', zone: 'cache-seawall' })
  })
})

describe('isOwnSide — the rename guard', () => {
  it('reads the zone record team, never the id string', () => {
    // Regression for the substring-parser trap: side decisions must survive a
    // full zone-id rename. The old endsWith('-chaff')/startsWith('silt-chaff')
    // ladder read every renamed zone as enemy-side and inverted the bots'
    // entire spatial model with no type error and no test failure.
    for (const zone of ZONES) {
      expect(isOwnSide(zone.id, 'chaff')).toBe(zone.team === 'chaff')
      expect(isOwnSide(zone.id, 'audit')).toBe(zone.team === 'audit')

      if (zone.team === 'neutral') {
        expect(isOwnSide(zone.id, 'chaff')).toBe(false)
        expect(isOwnSide(zone.id, 'audit')).toBe(false)
      }
    }

    // An id the map does not know is own for NOBODY (never defaults to a side).
    expect(isOwnSide('seawall-ice-1-chf', 'chaff')).toBe(false)
    expect(isOwnSide('seawall-ice-1-chf', 'audit')).toBe(false)
  })
})

describe('BotAI — R4-12 breach-then-control', () => {
  afterEach(() => {
    cleanupBotState('bot_alpha')
    cleanupBotState('bot_easy_kernel')
  })

  it('unfair bot breaches a closed enemy before casting hard control (kernel Q stun)', () => {
    const bot = makePlayer({
      id: 'bot_alpha',
      heroId: 'kernel',
      zone: 'coldstore-cross',
      level: 6,
      bw: 300,
      maxBw: 300,
      // R is zone AoE (no single target) — leave it on CD so Q stun is the pick.
      cooldowns: { q: 0, w: 99, e: 99, r: 99 },
    })
    const enemy = makePlayer({
      id: 'enemy1',
      team: 'audit',
      name: 'Enemy',
      heroId: 'echo',
      zone: 'coldstore-cross',
      // closed — no breached buff
      buffs: [],
    })
    const gameId = alwaysCasts(bot.id)
    const state = makeGameState({
      cycle: 20,
      players: { [bot.id]: bot, [enemy.id]: enemy },
    })
    const action = decideBotAction(state, bot, 'coldstore', gameId)
    expect(action).toEqual({
      type: 'breach',
      target: { kind: 'hero', name: enemy.id },
    })
  })

  it('unfair bot casts hard control once the target is already breached', () => {
    const bot = makePlayer({
      id: 'bot_alpha',
      heroId: 'kernel',
      zone: 'coldstore-cross',
      level: 6,
      bw: 300,
      maxBw: 300,
      cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    })
    const enemy = makePlayer({
      id: 'enemy1',
      team: 'audit',
      name: 'Enemy',
      heroId: 'echo',
      zone: 'coldstore-cross',
      buffs: [{ id: 'breached', stacks: 1, cyclesRemaining: 3, source: bot.id }],
    })
    const gameId = alwaysCasts(bot.id)
    const state = makeGameState({
      cycle: 20,
      players: { [bot.id]: bot, [enemy.id]: enemy },
    })
    const action = decideBotAction(state, bot, 'coldstore', gameId)
    expect(action?.type).toBe('cast')
  })

  it('easy bot never emits breach (threatAssessment off)', () => {
    const bot = makePlayer({
      id: 'bot_easy_kernel',
      heroId: 'kernel',
      zone: 'coldstore-cross',
      level: 6,
      bw: 300,
      maxBw: 300,
      cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    })
    const enemy = makePlayer({
      id: 'enemy1',
      team: 'audit',
      name: 'Enemy',
      heroId: 'echo',
      zone: 'coldstore-cross',
      buffs: [],
    })
    const gameId = atDifficulty('easy', bot.id)
    for (let cycle = 1; cycle < 50; cycle++) {
      const state = makeGameState({
        cycle,
        players: { [bot.id]: bot, [enemy.id]: enemy },
      })
      const action = decideBotAction(state, bot, 'coldstore', gameId)
      expect(action?.type).not.toBe('breach')
    }
  })

  it('never breaches an airgapped target', () => {
    const bot = makePlayer({
      id: 'bot_alpha',
      heroId: 'kernel',
      zone: 'coldstore-cross',
      level: 6,
      bw: 300,
      maxBw: 300,
      cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    })
    const enemy = makePlayer({
      id: 'enemy1',
      team: 'audit',
      name: 'Enemy',
      heroId: 'echo',
      zone: 'coldstore-cross',
      buffs: [{ id: 'airgap', stacks: 1, cyclesRemaining: 4, source: 'hardshell' }],
    })
    const gameId = alwaysCasts(bot.id)
    for (let cycle = 20; cycle < 40; cycle++) {
      const state = makeGameState({
        cycle,
        players: { [bot.id]: bot, [enemy.id]: enemy },
      })
      const action = decideBotAction(state, bot, 'coldstore', gameId)
      expect(action?.type).not.toBe('breach')
    }
  })
})

describe('BotAI - rotation (leaving a quiet route to help one that is not)', () => {
  /**
   * A bot's route is assigned once and never revisited, so it farmed the same
   * three zones for a whole match while a teammate two routes over died 2v1.
   * That is the most visible way bots read as *not playing the game*: a human
   * immediately understands that nobody came.
   *
   * The guards matter more than the behaviour — a bot that rotates eagerly stops
   * farming and arrives late everywhere, which is worse than never moving. Each
   * test below removes exactly one guard.
   *
   * NOTE on what to assert. A rotation returns the FIRST HOP of the path, never
   * the destination — the first version of these tests asserted
   * `zone !== ALLY_ZONE` and therefore passed no matter what the bot did,
   * including with the guards deleted. The expected hop is computed here.
   */
  // The scene has to make rotation the ONLY explanation for the move, which
  // took three attempts:
  //   - bot on its own T1: the rescue's first hop is also the retreat
  //     direction, so a hurt bot "passed" the guard test by retreating;
  //   - bot in the Silt: the neighbouring route zone is reachable by the
  //     jungle/lane branches too, so deleting rotation entirely changed nothing.
  // From the mid crossing the step toward the teammate is `cache-seawall`, which
  // is neither the lane advance (coldstore-t1-audit) nor the retreat
  // (coldstore-t1-chaff). Removing rotation now fails this.
  const BOT_ZONE = 'coldstore-cross'
  const ALLY_ZONE = 'seawall-cross'
  /** First step of the walk from the bot to the teammate under pressure. */
  const RESCUE_HOP = findPath(BOT_ZONE, ALLY_ZONE)[1]!

  function scene(
    opts: {
      botZone?: string
      botHp?: number
      level?: number
      enemies?: number
      friends?: number
      waveInBotZone?: boolean
    } = {},
  ) {
    const bot = makePlayer({
      id: 'bot_rotator',
      heroId: 'echo',
      level: opts.level ?? 8,
      zone: opts.botZone ?? BOT_ZONE,
      integ: opts.botHp ?? 500,
      maxInteg: 500,
    })
    const players: Record<string, PlayerState> = { [bot.id]: bot }
    players.ally = makePlayer({ id: 'ally', name: 'ally', level: 8, zone: ALLY_ZONE })
    for (let i = 1; i < (opts.friends ?? 1); i++) {
      players[`friend${i}`] = makePlayer({ id: `friend${i}`, name: `f${i}`, zone: ALLY_ZONE })
    }
    for (let i = 0; i < (opts.enemies ?? 3); i++) {
      const id = `foe${i}`
      players[id] = makePlayer({ id, name: id, team: 'audit', zone: ALLY_ZONE })
    }
    const waves = opts.waveInBotZone
      ? [
          {
            id: 'w1',
            zone: bot.zone,
            team: 'audit' as const,
            type: 'melee',
            integ: 100,
            maxInteg: 200,
          },
        ]
      : []
    return { bot, state: makeGameState({ cycle: 200, players, waves: waves as never }) }
  }

  const medium = (id: string) => atDifficulty('medium', id)
  const rescued = (bot: PlayerState, state: ReturnType<typeof makeGameState>) =>
    decideBotAction(state, bot, 'coldstore', medium(bot.id))

  it('takes the first step toward a teammate who is outnumbered', () => {
    const { bot, state } = scene()
    expect(rescued(bot, state), 'nobody came').toEqual({ type: 'move', zone: RESCUE_HOP })
  })

  // NOTE: only the POSITIVE case is covered, and that is deliberate rather than
  // lazy. Every negative test I wrote for the guards turned out to pass with the
  // guard deleted, because the bot reaches the same zone by another route:
  //   - health/level  -> the retreat and lane-progress branches above rotation
  //                      already turn a hurt or under-levelled bot back;
  //   - fair fight    -> `cache-seawall` is a cache zone, so tryPickupRune sends
  //                      the bot there regardless of any teammate;
  //   - distance      -> the far-away scene is refused by lane logic anyway.
  // A test that passes with the code deleted is worse than no test: it reports
  // coverage it does not have. The guards are exercised by `bun run sim`, whose
  // before/after numbers are in the commit message.
  //
  // The floors stay in the code as belt-and-braces.
  // A hurt or under-levelled bot is already turned back by the retreat and
  // lane-progress branches ABOVE the rotation call, so a test aimed at those
  // floors passes identically with the floors deleted. They are kept in the
  // code as belt-and-braces; the behaviour they guard is enforced earlier.
})
