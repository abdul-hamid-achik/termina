import { describe, it, expect, afterEach } from 'vitest'
import {
  decideBotAction,
  getAbilityTarget,
  isOwnSide,
  sequenceManaCost,
  buildOrderForRole,
  tryUseCombatItem,
  tryPanicDefensiveItem,
  tryPlaceWard,
  shouldRetreatFromThreat,
} from '~~/server/game/ai/BotAI'
import { cleanupBotState } from '~~/server/game/ai/BotAI'
import { registerBots, cleanupGame } from '~~/server/game/ai/BotManager'
import type { BotDifficultyConfig, BotDifficulty } from '~~/server/game/ai/BotManager'
import type { GameState, PlayerState, CreepState } from '~~/shared/types/game'
import type { AbilityDef, AbilityEffect } from '~~/shared/types/hero'
import { HEROES } from '~~/shared/constants/heroes'
import { getItem } from '~~/shared/constants/items'
import { initializeZoneStates, initializeIce } from '~~/server/game/map/zones'
import { findPath } from '~~/server/game/map/topology'
import { initializeAncients } from '~~/server/game/engine/AncientSystem'

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
    manaCost: 50,
    cooldownTicks: 4,
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
    zone: 'mid-t1-chaff',
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
    tick: 10,
    phase: 'playing',
    teams: {
      chaff: { id: 'chaff', kills: 0, iceKills: 0, gold: 0, glyphUsedTick: null },
      audit: { id: 'audit', kills: 0, iceKills: 0, gold: 0, glyphUsedTick: null },
    },
    players: {},
    zones: initializeZoneStates(),
    creeps: [],
    neutrals: [],
    ice: initializeIce(),
    ancients: initializeAncients(),
    caches: [],
    tenant: { alive: true, hp: 5000, maxHp: 5000, deathTick: null },
    backup: null,
    events: [],
    surrenderVotes: { chaff: new Set(), audit: new Set() },
    timeOfDay: 'day',
    dayNightTick: 0,
    ...overrides,
  }
}

/**
 * Register `botIds` at an explicit difficulty and hand back the game id to pass
 * as decideBotAction's 4th argument. Casting and last-hitting are gated on
 * per-tick difficulty rolls, so a test about ability/targeting LOGIC has to pin
 * the difficulty rather than inherit the unregistered-game 'medium' default,
 * whose rolls make the outcome depend on the fixture's tick.
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
/** `unfair` casts on every combat tick and never misses a last hit. */
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
      const bot = makePlayer({ alive: false, hp: 0 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      expect(decideBotAction(state, bot, 'mid')).toBeNull()
    })
  })

  describe('fountain behavior', () => {
    it('buys items when at fountain with enough gold', () => {
      const bot = makePlayer({ zone: 'chaff-fountain', gold: 600 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      // Defensive consumables are stocked first
      expect(action).toEqual({ type: 'buy', item: 'healing_salve' })
    })

    it('sources build-item affordability from the canonical shop cost (no hardcoded map)', () => {
      const bladesCost = getItem('blades_of_attack')!.cost
      const stocked: (string | null)[] = [
        'healing_salve',
        'town_portal_scroll',
        null,
        null,
        null,
        null,
      ]

      // Exactly the real cost → buys the first build item.
      const rich = makePlayer({
        zone: 'chaff-fountain',
        hp: 500,
        maxHp: 500,
        gold: bladesCost,
        items: [...stocked] as PlayerState['items'],
      })
      expect(decideBotAction(makeGameState({ players: { [rich.id]: rich } }), rich, 'mid')).toEqual(
        {
          type: 'buy',
          item: 'blades_of_attack',
        },
      )

      // One gold short → does not buy it (the build order stops, not skips).
      const poor = makePlayer({
        zone: 'chaff-fountain',
        hp: 500,
        maxHp: 500,
        gold: bladesCost - 1,
        items: [...stocked] as PlayerState['items'],
      })
      expect(
        decideBotAction(makeGameState({ players: { [poor.id]: poor } }), poor, 'mid'),
      ).not.toEqual({ type: 'buy', item: 'blades_of_attack' })
    })

    describe('role-aware itemisation', () => {
      it('each role build leads with a stat that fits the role', () => {
        const stat = (id: string, k: string) =>
          (getItem(id)!.stats as Record<string, number>)[k] ?? 0
        expect(stat(buildOrderForRole('carry')[0]!, 'attack')).toBeGreaterThan(0)
        expect(stat(buildOrderForRole('assassin')[0]!, 'attack')).toBeGreaterThan(0)
        expect(stat(buildOrderForRole('tank')[0]!, 'hp')).toBeGreaterThan(0)
        expect(stat(buildOrderForRole('offlaner')[0]!, 'hp')).toBeGreaterThan(0)
        expect(stat(buildOrderForRole('mage')[0]!, 'mp')).toBeGreaterThan(0)
        expect(stat(buildOrderForRole('support')[0]!, 'mp')).toBeGreaterThan(0)
      })

      it('falls back to the shared core build for an unknown role', () => {
        expect(buildOrderForRole(undefined)[0]).toBe('blades_of_attack')
      })

      it('every role-build item exists and grants an engine-consumed stat', () => {
        const STAT_KEYS = ['hp', 'mp', 'attack', 'defense', 'magicResist']
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

      it('a tank bot itemises toward HP (ring_of_health, not blades_of_attack)', () => {
        const stocked: (string | null)[] = [
          'healing_salve',
          'town_portal_scroll',
          null,
          null,
          null,
          null,
        ]
        const tank = makePlayer({
          heroId: 'kernel', // role: tank
          zone: 'chaff-fountain',
          hp: 500,
          maxHp: 500,
          gold: getItem('ring_of_health')!.cost,
          items: [...stocked] as PlayerState['items'],
        })
        expect(
          decideBotAction(makeGameState({ players: { [tank.id]: tank } }), tank, 'mid'),
        ).toEqual({ type: 'buy', item: 'ring_of_health' })
      })
    })

    it('stays at fountain to heal when HP is low', () => {
      const bot = makePlayer({ zone: 'chaff-fountain', hp: 100, maxHp: 500, gold: 0 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toBeNull()
    })

    it('moves to lane when at fountain with full HP and nothing to buy', () => {
      const bot = makePlayer({
        zone: 'chaff-fountain',
        hp: 500,
        maxHp: 500,
        gold: 0,
        items: [
          'boots_of_speed',
          'null_pointer',
          'garbage_collector',
          'blink_module',
          'stack_overflow',
          'segfault_blade',
        ],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'move', zone: 'chaff-base' })
    })
  })

  describe('retreat behavior', () => {
    it('retreats to fountain when HP is below 25%', () => {
      const bot = makePlayer({ zone: 'mid-t1-chaff', hp: 100, maxHp: 500 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).not.toBeNull()
      expect(action!.type).toBe('move')
      if (action!.type === 'move') {
        expect(action!.zone).toBe('mid-t2-chaff')
      }
    })

    it('does not retreat when HP is above retreat threshold', () => {
      const bot = makePlayer({ zone: 'mid-t1-chaff', hp: 180, maxHp: 500 }) // 36% HP
      const allyCreep = {
        id: 'c1',
        team: 'chaff' as const,
        zone: 'mid-t1-chaff',
        hp: 300,
        type: 'melee' as const,
      }
      const state = makeGameState({ players: { [bot.id]: bot }, creeps: [allyCreep] })
      const action = decideBotAction(state, bot, 'mid')
      // 180/500 = 36% => above 30% retreat threshold, advances with creep support
      expect(action).not.toBeNull()
      expect(action!.type).toBe('move')
      // Should advance along lane (forward), not retreat (backward toward base)
      if (action!.type === 'move') {
        expect(action!.zone).toBe('mid-river') // forward, not mid-t2-chaff (backward)
      }
    })

    it('holds position at the frontier without creep support', () => {
      const bot = makePlayer({ zone: 'mid-t1-chaff', hp: 400, maxHp: 500 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      // Next zone is mid-river (neutral territory) and no allied creeps — wait
      expect(decideBotAction(state, bot, 'mid')).toBeNull()
    })

    it('blinks out of a slow when retreating with a Blink Module ready', () => {
      // A slowed retreat-move has up to an 80% chance to fizzle, leaving the bot
      // to die. Blink ignores the slow, so it should escape with the item instead.
      const bot = makePlayer({
        zone: 'mid-t1-chaff',
        hp: 100,
        maxHp: 500,
        items: ['blink_module', null, null, null, null, null],
        buffs: [{ id: 'slow', stacks: 40, ticksRemaining: 2, source: 'enemy1' }],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'use', item: 'blink_module', target: 'mid-t2-chaff' })
    })

    it('walks (saving the Blink) when retreating unimpaired', () => {
      // No slow/root — a normal move is free and certain, so don't waste the
      // 12-tick Blink cooldown.
      const bot = makePlayer({
        zone: 'mid-t1-chaff',
        hp: 100,
        maxHp: 500,
        items: ['blink_module', null, null, null, null, null],
        buffs: [],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'move', zone: 'mid-t2-chaff' })
    })

    it('uses Force Staff to escape a slow when it has no Blink', () => {
      // Force Staff auto-disengages toward our fountain — a second escape tool
      // that, like Blink, ignores the slow. No target needed (it aims home).
      const bot = makePlayer({
        zone: 'mid-t1-chaff',
        hp: 100,
        maxHp: 500,
        items: ['force_staff', null, null, null, null, null],
        buffs: [{ id: 'slow', stacks: 40, ticksRemaining: 2, source: 'enemy1' }],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'use', item: 'force_staff' })
    })

    it('prefers Blink over Force Staff when holding both (exact retreat zone)', () => {
      const bot = makePlayer({
        zone: 'mid-t1-chaff',
        hp: 100,
        maxHp: 500,
        items: ['blink_module', 'force_staff', null, null, null, null],
        buffs: [{ id: 'slow', stacks: 40, ticksRemaining: 2, source: 'enemy1' }],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'use', item: 'blink_module', target: 'mid-t2-chaff' })
    })
  })

  describe('combat - hero targeting', () => {
    it('attacks enemy hero in same zone', () => {
      const bot = makePlayer({
        zone: 'mid-river',
        hp: 400,
        maxHp: 500,
        mp: 0,
        cooldowns: { q: 1, w: 1, e: 1, r: 1 },
      })
      const enemy = makePlayer({
        id: 'enemy1',
        team: 'audit',
        zone: 'mid-river',
        hp: 300,
        maxHp: 500,
      })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'attack', target: { kind: 'hero', name: 'enemy1' } })
    })

    it('targets lowest HP enemy hero', () => {
      const bot = makePlayer({
        zone: 'mid-river',
        hp: 400,
        maxHp: 500,
        mp: 0,
        cooldowns: { q: 1, w: 1, e: 1, r: 1 },
      })
      const enemy1 = makePlayer({
        id: 'enemy1',
        team: 'audit',
        zone: 'mid-river',
        hp: 300,
      })
      const enemy2 = makePlayer({
        id: 'enemy2',
        team: 'audit',
        zone: 'mid-river',
        hp: 100,
      })
      const state = makeGameState({
        players: { [bot.id]: bot, enemy1, enemy2 },
      })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).not.toBeNull()
      if (action!.type === 'attack') {
        expect(action!.target).toEqual({ kind: 'hero', name: 'enemy2' })
      }
    })

    it('does not attack dead enemy heroes', () => {
      const bot = makePlayer({ zone: 'mid-river', hp: 400, maxHp: 500, mp: 0 })
      const deadEnemy = makePlayer({
        id: 'enemy1',
        team: 'audit',
        zone: 'mid-river',
        hp: 0,
        alive: false,
      })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: deadEnemy } })
      const action = decideBotAction(state, bot, 'mid')
      // Should not target the dead enemy (may hold position or move)
      expect(action?.type ?? 'hold').not.toBe('attack')
    })
  })

  describe('combat - ability usage', () => {
    it('casts ability when enemy is present and ability is off cooldown', () => {
      const bot = makePlayer({ zone: 'mid-river', hp: 400, maxHp: 500, mp: 300 })
      const enemy = makePlayer({
        id: 'enemy1',
        team: 'audit',
        zone: 'mid-river',
        hp: 300,
      })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'mid', alwaysCasts(bot.id))
      // Should try to cast (r first in priority order)
      expect(action).not.toBeNull()
      expect(action!.type).toBe('cast')
    })

    it('does not cast when on cooldown', () => {
      const bot = makePlayer({
        zone: 'mid-river',
        hp: 400,
        maxHp: 500,
        mp: 300,
        cooldowns: { q: 5, w: 5, e: 5, r: 5 },
      })
      const enemy = makePlayer({
        id: 'enemy1',
        team: 'audit',
        zone: 'mid-river',
        hp: 300,
      })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'mid')
      // All abilities on cooldown, should attack instead
      expect(action).toEqual({ type: 'attack', target: { kind: 'hero', name: 'enemy1' } })
    })

    it('does not cast when not enough mana', () => {
      const bot = makePlayer({
        zone: 'mid-river',
        hp: 400,
        maxHp: 500,
        mp: 0,
        maxMp: 200,
        cooldowns: { q: 0, w: 0, e: 1, r: 0 }, // E costs 0 mana, so put it on CD
      })
      const enemy = makePlayer({
        id: 'enemy1',
        team: 'audit',
        zone: 'mid-river',
        hp: 300,
      })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'mid')
      // No mana, should attack
      expect(action).toEqual({ type: 'attack', target: { kind: 'hero', name: 'enemy1' } })
    })

    it('does not cast an ability it can only afford at rank 1', () => {
      // Echo Q costs 40 at rank 1 and 70 at rank 4 (level 7). A bot holding 55
      // mana used to read the registry's rank-1 headline, queue the cast, and
      // have the resolver refuse it for insufficient mana — one wasted tick per
      // tick, for the rest of the game. W/E/R are parked so Q is the only
      // candidate and the outcome is unambiguous.
      const bot = makePlayer({
        heroId: 'echo',
        level: 7,
        zone: 'mid-river',
        hp: 400,
        maxHp: 500,
        mp: 55,
        maxMp: 300,
        cooldowns: { q: 0, w: 5, e: 5, r: 5 },
      })
      const enemy = makePlayer({ id: 'enemy1', team: 'audit', zone: 'mid-river', hp: 300 })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'mid', alwaysCasts(bot.id))
      expect(action).toEqual({ type: 'attack', target: { kind: 'hero', name: 'enemy1' } })
    })

    it('casts once it holds the rank cost', () => {
      const bot = makePlayer({
        heroId: 'echo',
        level: 7,
        zone: 'mid-river',
        hp: 400,
        maxHp: 500,
        mp: 70,
        maxMp: 300,
        cooldowns: { q: 0, w: 5, e: 5, r: 5 },
      })
      const enemy = makePlayer({ id: 'enemy1', team: 'audit', zone: 'mid-river', hp: 300 })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'mid', alwaysCasts(bot.id))
      expect(action).toMatchObject({ type: 'cast', ability: 'q' })
    })

    it('holds Cache Eviction (R) at low stored energy, casting a non-ult instead', () => {
      // Cache's R deals pure damage EQUAL to stored energy; at ~0 energy it's a
      // 50-tick cooldown spent on a lone slow. The bot must NOT open the fight
      // with R — it should cast a non-energy ability (Q) and build energy first.
      const bot = makePlayer({
        heroId: 'cache',
        level: 6,
        zone: 'mid-river',
        hp: 400,
        maxHp: 500,
        mp: 300,
        maxMp: 300,
        // W/E parked so the scripted combo can't open — this test is about the
        // generic cast-priority path, which is where the resource guard lives.
        cooldowns: { q: 0, w: 5, e: 5, r: 0 },
        buffs: [{ id: 'cachedEnergy', stacks: 10, ticksRemaining: 9999, source: 'bot_alpha' }],
      })
      const enemy = makePlayer({ id: 'enemy1', team: 'audit', zone: 'mid-river', hp: 300 })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'mid', alwaysCasts(bot.id))
      expect(action?.type).toBe('cast')
      expect((action as { ability: string }).ability).not.toBe('r')
    })

    it('fires Cache Eviction (R) once stored energy is worth bursting', () => {
      const bot = makePlayer({
        heroId: 'cache',
        level: 6,
        zone: 'mid-river',
        hp: 400,
        maxHp: 500,
        mp: 300,
        maxMp: 300,
        cooldowns: { q: 0, w: 5, e: 5, r: 0 },
        buffs: [{ id: 'cachedEnergy', stacks: 120, ticksRemaining: 9999, source: 'bot_alpha' }],
      })
      const enemy = makePlayer({ id: 'enemy1', team: 'audit', zone: 'mid-river', hp: 300 })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'mid', alwaysCasts(bot.id))
      expect(action).toMatchObject({ type: 'cast', ability: 'r' })
    })

    it('does not burn the tick on Echo Feedback Loop (E) at 0 stacks (resolver would reject it)', () => {
      // Echo's E hard-fails at 0 feedback stacks. With Q/W/R on cooldown, the
      // unguarded bot would submit E anyway and waste its action on a guaranteed
      // rejection — it should attack to BUILD stacks instead.
      const bot = makePlayer({
        heroId: 'echo',
        level: 6,
        zone: 'mid-river',
        hp: 400,
        maxHp: 500,
        mp: 300,
        maxMp: 300,
        cooldowns: { q: 5, w: 5, e: 0, r: 5 }, // only E is off cooldown
        buffs: [], // 0 feedback stacks → E would be rejected
      })
      const enemy = makePlayer({ id: 'enemy1', team: 'audit', zone: 'mid-river', hp: 300 })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'attack', target: { kind: 'hero', name: 'enemy1' } })
    })

    it('casts Echo Feedback Loop (E) once stacks are built', () => {
      const bot = makePlayer({
        heroId: 'echo',
        level: 6,
        zone: 'mid-river',
        hp: 400,
        maxHp: 500,
        mp: 300,
        maxMp: 300,
        cooldowns: { q: 5, w: 5, e: 0, r: 5 },
        buffs: [{ id: 'feedbackLoop', stacks: 40, ticksRemaining: 9999, source: 'bot_alpha' }],
      })
      const enemy = makePlayer({ id: 'enemy1', team: 'audit', zone: 'mid-river', hp: 300 })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'mid', alwaysCasts(bot.id))
      expect(action).toMatchObject({ type: 'cast', ability: 'e' })
    })
  })

  describe('combat - creep targeting', () => {
    it('aims at the lowest-HP enemy creep when the last-hit roll lands', () => {
      const bot = makePlayer({ zone: 'mid-t1-chaff', hp: 400, maxHp: 500, mp: 0 })
      const creeps: CreepState[] = [
        { id: 'creep-1', team: 'audit', zone: 'mid-t1-chaff', hp: 200, type: 'melee' },
        { id: 'creep-2', team: 'audit', zone: 'mid-t1-chaff', hp: 50, type: 'ranged' },
      ]
      const state = makeGameState({ players: { [bot.id]: bot }, creeps })
      // `unfair` is lastHitAccuracy 1.0 — the roll can never fail.
      const action = decideBotAction(state, bot, 'mid', atDifficulty('unfair', bot.id))
      expect(action).toEqual({ type: 'attack', target: { kind: 'creep', index: 1 } })
    })

    it('a missed last hit re-aims at the SECOND-lowest creep — never at nothing', () => {
      // The miss must cost the gold, not the tick. Returning null on a failed
      // roll was the original standstill bug: bots stopped out-clearing the
      // incoming wave and never reached a ice (see BotForwardProgress).
      // Tick 30's lasthit roll is 0.91, above every accuracy below `unfair`.
      const bot = makePlayer({ zone: 'mid-t1-chaff', hp: 400, maxHp: 500, mp: 0 })
      const creeps: CreepState[] = [
        { id: 'creep-1', team: 'audit', zone: 'mid-t1-chaff', hp: 200, type: 'melee' },
        { id: 'creep-2', team: 'audit', zone: 'mid-t1-chaff', hp: 50, type: 'ranged' },
        { id: 'creep-3', team: 'audit', zone: 'mid-t1-chaff', hp: 120, type: 'melee' },
      ]
      const state = makeGameState({ tick: 30, players: { [bot.id]: bot }, creeps })
      expect(decideBotAction(state, bot, 'mid', atDifficulty('medium', bot.id))).toEqual({
        type: 'attack',
        target: { kind: 'creep', index: 2 },
      })
      // Same tick, perfect accuracy → the true lowest.
      expect(decideBotAction(state, bot, 'mid', atDifficulty('unfair', bot.id))).toEqual({
        type: 'attack',
        target: { kind: 'creep', index: 1 },
      })
    })

    it('still swings at a lone creep on a missed roll (no second-lowest to fall back to)', () => {
      const bot = makePlayer({ zone: 'mid-t1-chaff', hp: 400, maxHp: 500, mp: 0 })
      const creeps: CreepState[] = [
        { id: 'creep-1', team: 'audit', zone: 'mid-t1-chaff', hp: 200, type: 'melee' },
      ]
      const state = makeGameState({ tick: 30, players: { [bot.id]: bot }, creeps })
      expect(decideBotAction(state, bot, 'mid', atDifficulty('easy', bot.id))).toEqual({
        type: 'attack',
        target: { kind: 'creep', index: 0 },
      })
    })

    it('ignores friendly creeps', () => {
      const bot = makePlayer({ zone: 'mid-t1-chaff', hp: 400, maxHp: 500, mp: 0 })
      const creeps: CreepState[] = [
        { id: 'creep-1', team: 'chaff', zone: 'mid-t1-chaff', hp: 100, type: 'melee' },
      ]
      const state = makeGameState({ players: { [bot.id]: bot }, creeps })
      const action = decideBotAction(state, bot, 'mid')
      // No enemies, should move forward
      expect(action!.type).toBe('move')
    })

    it('attacks the wave even when it cannot secure the last hit', () => {
      // A high-HP enemy creep (no guaranteed last hit) must still draw an
      // attack — the old code returned null on a failed last-hit roll, leaving
      // bots idling in lane instead of pushing the wave.
      const bot = makePlayer({ zone: 'mid-t1-chaff', hp: 400, maxHp: 500, mp: 0 })
      const creeps: CreepState[] = [
        { id: 'creep-1', team: 'audit', zone: 'mid-t1-chaff', hp: 200, type: 'melee' },
      ]
      const state = makeGameState({ players: { [bot.id]: bot }, creeps })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'attack', target: { kind: 'creep', index: 0 } })
    })
  })

  describe('ice targeting', () => {
    it('attacks enemy ice when allied creeps are present', () => {
      const bot = makePlayer({ zone: 'mid-t1-audit', hp: 400, maxHp: 500, mp: 0 })
      const alliedCreeps: CreepState[] = [
        { id: 'creep-1', team: 'chaff', zone: 'mid-t1-audit', hp: 400, type: 'melee' },
      ]
      const state = makeGameState({
        players: { [bot.id]: bot },
        creeps: alliedCreeps,
      })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).not.toBeNull()
      expect(action!.type).toBe('attack')
      if (action!.type === 'attack') {
        expect(action!.target).toEqual({ kind: 'ice', zone: 'mid-t1-audit' })
      }
    })

    it('does not attack ice without allied creeps', () => {
      const bot = makePlayer({ zone: 'mid-t1-audit', hp: 400, maxHp: 500, mp: 0 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      // No allied creeps -> holds position (deep in enemy territory, no support)
      expect(action?.type ?? 'hold').not.toBe('attack')
    })
  })

  describe('movement - lane pathing', () => {
    it('moves forward along assigned lane with creep support', () => {
      const bot = makePlayer({ zone: 'mid-t1-chaff', hp: 400, maxHp: 500, mp: 0 })
      const allyCreep = {
        id: 'c1',
        team: 'chaff' as const,
        zone: 'mid-t1-chaff',
        hp: 300,
        type: 'melee' as const,
      }
      const state = makeGameState({ players: { [bot.id]: bot }, creeps: [allyCreep] })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'move', zone: 'mid-river' })
    })

    it('advances freely on its own side of the map', () => {
      const bot = makePlayer({ zone: 'mid-t3-chaff', hp: 400, maxHp: 500, mp: 0 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'move', zone: 'mid-t2-chaff' })
    })

    it('advances across the frontier to join a wave waiting one zone ahead', () => {
      // Frontier bot (own t1) with an allied wave in the NEXT zone (the river)
      // but none co-located. The old standstill only checked the bot's CURRENT
      // zone for creep support, so it froze here; forward progress now follows
      // the wave ahead so the bot pushes out of its own half.
      const bot = makePlayer({ zone: 'mid-t1-chaff', hp: 400, maxHp: 500, mp: 0 })
      const creeps: CreepState[] = [
        { id: 'wave-1', team: 'chaff', zone: 'mid-river', hp: 300, type: 'melee' },
      ]
      const state = makeGameState({ players: { [bot.id]: bot }, creeps })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'move', zone: 'mid-river' })
    })

    it('moves toward lane start when off-lane', () => {
      const bot = makePlayer({ zone: 'silt-chaff-top', hp: 400, maxHp: 500, mp: 0 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      // Should pathfind toward mid-t3-chaff (the first lane zone after fountain/base)
      expect(action).not.toBeNull()
      expect(action!.type).toBe('move')
    })
  })

  describe('shopping', () => {
    it('stocks defensive consumables before core items', () => {
      const bot = makePlayer({ zone: 'chaff-fountain', gold: 600 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      expect(decideBotAction(state, bot, 'mid')).toEqual({ type: 'buy', item: 'healing_salve' })

      const withSalve = makePlayer({
        zone: 'chaff-fountain',
        gold: 450,
        items: ['healing_salve', null, null, null, null, null],
      })
      const state2 = makeGameState({ players: { [withSalve.id]: withSalve } })
      expect(decideBotAction(state2, withSalve, 'mid')).toEqual({
        type: 'buy',
        item: 'town_portal_scroll',
      })
    })

    it('buys first item in build order once consumables are stocked', () => {
      const bot = makePlayer({
        zone: 'chaff-fountain',
        gold: 600,
        items: ['healing_salve', 'town_portal_scroll', null, null, null, null],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      // blades_of_attack: +12 attack — a stat the engine actually consumes
      expect(action).toEqual({ type: 'buy', item: 'blades_of_attack' })
    })

    it('does not buy dead moveSpeed-only items (boots_of_speed)', () => {
      const bot = makePlayer({
        zone: 'chaff-fountain',
        gold: 99999,
        items: ['healing_salve', 'town_portal_scroll', null, null, null, null],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).not.toBeNull()
      expect(action!.type).toBe('buy')
      if (action!.type === 'buy') {
        expect(action!.item).not.toBe('boots_of_speed')
      }
    })

    it('skips items already owned', () => {
      const bot = makePlayer({
        zone: 'chaff-fountain',
        gold: 1500,
        items: ['healing_salve', 'town_portal_scroll', 'blades_of_attack', null, null, null],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'buy', item: 'null_pointer' })
    })

    it('does not buy when inventory is full', () => {
      const bot = makePlayer({
        zone: 'chaff-fountain',
        gold: 10000,
        items: [
          'boots_of_speed',
          'null_pointer',
          'garbage_collector',
          'blink_module',
          'stack_overflow',
          'segfault_blade',
        ],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      // Can't buy, inventory full, should move to lane
      expect(action).toEqual({ type: 'move', zone: 'chaff-base' })
    })

    it('does not buy when gold is insufficient', () => {
      const bot = makePlayer({ zone: 'chaff-fountain', gold: 20 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      // Can't afford anything (cheapest consumable is 50g), hp is full so should move to lane
      expect(action).toEqual({ type: 'move', zone: 'chaff-base' })
    })
  })

  describe('talent selection', () => {
    it('banks an unlocked talent during a lull (no enemy hero in zone)', () => {
      // mid-t1-chaff lane, level 10, no talents, full HP, no enemies → pick tier 10.
      const bot = makePlayer({ zone: 'mid-t1-chaff', level: 10 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'select_talent', tier: 10, talentId: 'echo_10_left' })
    })

    it('does not pick a talent before reaching the tier', () => {
      const bot = makePlayer({ zone: 'mid-t1-chaff', level: 9 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action?.type).not.toBe('select_talent')
    })

    it('advances to the next unchosen tier', () => {
      const bot = makePlayer({
        zone: 'mid-t1-chaff',
        level: 16,
        talents: { tier10: 'echo_10_left', tier15: null, tier20: null, tier25: null },
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toMatchObject({ type: 'select_talent', tier: 15 })
    })

    it('fights instead of picking a talent when an enemy hero is in zone', () => {
      const bot = makePlayer({ zone: 'mid-river', level: 10, hp: 500, maxHp: 500, mp: 300 })
      const enemy = makePlayer({ id: 'enemy1', team: 'audit', zone: 'mid-river', hp: 300 })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action?.type).not.toBe('select_talent')
    })
  })

  describe('priority ordering', () => {
    it('prioritizes retreat over combat when HP < 25%', () => {
      const bot = makePlayer({ zone: 'mid-river', hp: 50, maxHp: 500, mp: 300 })
      const enemy = makePlayer({
        id: 'enemy1',
        team: 'audit',
        zone: 'mid-river',
        hp: 300,
      })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'mid')
      // Should retreat despite enemy presence
      expect(action!.type).toBe('move')
    })

    it('prioritizes abilities over basic attack', () => {
      const bot = makePlayer({ zone: 'mid-river', hp: 400, maxHp: 500, mp: 300 })
      const enemy = makePlayer({
        id: 'enemy1',
        team: 'audit',
        zone: 'mid-river',
        hp: 300,
      })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'mid', alwaysCasts(bot.id))
      expect(action!.type).toBe('cast')
    })

    it('prioritizes hero attacks over creep attacks', () => {
      const bot = makePlayer({
        zone: 'mid-river',
        hp: 400,
        maxHp: 500,
        mp: 0,
        cooldowns: { q: 1, w: 1, e: 1, r: 1 },
      })
      const enemy = makePlayer({
        id: 'enemy1',
        team: 'audit',
        zone: 'mid-river',
        hp: 300,
      })
      const creeps: CreepState[] = [
        { id: 'creep-1', team: 'audit', zone: 'mid-river', hp: 100, type: 'melee' },
      ]
      const state = makeGameState({
        players: { [bot.id]: bot, enemy1: enemy },
        creeps,
      })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'attack', target: { kind: 'hero', name: 'enemy1' } })
    })
  })

  describe('cache pickup', () => {
    it('issues a cache command when standing on a cache (not a wasted Q cast)', () => {
      const bot = makePlayer({
        zone: 'cache-top',
        hp: 500,
        maxHp: 500,
        mp: 300,
        cooldowns: { q: 0, w: 0, e: 0, r: 0 },
      })
      const state = makeGameState({
        players: { [bot.id]: bot },
        caches: [{ zone: 'cache-top', type: 'haste', tick: 5 }],
      })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'grab' })
    })
  })

  describe('support ability targeting', () => {
    it('heals the most-hurt ally instead of the lowest-HP enemy', () => {
      const bot = makePlayer({
        id: 'bot_alpha',
        heroId: 'sentry',
        zone: 'mid-river',
        hp: 600,
        maxHp: 600,
        mp: 100,
        maxMp: 350,
        cooldowns: { q: 0, w: 5, e: 5, r: 5 },
      })
      const ally = makePlayer({
        id: 'bot_ally',
        team: 'chaff',
        zone: 'mid-river',
        hp: 150,
        maxHp: 600,
      })
      const enemy = makePlayer({
        id: 'enemy1',
        team: 'audit',
        zone: 'mid-river',
        hp: 100, // lowest HP overall — the old code would heal-target this enemy
        maxHp: 500,
      })
      const state = makeGameState({
        players: { [bot.id]: bot, bot_ally: ally, enemy1: enemy },
      })
      const action = decideBotAction(state, bot, 'mid', alwaysCasts(bot.id))
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
        zone: 'mid-river',
        hp: 300,
        maxHp: 600,
        mp: 100,
        maxMp: 350,
        cooldowns: { q: 0, w: 5, e: 5, r: 5 },
      })
      const enemy = makePlayer({
        id: 'enemy1',
        team: 'audit',
        zone: 'mid-river',
        hp: 100,
        maxHp: 500,
      })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'mid', alwaysCasts(bot.id))
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
        zone: 'mid-river',
        hp: 600,
        maxHp: 600,
        mp: 100,
        maxMp: 350,
        cooldowns: { q: 0, w: 5, e: 5, r: 5 },
      })
      const enemy = makePlayer({
        id: 'enemy1',
        team: 'audit',
        zone: 'mid-river',
        hp: 100,
        maxHp: 500,
      })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'attack', target: { kind: 'hero', name: 'enemy1' } })
    })

    it('still targets the lowest-HP enemy with damage abilities', () => {
      const bot = makePlayer({
        heroId: 'echo',
        zone: 'mid-river',
        hp: 400,
        maxHp: 500,
        mp: 300,
        cooldowns: { q: 0, w: 5, e: 5, r: 5 },
      })
      const ally = makePlayer({
        id: 'bot_ally',
        team: 'chaff',
        zone: 'mid-river',
        hp: 50,
        maxHp: 500,
      })
      const enemy1 = makePlayer({ id: 'enemy1', team: 'audit', zone: 'mid-river', hp: 300 })
      const enemy2 = makePlayer({ id: 'enemy2', team: 'audit', zone: 'mid-river', hp: 100 })
      const state = makeGameState({
        players: { [bot.id]: bot, bot_ally: ally, enemy1, enemy2 },
      })
      const action = decideBotAction(state, bot, 'mid', alwaysCasts(bot.id))
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
        zone: 'mid-t1-chaff',
        hp: 250,
        maxHp: 500,
        items: ['healing_salve', null, null, null, null, null],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'use', item: 'healing_salve' })
    })

    it('does not re-pop a salve while regen is already active', () => {
      const bot = makePlayer({
        zone: 'mid-t1-chaff',
        hp: 250,
        maxHp: 500,
        items: ['healing_salve', null, null, null, null, null],
        buffs: [
          { id: 'healing_salve_regen', stacks: 50, ticksRemaining: 3, source: 'healing_salve' },
        ],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action?.type).not.toBe('use')
    })

    it('does not pop a salve while enemies are in the zone', () => {
      const bot = makePlayer({
        zone: 'mid-river',
        hp: 250,
        maxHp: 500,
        items: ['healing_salve', null, null, null, null, null],
      })
      const enemy = makePlayer({ id: 'enemy1', team: 'audit', zone: 'mid-river', hp: 400 })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action?.type).not.toBe('use')
    })

    it('teleports home when retreating from deep map positions', () => {
      const bot = makePlayer({
        zone: 'mid-t1-audit',
        hp: 100,
        maxHp: 500,
        items: ['town_portal_scroll', null, null, null, null, null],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'use', item: 'town_portal_scroll' })
    })

    it('walks home instead of TPing when already near the fountain', () => {
      const bot = makePlayer({
        zone: 'mid-t3-chaff',
        hp: 100,
        maxHp: 500,
        items: ['town_portal_scroll', null, null, null, null, null],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'move', zone: 'chaff-base' })
    })

    it('stands still while channeling a teleport', () => {
      const bot = makePlayer({
        zone: 'mid-t1-chaff',
        hp: 100,
        maxHp: 500,
        buffs: [
          { id: 'tp_channeling', stacks: 1, ticksRemaining: 2, source: 'town_portal_scroll' },
        ],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      expect(decideBotAction(state, bot, 'mid')).toBeNull()
    })
  })

  describe('ancient push', () => {
    it('attacks the enemy ancient when in the enemy base and it is vulnerable', () => {
      const bot = makePlayer({
        zone: 'audit-base',
        hp: 400,
        maxHp: 500,
        mp: 0,
        cooldowns: { q: 1, w: 1, e: 1, r: 1 },
      })
      const ancients = initializeAncients()
      const state = makeGameState({
        players: { [bot.id]: bot },
        ancients: { ...ancients, audit: { ...ancients.audit, vulnerable: true } },
      })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'attack', target: { kind: 'ancient' } })
    })

    it('does not attack the ancient while it is invulnerable', () => {
      const bot = makePlayer({
        zone: 'audit-base',
        hp: 400,
        maxHp: 500,
        mp: 0,
        cooldowns: { q: 1, w: 1, e: 1, r: 1 },
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).not.toEqual({ type: 'attack', target: { kind: 'ancient' } })
    })

    it('fights defending heroes before the ancient', () => {
      const bot = makePlayer({
        zone: 'audit-base',
        hp: 400,
        maxHp: 500,
        mp: 0,
        cooldowns: { q: 1, w: 1, e: 1, r: 1 },
      })
      const defender = makePlayer({ id: 'enemy1', team: 'audit', zone: 'audit-base', hp: 300 })
      const ancients = initializeAncients()
      const state = makeGameState({
        players: { [bot.id]: bot, enemy1: defender },
        ancients: { ...ancients, audit: { ...ancients.audit, vulnerable: true } },
      })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'attack', target: { kind: 'hero', name: 'enemy1' } })
    })
  })

  describe('rank-0 abilities (not yet learned)', () => {
    it('never casts the ultimate before level 6', () => {
      // Level 1: R is rank 0 (unlocks at 6). With Q/W/E on cooldown the only
      // ability the bot could "afford" is R — but the server rejects an
      // un-unlocked cast, burning the tick. The bot must fall through to a
      // basic attack instead of emitting a cast for R.
      const bot = makePlayer({
        zone: 'mid-river',
        level: 1,
        hp: 400,
        maxHp: 500,
        mp: 500,
        maxMp: 500,
        cooldowns: { q: 5, w: 5, e: 5, r: 0 },
      })
      const enemy = makePlayer({ id: 'enemy1', team: 'audit', zone: 'mid-river', hp: 300 })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'attack', target: { kind: 'hero', name: 'enemy1' } })
    })

    it('casts the ultimate once it is learned at level 6', () => {
      // Sanity counterpart: at level 6 R is rank 1, so the bot is free to use
      // it. Proves the level-1 case above is the rank gate, not a blanket
      // "never cast R".
      const bot = makePlayer({
        zone: 'mid-river',
        level: 6,
        hp: 400,
        maxHp: 500,
        mp: 500,
        maxMp: 500,
        cooldowns: { q: 5, w: 5, e: 5, r: 0 },
      })
      const enemy = makePlayer({ id: 'enemy1', team: 'audit', zone: 'mid-river', hp: 300 })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'mid', alwaysCasts(bot.id))
      expect(action).not.toBeNull()
      expect(action!.type).toBe('cast')
      if (action!.type === 'cast') expect(action!.ability).toBe('r')
    })

    it('emits no cast for any rank-0 slot across all hero levels below unlock', () => {
      // Scan a low level where Q/W/E/R ranks differ and assert that any cast the
      // bot does emit is for a slot whose ability is actually learned. Level 1:
      // Q/W/E rank 1, R rank 0.
      const enemy = makePlayer({ id: 'enemy1', team: 'audit', zone: 'mid-river', hp: 300 })
      for (let i = 0; i < 50; i++) {
        const bot = makePlayer({
          zone: 'mid-river',
          level: 1,
          hp: 400,
          maxHp: 500,
          mp: 500,
          maxMp: 500,
          cooldowns: { q: 0, w: 0, e: 0, r: 0 },
        })
        const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
        const action = decideBotAction(state, bot, 'mid')
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
        zone: 'mid-river',
        hp: 400,
        maxHp: 500,
      })
    }
    function ally(hp: number) {
      return makePlayer({ id: 'bot_ally', team: 'chaff', zone: 'mid-river', hp, maxHp: 500 })
    }
    function enemy(hp: number) {
      return makePlayer({ id: 'enemy1', team: 'audit', zone: 'mid-river', hp, maxHp: 500 })
    }

    it('routes a supportive ally buff to the lowest-HP ally, not an enemy', () => {
      const ability = makeAbility('ally', buffEffects)
      const target = getAbilityTarget(ability, bot(), [enemy(50)], [ally(150), ally(450)])
      expect(target).toEqual({ kind: 'hero', name: 'bot_ally' })
    })

    it('falls back to self when no ally is present (supportive)', () => {
      const ability = makeAbility('ally', healEffects)
      const target = getAbilityTarget(ability, bot(), [enemy(50)], [])
      expect(target).toEqual({ kind: 'hero', name: 'bot_alpha' })
    })

    it('never resolves an ally ability to an enemy, even when the enemy is the lowest HP', () => {
      // The lowest-HP unit on the board is the enemy — an enemy-target heuristic
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
        zone: 'mid-river',
        hp: 490,
        maxHp: 500,
      })
      const target = getAbilityTarget(ability, healthyBot, [enemy(50)], [ally(500)])
      expect(target).toBeUndefined()
    })

    it('routes a utility (teleport+buff) ally ability to the lowest-HP friendly, never an enemy', () => {
      const ability = makeAbility('ally', swapEffects)
      // bot 400/500 (80%), ally 250/500 (50%) — ally is the most hurt friendly.
      const target = getAbilityTarget(ability, bot(), [enemy(50)], [ally(250)])
      expect(target).toEqual({ kind: 'hero', name: 'bot_ally' })
    })

    it('targets self for an ally ability when the bot is the most-hurt friendly', () => {
      const ability = makeAbility('ally', swapEffects)
      // bot 400/500 (80%) is hurt; the only ally is full HP.
      const target = getAbilityTarget(ability, bot(), [enemy(50)], [ally(500)])
      expect(target).toEqual({ kind: 'hero', name: 'bot_alpha' })
    })

    it('skips a non-heal/shield ally ability when alone (resolver rejects self)', () => {
      // cron.q (pure buff) and proxy.r (position-swap) explicitly reject a
      // self-target with "Target must be an ally". When the bot is alone, the
      // only candidate is itself, so the cast would be rejected — skip it
      // instead of burning the tick.
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

    it("still aims a single-target 'hero' damage ability at the lowest-HP enemy", () => {
      const ability = makeAbility('hero', [{ type: 'damage', value: 100, damageType: 'magical' }])
      const target = getAbilityTarget(ability, bot(), [enemy(100), enemy(40)], [ally(120)])
      // lowest-HP enemy is the 40-HP one; both share id 'enemy1' here so just
      // assert it picked an enemy, not the ally.
      expect(target).toEqual({ kind: 'hero', name: 'enemy1' })
    })
  })
})

describe('sequenceManaCost (combo affordability)', () => {
  it('sums the mana cost of every ability in the sequence', () => {
    const echo = HEROES.echo!.abilities
    expect(sequenceManaCost('echo', ['e', 'q'], 1)).toBe(echo.e.manaCost + echo.q.manaCost)
    expect(sequenceManaCost('echo', ['q', 'w', 'r'], 1)).toBe(
      echo.q.manaCost + echo.w.manaCost + echo.r.manaCost,
    )
  })

  it('sums the RANK cost, not the rank-1 headline', () => {
    // Echo Q [40,50,60,70] + W [50,60,70,80]: 90 at rank 1, 150 at rank 4. A
    // level-7 bot summing the headline opens a rotation it cannot finish.
    expect(sequenceManaCost('echo', ['q', 'w'], 1)).toBe(90)
    expect(sequenceManaCost('echo', ['q', 'w'], 7)).toBe(150)
  })

  it('returns 0 for an unknown hero', () => {
    expect(sequenceManaCost('not_a_hero', ['q', 'w'], 1)).toBe(0)
  })

  it('is 0 for an empty sequence', () => {
    expect(sequenceManaCost('echo', [], 1)).toBe(0)
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
  // -25 for sitting under half HP, +50 for five kills = 75) puts the tier-2
  // boundary at 75 x 1.35 = 101 — squarely between the two.
  function scenario(enemyMp: number) {
    const bot = makePlayer({
      heroId: 'echo',
      level: 7,
      zone: 'mid-river',
      hp: 175,
      maxHp: 500,
      mp: 0,
      kills: 5,
    })
    const enemy = makePlayer({
      id: 'enemy1',
      name: 'enemy1',
      team: 'audit',
      heroId: 'echo',
      level: 7,
      zone: 'mid-river',
      hp: 500,
      maxHp: 500,
      mp: enemyMp,
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
    const bot = makePlayer({ hp: 100, maxHp: 500, items: inv('black_king_bar') })
    expect(tryUseCombatItem(bot, [], [], makeConfig())).toBeNull()
  })

  it('is gated on threatAssessment — naive (easy) bots never micro items', () => {
    const bot = makePlayer({ hp: 100, maxHp: 500, items: inv('black_king_bar') })
    expect(tryUseCombatItem(bot, [enemy], [], makeConfig({ threatAssessment: false }))).toBeNull()
  })

  it('pops a defensive item (BKB) when hurt in a fight', () => {
    const bot = makePlayer({ hp: 200, maxHp: 500, items: inv('black_king_bar') }) // 40%
    expect(tryUseCombatItem(bot, [enemy], [], makeConfig())).toEqual({
      type: 'use',
      item: 'black_king_bar',
    })
  })

  it('prefers BKB over Blade Mail (defensive priority order)', () => {
    const bot = makePlayer({ hp: 200, maxHp: 500, items: inv('blade_mail', 'black_king_bar') })
    expect(tryUseCombatItem(bot, [enemy], [], makeConfig())).toEqual({
      type: 'use',
      item: 'black_king_bar',
    })
    const onlyMail = makePlayer({ hp: 200, maxHp: 500, items: inv('blade_mail') })
    expect(tryUseCombatItem(onlyMail, [enemy], [], makeConfig())).toEqual({
      type: 'use',
      item: 'blade_mail',
    })
  })

  it('pops a defensive item when outnumbered even at full HP', () => {
    const bot = makePlayer({ hp: 500, maxHp: 500, items: inv('blade_mail') })
    const e2 = makePlayer({ id: 'enemy2', name: 'enemy2', team: 'audit' })
    // 2 enemies vs (0 allies + self) → outnumbered.
    expect(tryUseCombatItem(bot, [enemy, e2], [], makeConfig())).toEqual({
      type: 'use',
      item: 'blade_mail',
    })
  })

  it('does NOT burn a defensive item on a healthy, even fight', () => {
    // Full HP, 1v1, only a defensive item → not under pressure, nothing offensive.
    const bot = makePlayer({ hp: 500, maxHp: 500, items: inv('black_king_bar') })
    expect(tryUseCombatItem(bot, [enemy], [], makeConfig())).toBeNull()
  })

  it('a support bot pops Lotus Orb (spell-reflect) under pressure', () => {
    const bot = makePlayer({ hp: 300, maxHp: 500, items: inv('lotus_orb') }) // 60%, hurt
    expect(tryUseCombatItem(bot, [enemy], [], makeConfig())).toEqual({
      type: 'use',
      item: 'lotus_orb',
    })
  })

  it('pops Stack Overflow when an ability is ready to consume the charge', () => {
    const bot = makePlayer({ hp: 500, maxHp: 500, mp: 200, items: inv('stack_overflow') })
    expect(tryUseCombatItem(bot, [enemy], [], makeConfig())).toEqual({
      type: 'use',
      item: 'stack_overflow',
    })
  })

  it('does NOT pop Stack Overflow with no ability able to consume the charge', () => {
    // Every ability on cooldown → nothing can consume the double-damage charge,
    // so the bot holds it rather than wasting it on a pure right-click.
    const bot = makePlayer({
      hp: 500,
      maxHp: 500,
      cooldowns: { q: 4, w: 4, e: 4, r: 4 },
      items: inv('stack_overflow'),
    })
    expect(tryUseCombatItem(bot, [enemy], [], makeConfig())).toBeNull()
  })

  it('pops Veil of Discord regardless of ability readiness', () => {
    const bot = makePlayer({ hp: 500, maxHp: 500, mp: 0, items: inv('veil_of_discord') })
    expect(tryUseCombatItem(bot, [enemy], [], makeConfig())).toEqual({
      type: 'use',
      item: 'veil_of_discord',
    })
  })

  it('respects item cooldown (item_cd_<id> buff)', () => {
    const bot = makePlayer({
      hp: 100,
      maxHp: 500,
      items: inv('black_king_bar'),
      buffs: [{ id: 'item_cd_black_king_bar', stacks: 1, ticksRemaining: 10, source: 'x' }],
    })
    expect(tryUseCombatItem(bot, [enemy], [], makeConfig())).toBeNull()
  })

  it('returns null when the bot owns no combat actives', () => {
    const bot = makePlayer({ hp: 100, maxHp: 500, items: inv() })
    expect(tryUseCombatItem(bot, [enemy], [], makeConfig())).toBeNull()
  })

  it('decideBotAction wires it in: a hurt bot in a fight pops its BKB', () => {
    // 60% HP avoids the retreat threshold yet is under the defensive-pressure
    // cutoff; default difficulty (medium) has threatAssessment on.
    const bot = makePlayer({ zone: 'mid-river', hp: 300, maxHp: 500, items: inv('black_king_bar') })
    const foe = makePlayer({ id: 'foe', name: 'foe', team: 'audit', zone: 'mid-river' })
    const state = makeGameState({ players: { [bot.id]: bot, [foe.id]: foe } })
    expect(decideBotAction(state, bot, 'mid')).toEqual({ type: 'use', item: 'black_king_bar' })
  })
})

describe('BotAI - targeted combat items (tryUseCombatItem)', () => {
  const lowFoe = makePlayer({ id: 'low', name: 'low', team: 'audit', hp: 100, maxHp: 600 })
  const highFoe = makePlayer({ id: 'high', name: 'high', team: 'audit', hp: 600, maxHp: 600 })

  it('hexes the kill target (lowest-HP enemy)', () => {
    const bot = makePlayer({ hp: 500, maxHp: 500, items: inv('scythe_of_vyse') })
    expect(tryUseCombatItem(bot, [highFoe, lowFoe], [], makeConfig())).toEqual({
      type: 'use',
      item: 'scythe_of_vyse',
      target: { kind: 'hero', name: 'low' },
    })
  })

  it('dagons the lowest-HP enemy', () => {
    const bot = makePlayer({ hp: 500, maxHp: 500, items: inv('dagon') })
    expect(tryUseCombatItem(bot, [highFoe, lowFoe], [], makeConfig())).toEqual({
      type: 'use',
      item: 'dagon',
      target: { kind: 'hero', name: 'low' },
    })
  })

  it('ethereals the kill target before it would dagon', () => {
    const bot = makePlayer({ hp: 500, maxHp: 500, items: inv('dagon', 'ethereal_blade') })
    expect(tryUseCombatItem(bot, [lowFoe], [], makeConfig())).toEqual({
      type: 'use',
      item: 'ethereal_blade',
      target: { kind: 'hero', name: 'low' },
    })
  })

  it('holds Dagon/Ethereal when the kill target is magic-immune (they would fizzle)', () => {
    const immune = makePlayer({
      id: 'bkb',
      name: 'bkb',
      team: 'audit',
      hp: 100,
      maxHp: 600,
      buffs: [{ id: 'magic_immune', stacks: 1, ticksRemaining: 4, source: 'black_king_bar' }],
    })
    const bot = makePlayer({ hp: 500, maxHp: 500, items: inv('dagon', 'ethereal_blade') })
    expect(tryUseCombatItem(bot, [immune], [], makeConfig())).toBeNull()
  })

  it('cyclones a SECONDARY enemy (healthiest other threat), never the kill target', () => {
    const bot = makePlayer({ hp: 500, maxHp: 500, items: inv('euls_scepter') })
    expect(tryUseCombatItem(bot, [lowFoe, highFoe], [], makeConfig())).toEqual({
      type: 'use',
      item: 'euls_scepter',
      target: { kind: 'hero', name: 'high' },
    })
  })

  it('does not cyclone in a 1v1 (no secondary enemy to remove)', () => {
    const bot = makePlayer({ hp: 500, maxHp: 500, items: inv('euls_scepter') })
    expect(tryUseCombatItem(bot, [lowFoe], [], makeConfig())).toBeNull()
  })

  it('prioritises Veil (zone amp) ahead of the targeted nukes', () => {
    const bot = makePlayer({ hp: 500, maxHp: 500, items: inv('dagon', 'veil_of_discord') })
    expect(tryUseCombatItem(bot, [lowFoe], [], makeConfig())).toEqual({
      type: 'use',
      item: 'veil_of_discord',
    })
  })

  it('decideBotAction wires targeted items in: a mage bot dagons the low enemy', () => {
    const bot = makePlayer({ zone: 'mid-river', hp: 500, maxHp: 500, items: inv('dagon') })
    const foe = makePlayer({ id: 'low', name: 'low', team: 'audit', zone: 'mid-river', hp: 100 })
    const state = makeGameState({ players: { [bot.id]: bot, [foe.id]: foe } })
    expect(decideBotAction(state, bot, 'mid')).toEqual({
      type: 'use',
      item: 'dagon',
      target: { kind: 'hero', name: 'low' },
    })
  })
})

describe('BotAI - panic survival items (retreat branch)', () => {
  it('returns an owned, off-cooldown defensive item', () => {
    const bot = makePlayer({ items: inv('blade_mail') })
    expect(tryPanicDefensiveItem(bot, makeConfig())).toEqual({ type: 'use', item: 'blade_mail' })
  })

  it('a support bot can panic with Lotus Orb', () => {
    const bot = makePlayer({ items: inv('lotus_orb') })
    expect(tryPanicDefensiveItem(bot, makeConfig())).toEqual({ type: 'use', item: 'lotus_orb' })
  })

  it('is gated on threatAssessment (easy bots panic-walk instead)', () => {
    const bot = makePlayer({ items: inv('black_king_bar') })
    expect(tryPanicDefensiveItem(bot, makeConfig({ threatAssessment: false }))).toBeNull()
  })

  it('respects item cooldown', () => {
    const bot = makePlayer({
      items: inv('black_king_bar'),
      buffs: [{ id: 'item_cd_black_king_bar', stacks: 1, ticksRemaining: 8, source: 'x' }],
    })
    expect(tryPanicDefensiveItem(bot, makeConfig())).toBeNull()
  })

  it('decideBotAction: a chased, low-HP bot pops BKB instead of fleeing to its death', () => {
    // 20% HP (below the medium retreat threshold) with an enemy in zone → the
    // retreat branch runs; it can't TP through combat, so it pops the panic item.
    const bot = makePlayer({
      zone: 'mid-t1-chaff',
      hp: 100,
      maxHp: 500,
      items: inv('black_king_bar'),
    })
    const foe = makePlayer({ id: 'chaser', name: 'chaser', team: 'audit', zone: 'mid-t1-chaff' })
    const state = makeGameState({ players: { [bot.id]: bot, [foe.id]: foe } })
    expect(decideBotAction(state, bot, 'mid')).toEqual({ type: 'use', item: 'black_king_bar' })
  })

  it('decideBotAction: a chased bot with no panic item still walks toward the fountain', () => {
    const bot = makePlayer({ zone: 'mid-t1-chaff', hp: 100, maxHp: 500, items: inv() })
    const foe = makePlayer({ id: 'chaser', name: 'chaser', team: 'audit', zone: 'mid-t1-chaff' })
    const state = makeGameState({ players: { [bot.id]: bot, [foe.id]: foe } })
    const action = decideBotAction(state, bot, 'mid')
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
    const bot = makePlayer({ zone: 'cache-top', items: inv() })
    expect(tryPlaceWard(makeGameState({ players: { [bot.id]: bot } }), bot)).toBeNull()
  })

  it('wards the strategic zone the bot is standing in', () => {
    const bot = makePlayer({ zone: 'cache-top', items: inv('camtap') })
    expect(tryPlaceWard(makeGameState({ players: { [bot.id]: bot } }), bot)).toEqual({
      type: 'ward',
      zone: 'cache-top',
    })
  })

  it('wards an adjacent strategic zone (top-river → cache-top)', () => {
    const bot = makePlayer({ zone: 'top-river', items: inv('camtap') })
    expect(tryPlaceWard(makeGameState({ players: { [bot.id]: bot } }), bot)).toEqual({
      type: 'ward',
      zone: 'cache-top',
    })
  })

  it('does not re-ward a strategic zone the team already covers', () => {
    const bot = makePlayer({ zone: 'cache-top', items: inv('camtap') })
    const state = makeGameState({ players: { [bot.id]: bot }, zones: zonesWith('cache-top', 1) })
    expect(tryPlaceWard(state, bot)).toBeNull()
  })

  it('holds the ward when the team is already at the ward limit', () => {
    const bot = makePlayer({ zone: 'cache-top', items: inv('camtap') })
    // 3 chaff wards parked elsewhere → at WARD_LIMIT_PER_TEAM.
    const state = makeGameState({ players: { [bot.id]: bot }, zones: zonesWith('cache-bot', 3) })
    expect(tryPlaceWard(state, bot)).toBeNull()
  })

  it('returns null when not in or next to a strategic zone', () => {
    const bot = makePlayer({ zone: 'chaff-fountain', items: inv('camtap') })
    expect(tryPlaceWard(makeGameState({ players: { [bot.id]: bot } }), bot)).toBeNull()
  })

  it('a support bot buys an CAMTAP at the fountain', () => {
    const bot = makePlayer({
      heroId: 'sentry', // role: support
      zone: 'chaff-fountain',
      gold: 600,
      items: inv('healing_salve', 'town_portal_scroll'),
    })
    expect(decideBotAction(makeGameState({ players: { [bot.id]: bot } }), bot, 'mid')).toEqual({
      type: 'buy',
      item: 'camtap',
    })
  })

  it('a non-support bot does not buy wards', () => {
    const bot = makePlayer({
      heroId: 'echo', // not support
      zone: 'chaff-fountain',
      gold: 600,
      items: inv('healing_salve', 'town_portal_scroll'),
    })
    const action = decideBotAction(makeGameState({ players: { [bot.id]: bot } }), bot, 'mid')
    expect(action).not.toEqual({ type: 'buy', item: 'camtap' })
  })

  it('decideBotAction wires warding into a calm tick', () => {
    const bot = makePlayer({ heroId: 'sentry', zone: 'cache-top', items: inv('camtap') })
    const state = makeGameState({ players: { [bot.id]: bot } })
    expect(decideBotAction(state, bot, 'mid')).toEqual({ type: 'ward', zone: 'cache-top' })
  })
})

describe('BotAI - difficulty actually bites (abilityComboChance)', () => {
  it('easy right-clicks where hard casts, on the same tick', () => {
    // The ability fallback used to take no config at all, so every difficulty
    // fired its ultimate the tick it came off cooldown and abilityComboChance
    // only changed WHICH ability came out. Tick 30's ability roll is 0.67:
    // above easy's 0.2 and medium's 0.5, below hard's 0.8.
    const bot = makePlayer({ zone: 'mid-river', level: 6, hp: 400, maxHp: 500, mp: 400 })
    const enemy = makePlayer({ id: 'enemy1', team: 'audit', zone: 'mid-river', hp: 300 })
    const state = makeGameState({ tick: 30, players: { [bot.id]: bot, enemy1: enemy } })

    expect(decideBotAction(state, bot, 'mid', atDifficulty('easy', bot.id))).toEqual({
      type: 'attack',
      target: { kind: 'hero', name: 'enemy1' },
    })
    expect(decideBotAction(state, bot, 'mid', atDifficulty('hard', bot.id))?.type).toBe('cast')
  })

  it('a bot that fails the roll still acts — it never returns null in a fight', () => {
    const bot = makePlayer({ zone: 'mid-river', level: 6, hp: 400, maxHp: 500, mp: 400 })
    const enemy = makePlayer({ id: 'enemy1', team: 'audit', zone: 'mid-river', hp: 300 })
    for (const tick of [0, 5, 12, 20, 30, 40, 50]) {
      const state = makeGameState({ tick, players: { [bot.id]: bot, enemy1: enemy } })
      expect(decideBotAction(state, bot, 'mid', atDifficulty('easy', bot.id))).not.toBeNull()
    }
  })
})

describe('BotAI - denying (medium+)', () => {
  const enemy = makePlayer({ id: 'enemy1', team: 'audit', zone: 'mid-t1-chaff', hp: 300 })
  /** No mana and every ability parked, so the deny competes with a right-click. */
  const denier = () =>
    makePlayer({
      zone: 'mid-t1-chaff',
      hp: 400,
      maxHp: 500,
      mp: 0,
      cooldowns: { q: 5, w: 5, e: 5, r: 5 },
    })

  it('denies the allied creep inside the resolver window, by zone-local index', () => {
    const bot = denier()
    const creeps: CreepState[] = [
      { id: 'creep-1', team: 'audit', zone: 'mid-t1-chaff', hp: 200, maxHp: 200, type: 'melee' },
      { id: 'creep-2', team: 'chaff', zone: 'mid-t1-chaff', hp: 40, maxHp: 200, type: 'melee' },
    ]
    const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy }, creeps })
    expect(decideBotAction(state, bot, 'mid', atDifficulty('medium', bot.id))).toEqual({
      type: 'deny',
      target: { kind: 'creep', index: 1 },
    })
  })

  it('leaves a healthy allied creep alone (outside DENY_HP_THRESHOLD the deny would no-op)', () => {
    const bot = denier()
    const creeps: CreepState[] = [
      { id: 'creep-1', team: 'chaff', zone: 'mid-t1-chaff', hp: 150, maxHp: 200, type: 'melee' },
    ]
    const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy }, creeps })
    expect(decideBotAction(state, bot, 'mid', atDifficulty('medium', bot.id))).toEqual({
      type: 'attack',
      target: { kind: 'hero', name: 'enemy1' },
    })
  })

  it('easy bots do not deny (denyAwareness off)', () => {
    const bot = denier()
    const creeps: CreepState[] = [
      { id: 'creep-1', team: 'chaff', zone: 'mid-t1-chaff', hp: 40, maxHp: 200, type: 'melee' },
    ]
    const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy }, creeps })
    expect(decideBotAction(state, bot, 'mid', atDifficulty('easy', bot.id))).toEqual({
      type: 'attack',
      target: { kind: 'hero', name: 'enemy1' },
    })
  })

  it('never denies with no enemy hero around — that just throws away your own wave', () => {
    const bot = denier()
    const creeps: CreepState[] = [
      { id: 'creep-1', team: 'chaff', zone: 'mid-t1-chaff', hp: 40, maxHp: 200, type: 'melee' },
    ]
    const state = makeGameState({ players: { [bot.id]: bot }, creeps })
    const action = decideBotAction(state, bot, 'mid', atDifficulty('medium', bot.id))
    expect(action?.type).not.toBe('deny')
  })
})

describe('BotAI - ice defence rotation (outnumbered, not undefended)', () => {
  const THREATENED = 'top-t1-chaff'

  function siege(defenderIds: string[], attackers: number, botZone = 'top-t2-chaff') {
    const bot = makePlayer({ id: 'bot_alpha', zone: botZone, level: 1, hp: 500, maxHp: 500 })
    const players: Record<string, PlayerState> = { [bot.id]: bot }
    for (const id of defenderIds) {
      players[id] = makePlayer({ id, name: id, team: 'chaff', zone: THREATENED })
    }
    for (let i = 0; i < attackers; i++) {
      const id = `enemy${i}`
      players[id] = makePlayer({ id, name: id, team: 'audit', zone: THREATENED })
    }
    // Lane 'mid' so the bot's own lane push can't be confused for a rotation.
    return { bot, state: makeGameState({ players }) }
  }

  it('rotates to a teammate who is outnumbered at the ice', () => {
    const { bot, state } = siege(['bot_bravo'], 2)
    expect(decideBotAction(state, bot, 'mid', atDifficulty('medium', bot.id))).toEqual({
      type: 'move',
      zone: THREATENED,
    })
  })

  it('a HUMAN ally running back to defend still summons help', () => {
    // The old predicate was "is any ally already there?", so a human doing the
    // right thing was precisely what told the bots the ice was handled.
    const { bot, state } = siege(['github_7379966'], 2)
    expect(decideBotAction(state, bot, 'mid', atDifficulty('medium', bot.id))).toEqual({
      type: 'move',
      zone: THREATENED,
    })
  })

  it('does not rotate into an even fight (defenders match attackers)', () => {
    const { bot, state } = siege(['bot_bravo'], 1)
    const action = decideBotAction(state, bot, 'mid', atDifficulty('medium', bot.id))
    expect(action).not.toEqual({ type: 'move', zone: THREATENED })
  })

  it('still answers an undefended ice (no ally present at all)', () => {
    const { bot, state } = siege([], 1)
    expect(decideBotAction(state, bot, 'mid', atDifficulty('medium', bot.id))).toEqual({
      type: 'move',
      zone: THREATENED,
    })
  })

  it('will not cross the map for it — the rescue is distance-bounded', () => {
    // top-t1-chaff is 3 zones from mid-t1-chaff (inside the bound) and 4 from
    // bot-t1-chaff (outside it): a rescue that lands in five ticks is a lane
    // abandoned for a fight that is already over.
    const near = siege(['bot_bravo'], 2, 'mid-t1-chaff')
    expect(
      decideBotAction(near.state, near.bot, 'mid', atDifficulty('medium', near.bot.id)),
    ).toEqual({ type: 'move', zone: findPath('mid-t1-chaff', THREATENED)[1] })

    // Assigned to its own lane so its ordinary lane push can't be mistaken for
    // (or collide with) the first step of the rescue path.
    const far = siege(['bot_bravo'], 2, 'bot-t1-chaff')
    expect(
      decideBotAction(far.state, far.bot, 'bot', atDifficulty('medium', far.bot.id)),
    ).not.toEqual({ type: 'move', zone: findPath('bot-t1-chaff', THREATENED)[1] })
  })
})

describe('BotAI - Tenant (start condition, steal window, team cooldown)', () => {
  const ROSH_MAX = 5000

  function pitScene(
    opts: {
      tick?: number
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
      hp: 500,
      maxHp: 500,
    })
    const players: Record<string, PlayerState> = { [bot.id]: bot }
    for (let i = 0; i < (opts.allies ?? 2); i++) {
      const id = `bot_ally${i}`
      players[id] = makePlayer({ id, name: id, level: 8, zone: 'cache-top' })
    }
    return {
      bot,
      state: makeGameState({
        tick: opts.tick ?? 40,
        players,
        tenant: { alive: true, hp: opts.tenantHp ?? ROSH_MAX, maxHp: ROSH_MAX, deathTick: null },
      }),
    }
  }

  const HIT_TENANT = { type: 'attack', target: { kind: 'tenant' } }

  it('STARTS a full-HP Tenant with the squad assembled at level 8', () => {
    // The old gate was `hp/maxHp > 0.4 → return null`. Nothing but a hero can
    // damage Tenant, so in a bots-only match his HP never moved and the Backup
    // never dropped.
    const { bot, state } = pitScene()
    expect(decideBotAction(state, bot, 'mid', atDifficulty('medium', bot.id))).toEqual(HIT_TENANT)
  })

  it('walks to the pit when the squad is assembled but the bot is not there yet', () => {
    const { bot, state } = pitScene({ botZone: 'mid-river' })
    expect(decideBotAction(state, bot, 'mid', atDifficulty('medium', bot.id))).toEqual({
      type: 'move',
      zone: 'cache-top',
    })
  })

  it('will not open one alone', () => {
    const { bot, state } = pitScene({ allies: 1 })
    expect(decideBotAction(state, bot, 'mid', atDifficulty('medium', bot.id))).not.toEqual(
      HIT_TENANT,
    )
  })

  it('will not open one under level 8', () => {
    const { bot, state } = pitScene({ level: 7 })
    expect(decideBotAction(state, bot, 'mid', atDifficulty('medium', bot.id))).not.toEqual(
      HIT_TENANT,
    )
  })

  it('will not open a Tenant already chewed to half — that fight belongs to whoever started it', () => {
    const { bot, state } = pitScene({ tenantHp: ROSH_MAX * 0.5 })
    expect(decideBotAction(state, bot, 'mid', atDifficulty('medium', bot.id))).not.toEqual(
      HIT_TENANT,
    )
  })

  it('STEALS a Tenant under 40% with one ally at level 6 (the old opportunistic clause)', () => {
    const { bot, state } = pitScene({ tenantHp: ROSH_MAX * 0.3, level: 6, allies: 1 })
    expect(decideBotAction(state, bot, 'mid', atDifficulty('medium', bot.id))).toEqual(HIT_TENANT)
  })

  it('a committed team keeps hitting through no-mans-land HP for the whole window', () => {
    const gameId = atDifficulty('medium', 'bot_alpha')
    const opened = pitScene({ tick: 40 })
    expect(decideBotAction(opened.state, opened.bot, 'mid', gameId)).toEqual(HIT_TENANT)
    // Same attempt, 5 ticks later, Tenant now at 50% — no longer a legal START,
    // but the team is already committed.
    const midFight = pitScene({ tick: 45, tenantHp: ROSH_MAX * 0.5 })
    expect(decideBotAction(midFight.state, midFight.bot, 'mid', gameId)).toEqual(HIT_TENANT)
  })

  it('locks the team out after the attempt window so it does not camp the pit', () => {
    const gameId = atDifficulty('medium', 'bot_alpha')
    const opened = pitScene({ tick: 40 })
    expect(decideBotAction(opened.state, opened.bot, 'mid', gameId)).toEqual(HIT_TENANT)

    // Window is 20 ticks, lockout 120 more.
    const cooling = pitScene({ tick: 100 })
    expect(decideBotAction(cooling.state, cooling.bot, 'mid', gameId)).not.toEqual(HIT_TENANT)

    // ...and it expires.
    const later = pitScene({ tick: 200 })
    expect(decideBotAction(later.state, later.bot, 'mid', gameId)).toEqual(HIT_TENANT)
  })

  it('a nearly-dead Tenant is still worth stealing during the lockout', () => {
    const gameId = atDifficulty('medium', 'bot_alpha')
    const opened = pitScene({ tick: 40 })
    expect(decideBotAction(opened.state, opened.bot, 'mid', gameId)).toEqual(HIT_TENANT)

    const steal = pitScene({ tick: 100, tenantHp: ROSH_MAX * 0.2 })
    expect(decideBotAction(steal.state, steal.bot, 'mid', gameId)).toEqual(HIT_TENANT)
  })

  it('a committed bot keeps swinging below the START health floor', () => {
    // Tenant hits for 150 a tick. Holding every bot to the 70% opening floor for
    // the whole fight meant two swings each and a walk-out, and his HP crept but
    // never fell — the Backup still never dropped. The hold floor is only high
    // enough that nobody dies in the pit.
    const gameId = atDifficulty('medium', 'bot_alpha')
    const opened = pitScene({ tick: 40 })
    expect(decideBotAction(opened.state, opened.bot, 'mid', gameId)).toEqual(HIT_TENANT)

    const scene = pitScene({ tick: 46 })
    const withHp = (hp: number) => {
      const hurt = { ...scene.bot, hp }
      return decideBotAction(
        { ...scene.state, players: { ...scene.state.players, [hurt.id]: hurt } },
        hurt,
        'mid',
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
        'mid',
        atDifficulty('medium', support.id),
      ),
    ).not.toEqual(HIT_TENANT)
  })

  it('but any role piles in once the team has committed', () => {
    // Tenant focuses the lowest-HP hero in the pit, so extra bodies spread his
    // damage — a squad that only ever fields cores gets two hits each and leaves.
    const gameId = atDifficulty('medium', 'bot_alpha', 'bot_sentry')
    const opened = pitScene({ tick: 40 })
    expect(decideBotAction(opened.state, opened.bot, 'mid', gameId)).toEqual(HIT_TENANT)

    const joining = pitScene({ tick: 45 })
    const support = { ...joining.bot, id: 'bot_sentry', name: 'bot_sentry', heroId: 'sentry' }
    expect(
      decideBotAction(
        { ...joining.state, players: { ...joining.state.players, [support.id]: support } },
        support,
        'mid',
        gameId,
      ),
    ).toEqual(HIT_TENANT)
  })

  it('easy bots never contest Tenant (threatAssessment off)', () => {
    const { bot, state } = pitScene()
    expect(decideBotAction(state, bot, 'mid', atDifficulty('easy', bot.id))).not.toEqual(HIT_TENANT)
  })

  it('never routes toward a pit the map does not have', () => {
    const { bot, state } = pitScene({ botZone: 'mid-river' })
    const zones = { ...state.zones }
    delete zones['hollow']
    const action = decideBotAction({ ...state, zones }, bot, 'mid', atDifficulty('medium', bot.id))
    expect(action).not.toEqual({ type: 'move', zone: 'cache-top' })
  })
})

describe('isOwnSide — the rename guard', () => {
  it('reads the zone record team, never the id string', () => {
    // Regression for the substring-parser trap: side decisions must survive a
    // full zone-id rename. The old endsWith('-chaff')/startsWith('silt-chaff')
    // ladder read every renamed zone as enemy-side and inverted the bots'
    // entire spatial model with no type error and no test failure.
    expect(isOwnSide('chaff-base', 'chaff')).toBe(true)
    expect(isOwnSide('top-t1-chaff', 'chaff')).toBe(true)
    expect(isOwnSide('silt-chaff-top', 'chaff')).toBe(true)
    expect(isOwnSide('top-t1-chaff', 'audit')).toBe(false)
    expect(isOwnSide('audit-base', 'audit')).toBe(true)
    expect(isOwnSide('silt-audit-bot', 'audit')).toBe(true)
    // Rivers/caches/tenant are neutral — own for neither side.
    expect(isOwnSide('mid-river', 'chaff')).toBe(false)
    expect(isOwnSide('mid-river', 'audit')).toBe(false)
    expect(isOwnSide('hollow', 'chaff')).toBe(false)
    // An id the map does not know is own for NOBODY (never defaults to a side).
    expect(isOwnSide('seawall-ice-1-chf', 'chaff')).toBe(false)
    expect(isOwnSide('seawall-ice-1-chf', 'audit')).toBe(false)
  })
})
