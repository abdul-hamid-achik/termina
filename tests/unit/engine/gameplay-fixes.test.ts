import { describe, it, expect } from 'vitest'
import { validateAction, type PlayerAction } from '~~/server/game/engine/ActionResolver'
import { filterStateForPlayer } from '~~/server/game/engine/VisionCalculator'
import type { GameState, PlayerState, Buff, FoggedPlayer } from '~~/shared/types/game'
import { initializeZoneStates, initializeTowers } from '~~/server/game/map/zones'
import { initializeRoshan } from '~~/server/game/map/spawner'
import { initializeAncients } from '~~/server/game/engine/AncientSystem'

/**
 * Effect-assertions for mechanics that were DEAD/BROKEN until fixed (the
 * audit + coverage pass surfaced these): Scythe of Vyse Hex did not gate basic
 * attacks, and Silver Edge / Smoke of Deceit granted no invisibility.
 */

function buff(id: string): Buff {
  return { id, stacks: 1, ticksRemaining: 5, source: 'item' }
}

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'Player1',
    team: 'radiant',
    heroId: 'echo',
    zone: 'mid-river',
    hp: 500,
    maxHp: 500,
    mp: 400,
    maxMp: 400,
    level: 7,
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
    buybackCost: 100,
    talents: { tier10: null, tier15: null, tier20: null, tier25: null },
    ...overrides,
  }
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    tick: 1,
    phase: 'playing',
    teams: {
      radiant: { id: 'radiant', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
      dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
    },
    players: {},
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

describe('gameplay-fixes: Scythe of Vyse Hex is a hard disable', () => {
  const hexedState = () => makeGameState({ players: { p1: makePlayer({ buffs: [buff('hex')] }) } })

  it('a hexed hero cannot ATTACK (the bug: only silence was applied, which never gates attacks)', () => {
    const action: PlayerAction = {
      playerId: 'p1',
      command: { type: 'attack', target: { kind: 'hero', name: 'e1' } },
    }
    expect(validateAction(hexedState(), action)).toBe('Cannot act while hexed')
  })

  it('a hexed hero cannot MOVE', () => {
    const action: PlayerAction = { playerId: 'p1', command: { type: 'move', zone: 'mid-t1-dire' } }
    expect(validateAction(hexedState(), action)).toBe('Cannot act while hexed')
  })

  it('a hexed hero cannot CAST', () => {
    const action: PlayerAction = { playerId: 'p1', command: { type: 'cast', ability: 'q' } }
    expect(validateAction(hexedState(), action)).toBe('Cannot act while hexed')
  })

  it('a NON-hexed hero may attack (control)', () => {
    const state = makeGameState({ players: { p1: makePlayer() } })
    const action: PlayerAction = {
      playerId: 'p1',
      command: { type: 'attack', target: { kind: 'hero', name: 'e1' } },
    }
    expect(validateAction(state, action)).toBeNull()
  })
})

describe('gameplay-fixes: invisibility items fog the holder from enemies', () => {
  function viewerSeesEnemyFogged(enemyBuffs: Buff[]): boolean {
    const state = makeGameState({
      players: {
        r1: makePlayer({ id: 'r1', team: 'radiant', zone: 'mid-river' }),
        d1: makePlayer({
          id: 'd1',
          team: 'dire',
          zone: 'mid-river',
          name: 'Enemy',
          buffs: enemyBuffs,
        }),
      },
    })
    const enemy = filterStateForPlayer(state, 'r1').players['d1'] as FoggedPlayer
    return enemy.fogged === true
  }

  it('Silver Edge (silver_edge_invis) fogs the holder even in a shared zone', () => {
    expect(viewerSeesEnemyFogged([buff('silver_edge_invis')])).toBe(true)
  })

  it('Smoke of Deceit (smoke) fogs the holder', () => {
    expect(viewerSeesEnemyFogged([buff('smoke')])).toBe(true)
  })

  it('a non-invisible enemy in the same zone is fully visible (control)', () => {
    expect(viewerSeesEnemyFogged([])).toBe(false)
  })
})
