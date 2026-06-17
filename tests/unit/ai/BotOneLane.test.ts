import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Effect } from 'effect'
import { processTick } from '../../../server/game/engine/GameLoop'
import { registerBots, cleanupGame, getBotLane } from '../../../server/game/ai/BotManager'
import type { GameState, PlayerState } from '../../../shared/types/game'
import { initializeZoneStates, initializeTowers } from '../../../server/game/map/zones'
import { resetCreepIdCounter, initializeRoshan } from '../../../server/game/map/spawner'
import { initializeAncients } from '../../../server/game/engine/AncientSystem'
import { zonesForMap } from '../../../shared/constants/maps'

/**
 * Bots on the one-lane (tutorial) map. The map is a strict subset of the full
 * graph, but bot pathfinding (findPath) walks the GLOBAL zone graph — so a bot
 * whose role lane is top/bot/jungle would try to step into a zone this game
 * doesn't have. registerBots({ forceLane: 'mid' }) pins every bot to the one
 * surviving lane; this drives the real processTick → decideBotAction path and
 * proves the bots stay on the map AND still push it. Without forceLane this is
 * exactly the standstill the tutorial entry point must avoid.
 */
const GAME_ID = 'bot-one-lane-test'

function makeBot(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'bot_alpha',
    name: 'bot_alpha',
    team: 'radiant',
    heroId: 'echo',
    zone: 'radiant-fountain',
    hp: 550,
    maxHp: 550,
    mp: 280,
    maxMp: 280,
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
    towerDamageDealt: 0,
    killStreak: 0,
    buybackCost: 0,
    talents: { tier10: null, tier15: null, tier20: null, tier25: null },
    ...overrides,
  }
}

function oneLaneState(players: Record<string, PlayerState>): GameState {
  const zones = zonesForMap('one_lane')
  return {
    tick: 0,
    phase: 'playing',
    teams: {
      radiant: { id: 'radiant', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
      dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
    },
    players,
    zones: initializeZoneStates(zones),
    neutrals: [],
    creeps: [],
    towers: initializeTowers(zones),
    ancients: initializeAncients(),
    runes: [],
    roshan: initializeRoshan(),
    aegis: null,
    events: [],
    surrenderVotes: { radiant: new Set(), dire: new Set() },
    timeOfDay: 'day',
    dayNightTick: 0,
    mapId: 'one_lane',
  }
}

describe('bots on the one-lane map', () => {
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

  it('forceLane pins every bot to the given lane', () => {
    const players: Record<string, PlayerState> = {
      bot_alpha: makeBot({ id: 'bot_alpha', name: 'bot_alpha', team: 'radiant', heroId: 'kernel' }),
      bot_bravo: makeBot({ id: 'bot_bravo', name: 'bot_bravo', team: 'dire', heroId: 'regex' }),
    }
    registerBots(
      GAME_ID,
      Object.values(players).map((b) => ({ playerId: b.id, team: b.team, heroId: b.heroId })),
      { forceLane: 'mid' },
    )
    expect(getBotLane(GAME_ID, 'bot_alpha')).toBe('mid')
    expect(getBotLane(GAME_ID, 'bot_bravo')).toBe('mid')
  })

  it('bots never step off the map and still push the lane', () => {
    const radiantBots = ['bot_alpha', 'bot_bravo'].map((id, i) =>
      makeBot({
        id,
        name: id,
        team: 'radiant',
        zone: 'radiant-fountain',
        heroId: ['echo', 'kernel'][i] ?? 'echo',
      }),
    )
    const direBots = ['bot_xray', 'bot_yankee'].map((id, i) =>
      makeBot({
        id,
        name: id,
        team: 'dire',
        zone: 'dire-fountain',
        heroId: ['regex', 'daemon'][i] ?? 'regex',
      }),
    )
    const players: Record<string, PlayerState> = {}
    for (const b of [...radiantBots, ...direBots]) players[b.id] = b

    registerBots(
      GAME_ID,
      [...radiantBots, ...direBots].map((b) => ({
        playerId: b.id,
        team: b.team,
        heroId: b.heroId,
      })),
      { forceLane: 'mid' },
    )

    let state = oneLaneState(players)
    const validZones = new Set(Object.keys(state.zones))

    const TICKS = 40
    let crossedFrontier = false
    let offMapRejections = 0
    for (let i = 0; i < TICKS; i++) {
      const result = Effect.runSync(processTick(GAME_ID, state))
      state = result.state

      // Invariant: no bot is ever standing in a zone this map doesn't have.
      for (const b of [...radiantBots, ...direBots]) {
        const p = state.players[b.id]
        if (p) expect(validZones.has(p.zone)).toBe(true)
      }
      // A bot trying to walk off the lane would surface as a 'non-adjacent'
      // rejection — forceLane='mid' must keep that from ever happening.
      offMapRejections += result.rejectedActions.filter((r) =>
        r.reason.includes('non-adjacent'),
      ).length

      // Forward progress: a radiant bot reaches the river or the enemy half.
      if (
        radiantBots.some((b) => {
          const z = state.players[b.id]?.zone
          return z === 'mid-river' || z?.endsWith('-dire')
        })
      ) {
        crossedFrontier = true
      }
    }

    expect(offMapRejections).toBe(0)
    expect(crossedFrontier).toBe(true)
    // And creeps stayed contained to the map the whole time.
    expect(state.creeps.every((c) => validZones.has(c.zone))).toBe(true)
  })
})
