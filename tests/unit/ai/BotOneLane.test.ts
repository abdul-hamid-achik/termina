import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Effect } from 'effect'
import { processCycle } from '~~/server/game/engine/GameLoop'
import { registerBots, cleanupGame, getBotLane } from '~~/server/game/ai/BotManager'
import type { GameState, PlayerState } from '~~/shared/types/game'
import { initializeZoneStates, initializeIce } from '~~/server/game/map/zones'
import { resetWaveIdCounter, initializeTenant } from '~~/server/game/map/spawner'
import { initializeTerminals } from '~~/server/game/engine/TerminalSystem'
import { zonesForMap } from '~~/shared/constants/maps'

/**
 * Bots on the one-lane (tutorial) map. The map is a strict subset of the full
 * graph, but bot pathfinding (findPath) walks the GLOBAL zone graph — so a bot
 * whose role lane is top/bot/jungle would try to step into a zone this game
 * doesn't have. registerBots({ forceLane: 'coldstore' }) pins every bot to the one
 * surviving lane; this drives the real processCycle → decideBotAction path and
 * proves the bots stay on the map AND still push it. Without forceLane this is
 * exactly the standstill the tutorial entry point must avoid.
 */
const GAME_ID = 'bot-one-lane-test'

function makeBot(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'bot_alpha',
    name: 'bot_alpha',
    team: 'chaff',
    heroId: 'echo',
    zone: 'rookery-anchor',
    integ: 550,
    maxInteg: 550,
    bw: 280,
    maxBw: 280,
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

function oneLaneState(players: Record<string, PlayerState>): GameState {
  const zones = zonesForMap('one_lane')
  return {
    cycle: 0,
    phase: 'playing',
    teams: {
      chaff: { id: 'chaff', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
      audit: { id: 'audit', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
    },
    players,
    zones: initializeZoneStates(zones),
    neutrals: [],
    waves: [],
    ice: initializeIce(zones),
    terminals: initializeTerminals(),
    caches: [],
    tenant: initializeTenant(),
    backup: null,
    events: [],
    surrenderVotes: { chaff: new Set(), audit: new Set() },
    timeOfDay: 'day',
    dayNightCycle: 0,
    mapId: 'one_lane',
  }
}

describe('bots on the one-lane map', () => {
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

  it('forceLane pins every bot to the given lane', () => {
    const players: Record<string, PlayerState> = {
      bot_alpha: makeBot({ id: 'bot_alpha', name: 'bot_alpha', team: 'chaff', heroId: 'kernel' }),
      bot_bravo: makeBot({ id: 'bot_bravo', name: 'bot_bravo', team: 'audit', heroId: 'regex' }),
    }
    registerBots(
      GAME_ID,
      Object.values(players).map((b) => ({ playerId: b.id, team: b.team, heroId: b.heroId })),
      { forceLane: 'coldstore' },
    )
    expect(getBotLane(GAME_ID, 'bot_alpha')).toBe('coldstore')
    expect(getBotLane(GAME_ID, 'bot_bravo')).toBe('coldstore')
  })

  it('bots never step off the map and still push the lane', () => {
    const chaffBots = ['bot_alpha', 'bot_bravo'].map((id, i) =>
      makeBot({
        id,
        name: id,
        team: 'chaff',
        zone: 'rookery-anchor',
        heroId: ['echo', 'kernel'][i] ?? 'echo',
      }),
    )
    const auditBots = ['bot_xray', 'bot_yankee'].map((id, i) =>
      makeBot({
        id,
        name: id,
        team: 'audit',
        zone: 'landing-anchor',
        heroId: ['regex', 'daemon'][i] ?? 'regex',
      }),
    )
    const players: Record<string, PlayerState> = {}
    for (const b of [...chaffBots, ...auditBots]) players[b.id] = b

    registerBots(
      GAME_ID,
      [...chaffBots, ...auditBots].map((b) => ({
        playerId: b.id,
        team: b.team,
        heroId: b.heroId,
      })),
      { forceLane: 'coldstore' },
    )

    let state = oneLaneState(players)
    const validZones = new Set(Object.keys(state.zones))

    const TICKS = 40
    let crossedFrontier = false
    let offMapRejections = 0
    for (let i = 0; i < TICKS; i++) {
      const result = Effect.runSync(processCycle(GAME_ID, state))
      state = result.state

      // Invariant: no bot is ever standing in a zone this map doesn't have.
      for (const b of [...chaffBots, ...auditBots]) {
        const p = state.players[b.id]
        if (p) expect(validZones.has(p.zone)).toBe(true)
      }
      // A bot trying to walk off the lane would surface as a 'No path'
      // rejection (auto-path validation) — forceLane='coldstore' must keep that
      // from ever happening.
      offMapRejections += result.rejectedActions.filter((r) => r.reason.includes('No path')).length

      // Forward progress: a chaff bot reaches the river or the enemy half.
      if (
        chaffBots.some((b) => {
          const z = state.players[b.id]?.zone
          return z === 'coldstore-cross' || z?.endsWith('-audit')
        })
      ) {
        crossedFrontier = true
      }
    }

    expect(offMapRejections).toBe(0)
    expect(crossedFrontier).toBe(true)
    // And waves stayed contained to the map the whole time.
    expect(state.waves.every((c) => validZones.has(c.zone))).toBe(true)
  })
})
