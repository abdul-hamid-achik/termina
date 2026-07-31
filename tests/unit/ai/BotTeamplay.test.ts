import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Effect } from 'effect'
import { processCycle } from '~~/server/game/engine/GameLoop'
import { registerBots, cleanupGame } from '~~/server/game/ai/BotManager'
import type { GameState, PlayerState, WaveUnitState } from '~~/shared/types/game'
import { initializeZoneStates, initializeIce } from '~~/server/game/map/zones'
import { resetWaveIdCounter, initializeTenant } from '~~/server/game/map/spawner'
import { initializeTerminals } from '~~/server/game/engine/TerminalSystem'

/**
 * Bot decisions driven through the REAL processCycle → decideBotAction →
 * submitAction → resolveActions path, which BotAI.test.ts (decisions in
 * isolation) cannot reach. Both cases here are about a command the bot emits
 * actually LANDING: a `burn` outside the resolver's INTEG window and a Tenant
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
    integ: 900,
    maxInteg: 900,
    bw: 400,
    maxBw: 400,
    level: 8,
    xp: 0,
    scrip: 0,
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

function makeState(
  players: Record<string, PlayerState>,
  overrides: Partial<GameState> = {},
): GameState {
  return {
    cycle: 40,
    phase: 'playing',
    teams: {
      chaff: { id: 'chaff', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
      audit: { id: 'audit', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
    },
    players,
    zones: initializeZoneStates(),
    waves: [],
    neutrals: [],
    ice: initializeIce(),
    terminals: initializeTerminals(),
    caches: [],
    tenant: initializeTenant(),
    backup: null,
    events: [],
    surrenderVotes: { chaff: new Set(), audit: new Set() },
    timeOfDay: 'day',
    dayNightCycle: 0,
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
    // resolveDenyPhase's gates (own team, <= BURN_HP_THRESHOLD of SPAWN integ) and
    // uses the zone-local index the resolver reads.
    const bot = makeBot({ bw: 0, cooldowns: { q: 9, w: 9, e: 9, r: 9 } })
    const foe = makeBot({
      id: 'bot_foe',
      name: 'bot_foe',
      team: 'audit',
      heroId: 'kernel',
      zone: 'mid-t1-chaff',
      bw: 0,
      cooldowns: { q: 9, w: 9, e: 9, r: 9 },
    })
    const waves: WaveUnitState[] = [
      {
        id: 'wave-own',
        team: 'chaff',
        zone: 'mid-t1-chaff',
        integ: 40,
        maxInteg: 200,
        type: 'line',
      },
    ]
    registerBots(
      GAME_ID,
      [bot, foe].map((b) => ({ playerId: b.id, team: b.team, heroId: b.heroId })),
      'medium',
    )

    const result = Effect.runSync(
      processCycle(GAME_ID, makeState({ [bot.id]: bot, [foe.id]: foe }, { waves })),
    )

    expect(result.events.some((e) => e._tag === 'wave_burn')).toBe(true)
    expect(result.state.waves.find((c) => c.id === 'wave-own')?.integ ?? 0).toBe(0)
  })

  it('a bot squad actually starts Tenant — his INTEG moves in a bots-only match', () => {
    // The headline W3-9 regression: Tenant takes damage from nothing but heroes,
    // and the old gate refused to engage above 40% INTEG, so in any bots-only or
    // human+bots match his INTEG never moved and the Backup never dropped.
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
    const startHp = state.tenant.integ
    for (let i = 0; i < 12; i++) {
      state = Effect.runSync(processCycle(GAME_ID, state)).state
    }

    expect(state.tenant.integ).toBeLessThan(startHp)
  })
})
