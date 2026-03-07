import type { PlayerState, GameState } from '~~/shared/types/game'
import { initializeZoneStates, initializeTowers } from '~~/server/game/map/zones'

/** Helper to create a test player with all required fields */
export function makeTestPlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'test_player',
    name: 'TestPlayer',
    team: 'radiant' as const,
    heroId: 'echo',
    zone: 'mid-t1-rad',
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
    towerDamageDealt: 0,
    killStreak: 0,
    buybackCost: 0,
    buybackCooldown: undefined,
    ...overrides,
  }
}

/** Helper to create a test game state with all required fields */
export function makeTestGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    tick: 1,
    phase: 'playing' as const,
    teams: {
      radiant: { id: 'radiant' as const, kills: 0, towerKills: 0, gold: 0 },
      dire: { id: 'dire' as const, kills: 0, towerKills: 0, gold: 0 },
    },
    players: {},
    zones: initializeZoneStates(),
    creeps: [],
    neutrals: [],
    towers: initializeTowers(),
    runes: [],
    roshan: { alive: true, hp: 5000, maxHp: 5000, deathTick: null },
    aegis: null,
    events: [],
    surrenderVotes: { radiant: new Set(), dire: new Set() },
    lastSeen: {},
    ...overrides,
  }
}
