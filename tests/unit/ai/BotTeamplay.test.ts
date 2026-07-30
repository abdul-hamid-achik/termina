import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Effect } from 'effect'
import { processTick } from '~~/server/game/engine/GameLoop'
import { registerBots, cleanupGame } from '~~/server/game/ai/BotManager'
import type { GameState, PlayerState, CreepState } from '~~/shared/types/game'
import { initializeZoneStates, initializeTowers } from '~~/server/game/map/zones'
import { resetCreepIdCounter, initializeRoshan } from '~~/server/game/map/spawner'
import { initializeAncients } from '~~/server/game/engine/AncientSystem'

/**
 * Bot decisions driven through the REAL processTick → decideBotAction →
 * submitAction → resolveActions path, which BotAI.test.ts (decisions in
 * isolation) cannot reach. Both cases here are about a command the bot emits
 * actually LANDING: a `deny` outside the resolver's HP window and a Roshan
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
    team: 'radiant',
    heroId: 'echo',
    zone: 'mid-t1-rad',
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
    towerDamageDealt: 0,
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
      radiant: { id: 'radiant', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
      dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
    },
    players,
    zones: initializeZoneStates(),
    creeps: [],
    neutrals: [],
    towers: initializeTowers(),
    ancients: initializeAncients(),
    runes: [],
    roshan: initializeRoshan(),
    aegis: null,
    events: [],
    surrenderVotes: { radiant: new Set(), dire: new Set() },
    timeOfDay: 'day',
    dayNightTick: 0,
    ...overrides,
  }
}

describe('BotAI - integrated teamplay', () => {
  let prevNodeEnv: string | undefined
  let prevFastGame: string | undefined

  beforeEach(() => {
    resetCreepIdCounter()
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

  it("a bot's deny actually resolves — the creep dies and creep_deny fires", () => {
    // The resolver drops a deny outside its window without a word, so a bot that
    // aims one wrong just loses the tick. This proves the bot mirrors
    // resolveDenyPhase's gates (own team, <= DENY_HP_THRESHOLD of SPAWN hp) and
    // uses the zone-local index the resolver reads.
    const bot = makeBot({ mp: 0, cooldowns: { q: 9, w: 9, e: 9, r: 9 } })
    const foe = makeBot({
      id: 'bot_foe',
      name: 'bot_foe',
      team: 'dire',
      heroId: 'kernel',
      zone: 'mid-t1-rad',
      mp: 0,
      cooldowns: { q: 9, w: 9, e: 9, r: 9 },
    })
    const creeps: CreepState[] = [
      { id: 'creep-own', team: 'radiant', zone: 'mid-t1-rad', hp: 40, maxHp: 200, type: 'melee' },
    ]
    registerBots(
      GAME_ID,
      [bot, foe].map((b) => ({ playerId: b.id, team: b.team, heroId: b.heroId })),
      'medium',
    )

    const result = Effect.runSync(
      processTick(GAME_ID, makeState({ [bot.id]: bot, [foe.id]: foe }, { creeps })),
    )

    expect(result.events.some((e) => e._tag === 'creep_deny')).toBe(true)
    expect(result.state.creeps.find((c) => c.id === 'creep-own')?.hp ?? 0).toBe(0)
  })

  it('a bot squad actually starts Roshan — his HP moves in a bots-only match', () => {
    // The headline W3-9 regression: Roshan takes damage from nothing but heroes,
    // and the old gate refused to engage above 40% HP, so in any bots-only or
    // human+bots match his HP never moved and the Aegis never dropped.
    const squad = ['bot_alpha', 'bot_bravo', 'bot_charlie'].map((id, i) =>
      makeBot({
        id,
        name: id,
        heroId: ['echo', 'malloc', 'cipher'][i] ?? 'echo',
        zone: i === 0 ? 'roshan-pit' : 'rune-top',
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
    const startHp = state.roshan.hp
    for (let i = 0; i < 12; i++) {
      state = Effect.runSync(processTick(GAME_ID, state)).state
    }

    expect(state.roshan.hp).toBeLessThan(startHp)
  })
})
