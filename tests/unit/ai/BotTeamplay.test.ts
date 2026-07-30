import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Effect } from 'effect'
import { processTick } from '~~/server/game/engine/GameLoop'
import { registerBots, cleanupGame } from '~~/server/game/ai/BotManager'
import type { GameState, PlayerState, WaveUnitState } from '~~/shared/types/game'
import { initializeZoneStates, initializeIce } from '~~/server/game/map/zones'
import { resetWaveIdCounter, initializeTenant } from '~~/server/game/map/spawner'
import { initializeAncients } from '~~/server/game/engine/AncientSystem'

/**
 * Bot decisions driven through the REAL processTick → decideBotAction →
 * submitAction → resolveActions path, which BotAI.test.ts (decisions in
 * isolation) cannot reach. Both cases here are about a command the bot emits
 * actually LANDING: a `burn` outside the resolver's HP window and a Tenant
 * attempt nobody ever opens both look identical to a passing unit test — the
 * bot returns a command and the engine silently drops it.
 *
 * Runs under NODE_ENV=production with the fast-game accelerator unset so bots
 * take the production path, matching BotForwardProgress.
 */

const GAME_ID = 'bot-teamplay-test'

function makeBot(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'bot_alpha',
    name: 'bot_alpha',
    team: 'chaff',
    heroId: 'echo',
    zone: 'mid-t1-chaff',
    hp: 900,
    maxHp: 900,
    mp: 400,
    maxMp: 400,
    level: 8,
    xp: 0,
    gold: 0,
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

function makeState(
  players: Record<string, PlayerState>,
  overrides: Partial<GameState> = {},
): GameState {
  return {
    tick: 40,
    phase: 'playing',
    teams: {
      chaff: { id: 'chaff', kills: 0, iceKills: 0, gold: 0, hardenUsedTick: null },
      audit: { id: 'audit', kills: 0, iceKills: 0, gold: 0, hardenUsedTick: null },
    },
    players,
    zones: initializeZoneStates(),
    waves: [],
    neutrals: [],
    ice: initializeIce(),
    ancients: initializeAncients(),
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

describe('BotAI - integrated teamplay', () => {
  let prevNodeEnv: string | undefined
  let prevFastGame: string | undefined

  beforeEach(() => {
    resetWaveIdCounter()
    prevNodeEnv = process.env.NODE_ENV
    prevFastGame = process.env.TERMINA_TEST_FAST_GAME
    process.env.NODE_ENV = 'production'
    delete process.env.TERMINA_TEST_FAST_GAME
  })

  afterEach(() => {
    cleanupGame(GAME_ID)
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prevNodeEnv
    if (prevFastGame === undefined) delete process.env.TERMINA_TEST_FAST_GAME
    else process.env.TERMINA_TEST_FAST_GAME = prevFastGame
  })

  it("a bot's burn actually resolves — the wave dies and wave_burn fires", () => {
    // The resolver drops a burn outside its window without a word, so a bot that
    // aims one wrong just loses the tick. This proves the bot mirrors
    // resolveDenyPhase's gates (own team, <= BURN_HP_THRESHOLD of SPAWN hp) and
    // uses the zone-local index the resolver reads.
    const bot = makeBot({ mp: 0, cooldowns: { q: 9, w: 9, e: 9, r: 9 } })
    const foe = makeBot({
      id: 'bot_foe',
      name: 'bot_foe',
      team: 'audit',
      heroId: 'kernel',
      zone: 'mid-t1-chaff',
      mp: 0,
      cooldowns: { q: 9, w: 9, e: 9, r: 9 },
    })
    const waves: WaveUnitState[] = [
      { id: 'wave-own', team: 'chaff', zone: 'mid-t1-chaff', hp: 40, maxHp: 200, type: 'line' },
    ]
    registerBots(
      GAME_ID,
      [bot, foe].map((b) => ({ playerId: b.id, team: b.team, heroId: b.heroId })),
      'medium',
    )

    const result = Effect.runSync(
      processTick(GAME_ID, makeState({ [bot.id]: bot, [foe.id]: foe }, { waves })),
    )

    expect(result.events.some((e) => e._tag === 'wave_burn')).toBe(true)
    expect(result.state.waves.find((c) => c.id === 'wave-own')?.hp ?? 0).toBe(0)
  })

  it('a bot squad actually starts Tenant — his HP moves in a bots-only match', () => {
    // The headline W3-9 regression: Tenant takes damage from nothing but heroes,
    // and the old gate refused to engage above 40% HP, so in any bots-only or
    // human+bots match his HP never moved and the Backup never dropped.
    const squad = ['bot_alpha', 'bot_bravo', 'bot_charlie'].map((id, i) =>
      makeBot({
        id,
        name: id,
        heroId: ['echo', 'malloc', 'cipher'][i] ?? 'echo',
        zone: i === 0 ? 'hollow' : 'cache-top',
      }),
    )
    const players: Record<string, PlayerState> = {}
    for (const b of squad) players[b.id] = b

    registerBots(
      GAME_ID,
      squad.map((b) => ({ playerId: b.id, team: b.team, heroId: b.heroId })),
      'medium',
    )

    let state = makeState(players)
    const startHp = state.tenant.hp
    for (let i = 0; i < 12; i++) {
      state = Effect.runSync(processTick(GAME_ID, state)).state
    }

    expect(state.tenant.hp).toBeLessThan(startHp)
  })
})
