import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Effect } from 'effect'
import { processTick } from '../../../server/game/engine/GameLoop'
import { registerBots, cleanupGame } from '../../../server/game/ai/BotManager'
import type { GameState, PlayerState } from '../../../shared/types/game'
import { initializeZoneStates, initializeTowers } from '../../../server/game/map/zones'
import { resetCreepIdCounter, initializeRoshan } from '../../../server/game/map/spawner'
import { initializeAncients } from '../../../server/game/engine/AncientSystem'

/**
 * Integrated regression for the bot-AI frontier standstill. Previously
 * decideBotAction gated all forward progress on `fastGameFactor() > 1`, which is
 * always false in production, so bots returned null and froze at the frontier —
 * never pushing, attacking, or buying. This drives the real
 * processTick -> getBotPlayerIds -> decideBotAction -> submitAction -> resolveActions
 * path (the one BotAI.test.ts can't, since it tests the decision in isolation)
 * and asserts bots make net forward progress out of their own half of the map.
 *
 * Runs under NODE_ENV=production with the fast-game accelerator unset, so it
 * exercises the production push path — the exact configuration where the bug
 * reproduced. Running under the fast-game accelerator would mask it.
 */

const GAME_ID = 'bot-progress-test'

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

/** A radiant zone is on radiant's own half (rivers/enemy side are not). */
function isRadiantOwnSide(zone: string): boolean {
  return zone.endsWith('-rad') || zone.startsWith('radiant') || zone.startsWith('jungle-rad')
}

describe('BotAI - integrated forward progress', () => {
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

  it('bots push out of their own half within a reasonable number of ticks', () => {
    const radiantBots = ['bot_alpha', 'bot_bravo', 'bot_charlie'].map((id, i) =>
      makeBot({
        id,
        name: id,
        team: 'radiant',
        zone: 'radiant-fountain',
        // Vary lanes so they don't all stack: roles drive lane assignment, but
        // the zone progression is what we measure.
        heroId: ['echo', 'daemon', 'kernel'][i] ?? 'echo',
      }),
    )
    const direBots = ['bot_xray', 'bot_yankee'].map((id, i) =>
      makeBot({
        id,
        name: id,
        team: 'dire',
        zone: 'dire-fountain',
        heroId: ['regex', 'echo'][i] ?? 'echo',
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
      'medium',
    )

    let state: GameState = {
      tick: 0,
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
    }

    const TICKS = 60
    let crossedFrontierTick = -1
    for (let i = 0; i < TICKS; i++) {
      const result = Effect.runSync(processTick(GAME_ID, state))
      state = result.state
      const alive = radiantBots
        .map((b) => state.players[b.id])
        .filter((p): p is PlayerState => !!p && p.alive)
      if (crossedFrontierTick < 0 && alive.some((p) => !isRadiantOwnSide(p.zone))) {
        crossedFrontierTick = state.tick
      }
    }

    const finalZones = radiantBots.map((b) => `${b.id}@${state.players[b.id]?.zone}`)
    const direTowerDmg = state.towers
      .filter((t) => t.team === 'dire')
      .reduce((sum, t) => sum + (t.maxHp - t.hp), 0)

    // Bots must push out of their own half — and promptly. The frozen build
    // never left the frontier at all (crossedFrontierTick stays -1). Observed
    // crossing happens around tick 11, so 40 is a generous, non-flaky bound.
    expect(
      crossedFrontierTick,
      `no radiant bot left its own half in ${TICKS} ticks; zones=${JSON.stringify(finalZones)}`,
    ).toBeGreaterThan(0)
    expect(crossedFrontierTick).toBeLessThanOrEqual(40)
    // ...and the push actually reaches and damages enemy structures.
    expect(direTowerDmg).toBeGreaterThan(0)
  })
})
