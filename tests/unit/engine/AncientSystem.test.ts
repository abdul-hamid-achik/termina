import { describe, it, expect } from 'vitest'
import {
  ANCIENT_ZONES,
  ancientTargetId,
  parseAncientTargetId,
  initializeAncients,
  ensureAncients,
  isAncientVulnerable,
  updateAncientVulnerability,
  resolveAncientAttack,
  checkAncientWin,
} from '../../../server/game/engine/AncientSystem'
import type { GameState, PlayerState, CreepState } from '../../../shared/types/game'
import { initializeZoneStates, initializeTowers } from '../../../server/game/map/zones'
import { ANCIENT_HP } from '../../../shared/constants/balance'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'Player1',
    team: 'radiant',
    heroId: 'echo',
    zone: 'dire-base',
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
    talents: { tier10: null, tier15: null, tier20: null, tier25: null },
    ...overrides,
  }
}

function makeCreep(overrides: Partial<CreepState> = {}): CreepState {
  return {
    id: 'c1',
    team: 'radiant',
    zone: 'dire-base',
    hp: 400,
    type: 'melee',
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
    roshan: { alive: false, hp: 0, maxHp: 5000, deathTick: null },
    aegis: null,
    events: [],
    surrenderVotes: { radiant: new Set(), dire: new Set() },
    lastSeen: {},
    timeOfDay: 'day',
    dayNightTick: 0,
    ...overrides,
  }
}

/** State where the named team's mid T3 tower is destroyed. */
function withDeadT3(state: GameState, team: 'radiant' | 'dire'): GameState {
  const zone = team === 'radiant' ? 'mid-t3-rad' : 'mid-t3-dire'
  return {
    ...state,
    towers: state.towers.map((t) => (t.zone === zone ? { ...t, hp: 0, alive: false } : t)),
  }
}

describe('AncientSystem', () => {
  describe('initializeAncients', () => {
    it('creates two full-HP, invulnerable, alive Ancients', () => {
      const ancients = initializeAncients()
      for (const team of ['radiant', 'dire'] as const) {
        expect(ancients[team].team).toBe(team)
        expect(ancients[team].hp).toBe(ANCIENT_HP)
        expect(ancients[team].maxHp).toBe(ANCIENT_HP)
        expect(ancients[team].alive).toBe(true)
        expect(ancients[team].vulnerable).toBe(false)
      }
    })
  })

  describe('target ids', () => {
    it('round-trips ancient target ids', () => {
      expect(parseAncientTargetId(ancientTargetId('radiant'))).toBe('radiant')
      expect(parseAncientTargetId(ancientTargetId('dire'))).toBe('dire')
      expect(parseAncientTargetId('tower_mid-t1-rad')).toBeNull()
      expect(parseAncientTargetId('p1')).toBeNull()
    })

    it('places ancients in their base zones', () => {
      expect(ANCIENT_ZONES.radiant).toBe('radiant-base')
      expect(ANCIENT_ZONES.dire).toBe('dire-base')
    })
  })

  describe('ensureAncients', () => {
    it('returns the same state when ancients exist', () => {
      const state = makeGameState()
      expect(ensureAncients(state)).toBe(state)
    })

    it('backfills ancients on legacy states', () => {
      const state = makeGameState()
      const legacy = { ...state } as Partial<GameState>
      delete legacy.ancients

      const result = ensureAncients(legacy as GameState)
      expect(result.ancients.radiant.alive).toBe(true)
      expect(result.ancients.dire.alive).toBe(true)
    })
  })

  describe('vulnerability', () => {
    it('is invulnerable while all own T3 towers stand', () => {
      const state = makeGameState()
      expect(isAncientVulnerable(state, 'radiant')).toBe(false)
      expect(isAncientVulnerable(state, 'dire')).toBe(false)
    })

    it('becomes vulnerable when one own T3 tower is dead', () => {
      const state = withDeadT3(makeGameState(), 'dire')
      expect(isAncientVulnerable(state, 'dire')).toBe(true)
      expect(isAncientVulnerable(state, 'radiant')).toBe(false)
    })

    it('is not made vulnerable by dead T1/T2 towers', () => {
      const state = makeGameState({
        towers: initializeTowers().map((t) =>
          t.zone === 'mid-t1-dire' || t.zone === 'top-t2-dire' ? { ...t, hp: 0, alive: false } : t,
        ),
      })
      expect(isAncientVulnerable(state, 'dire')).toBe(false)
    })

    it('updateAncientVulnerability flips the flag and is a no-op otherwise', () => {
      const unchanged = makeGameState()
      expect(updateAncientVulnerability(unchanged)).toBe(unchanged)

      const state = withDeadT3(makeGameState(), 'dire')
      const updated = updateAncientVulnerability(state)
      expect(updated).not.toBe(state)
      expect(updated.ancients.dire.vulnerable).toBe(true)
      expect(updated.ancients.radiant.vulnerable).toBe(false)
    })
  })

  describe('resolveAncientAttack', () => {
    function vulnerableState(overrides: Partial<GameState> = {}): GameState {
      return updateAncientVulnerability(withDeadT3(makeGameState(overrides), 'dire'))
    }

    it('rejects attacks while the Ancient is invulnerable', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ id: 'p1', team: 'radiant', zone: 'dire-base' }) },
      })

      const result = resolveAncientAttack(state, 'p1', 100)
      expect(result.rejected).toBeDefined()
      expect(result.state.ancients.dire.hp).toBe(ANCIENT_HP)
      expect(result.events).toHaveLength(0)
    })

    it('applies hero damage to the enemy Ancient when vulnerable', () => {
      const state = vulnerableState({
        players: { p1: makePlayer({ id: 'p1', team: 'radiant', zone: 'dire-base' }) },
      })

      const result = resolveAncientAttack(state, 'p1', 100)
      expect(result.rejected).toBeUndefined()
      expect(result.state.ancients.dire.hp).toBe(ANCIENT_HP - 100)
      expect(result.state.ancients.dire.alive).toBe(true)
      expect(result.events).toHaveLength(1)
      expect(result.events[0]!._tag).toBe('damage')
      expect(result.events[0]).toMatchObject({
        sourceId: 'p1',
        targetId: 'ancient_dire',
        amount: 100,
      })
    })

    it('resolves creep attackers by creep team', () => {
      const state = vulnerableState({
        creeps: [makeCreep({ id: 'c9', team: 'radiant', zone: 'dire-base' })],
      })

      const result = resolveAncientAttack(state, 'c9', 20)
      expect(result.rejected).toBeUndefined()
      expect(result.state.ancients.dire.hp).toBe(ANCIENT_HP - 20)
    })

    it('destroys the Ancient at 0 HP and emits a structure-kill event', () => {
      const base = vulnerableState({
        players: { p1: makePlayer({ id: 'p1', team: 'radiant', zone: 'dire-base' }) },
      })
      const state: GameState = {
        ...base,
        ancients: { ...base.ancients, dire: { ...base.ancients.dire, hp: 50 } },
      }

      const result = resolveAncientAttack(state, 'p1', 100)
      expect(result.state.ancients.dire.hp).toBe(0)
      expect(result.state.ancients.dire.alive).toBe(false)
      const killEvent = result.events.find((e) => e._tag === 'tower_kill')
      expect(killEvent).toBeDefined()
      expect(killEvent).toMatchObject({ zone: 'dire-base', team: 'dire', killerTeam: 'radiant' })
    })

    it('rejects attacks on an already-destroyed Ancient', () => {
      const base = vulnerableState({
        players: { p1: makePlayer({ id: 'p1', team: 'radiant', zone: 'dire-base' }) },
      })
      const state: GameState = {
        ...base,
        ancients: {
          ...base.ancients,
          dire: { ...base.ancients.dire, hp: 0, alive: false },
        },
      }

      const result = resolveAncientAttack(state, 'p1', 100)
      expect(result.rejected).toBeDefined()
      expect(result.events).toHaveLength(0)
    })

    it('rejects unknown attackers', () => {
      const state = vulnerableState()
      const result = resolveAncientAttack(state, 'ghost', 100)
      expect(result.rejected).toBeDefined()
      expect(result.state).toBe(state)
    })

    it('dire attackers damage the radiant Ancient', () => {
      const base = makeGameState({
        players: { p1: makePlayer({ id: 'p1', team: 'dire', zone: 'radiant-base' }) },
      })
      const state = updateAncientVulnerability(withDeadT3(base, 'radiant'))

      const result = resolveAncientAttack(state, 'p1', 100)
      expect(result.state.ancients.radiant.hp).toBe(ANCIENT_HP - 100)
      expect(result.state.ancients.dire.hp).toBe(ANCIENT_HP)
    })
  })

  describe('checkAncientWin', () => {
    it('returns null while both Ancients stand', () => {
      expect(checkAncientWin(makeGameState())).toBeNull()
    })

    it('returns the winning team when an Ancient falls', () => {
      const state = makeGameState()
      const direDown: GameState = {
        ...state,
        ancients: {
          ...state.ancients,
          dire: { ...state.ancients.dire, hp: 0, alive: false },
        },
      }
      expect(checkAncientWin(direDown)).toBe('radiant')

      const radiantDown: GameState = {
        ...state,
        ancients: {
          ...state.ancients,
          radiant: { ...state.ancients.radiant, hp: 0, alive: false },
        },
      }
      expect(checkAncientWin(radiantDown)).toBe('dire')
    })

    it('returns null for legacy states without ancients', () => {
      const state = makeGameState()
      const legacy = { ...state } as Partial<GameState>
      delete legacy.ancients
      expect(checkAncientWin(legacy as GameState)).toBeNull()
    })
  })
})
