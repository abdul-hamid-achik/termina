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
} from '~~/server/game/engine/AncientSystem'
import type { GameState, PlayerState, CreepState } from '~~/shared/types/game'
import { initializeZoneStates, initializeIce } from '~~/server/game/map/zones'
import { ANCIENT_HP } from '~~/shared/constants/balance'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'Player1',
    team: 'chaff',
    heroId: 'echo',
    zone: 'audit-base',
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

function makeCreep(overrides: Partial<CreepState> = {}): CreepState {
  return {
    id: 'c1',
    team: 'chaff',
    zone: 'audit-base',
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
      chaff: { id: 'chaff', kills: 0, iceKills: 0, gold: 0, glyphUsedTick: null },
      audit: { id: 'audit', kills: 0, iceKills: 0, gold: 0, glyphUsedTick: null },
    },
    players: {},
    zones: initializeZoneStates(),
    creeps: [],
    neutrals: [],
    ice: initializeIce(),
    ancients: initializeAncients(),
    runes: [],
    roshan: { alive: false, hp: 0, maxHp: 5000, deathTick: null },
    aegis: null,
    events: [],
    surrenderVotes: { chaff: new Set(), audit: new Set() },
    timeOfDay: 'day',
    dayNightTick: 0,
    ...overrides,
  }
}

/** State where the named team's mid T3 ice is destroyed. */
function withDeadT3(state: GameState, team: 'chaff' | 'audit'): GameState {
  const zone = team === 'chaff' ? 'mid-t3-chaff' : 'mid-t3-audit'
  return {
    ...state,
    ice: state.ice.map((t) => (t.zone === zone ? { ...t, hp: 0, alive: false } : t)),
  }
}

describe('AncientSystem', () => {
  describe('initializeAncients', () => {
    it('creates two full-HP, invulnerable, alive Ancients', () => {
      const ancients = initializeAncients()
      for (const team of ['chaff', 'audit'] as const) {
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
      expect(parseAncientTargetId(ancientTargetId('chaff'))).toBe('chaff')
      expect(parseAncientTargetId(ancientTargetId('audit'))).toBe('audit')
      expect(parseAncientTargetId('ice_mid-t1-chaff')).toBeNull()
      expect(parseAncientTargetId('p1')).toBeNull()
    })

    it('places ancients in their base zones', () => {
      expect(ANCIENT_ZONES.chaff).toBe('chaff-base')
      expect(ANCIENT_ZONES.audit).toBe('audit-base')
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
      expect(result.ancients.chaff.alive).toBe(true)
      expect(result.ancients.audit.alive).toBe(true)
    })
  })

  describe('vulnerability', () => {
    it('is invulnerable while all own T3 ice stand', () => {
      const state = makeGameState()
      expect(isAncientVulnerable(state, 'chaff')).toBe(false)
      expect(isAncientVulnerable(state, 'audit')).toBe(false)
    })

    it('becomes vulnerable when one own T3 ice is dead', () => {
      const state = withDeadT3(makeGameState(), 'audit')
      expect(isAncientVulnerable(state, 'audit')).toBe(true)
      expect(isAncientVulnerable(state, 'chaff')).toBe(false)
    })

    it('is not made vulnerable by dead T1/T2 ice', () => {
      const state = makeGameState({
        ice: initializeIce().map((t) =>
          t.zone === 'mid-t1-audit' || t.zone === 'top-t2-audit'
            ? { ...t, hp: 0, alive: false }
            : t,
        ),
      })
      expect(isAncientVulnerable(state, 'audit')).toBe(false)
    })

    it('updateAncientVulnerability flips the flag and is a no-op otherwise', () => {
      const unchanged = makeGameState()
      expect(updateAncientVulnerability(unchanged)).toBe(unchanged)

      const state = withDeadT3(makeGameState(), 'audit')
      const updated = updateAncientVulnerability(state)
      expect(updated).not.toBe(state)
      expect(updated.ancients.audit.vulnerable).toBe(true)
      expect(updated.ancients.chaff.vulnerable).toBe(false)
    })
  })

  describe('resolveAncientAttack', () => {
    function vulnerableState(overrides: Partial<GameState> = {}): GameState {
      return updateAncientVulnerability(withDeadT3(makeGameState(overrides), 'audit'))
    }

    it('rejects attacks while the Ancient is invulnerable', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ id: 'p1', team: 'chaff', zone: 'audit-base' }) },
      })

      const result = resolveAncientAttack(state, 'p1', 100)
      expect(result.rejected).toBeDefined()
      expect(result.state.ancients.audit.hp).toBe(ANCIENT_HP)
      expect(result.events).toHaveLength(0)
    })

    it('applies hero damage to the enemy Ancient when vulnerable', () => {
      const state = vulnerableState({
        players: { p1: makePlayer({ id: 'p1', team: 'chaff', zone: 'audit-base' }) },
      })

      const result = resolveAncientAttack(state, 'p1', 100)
      expect(result.rejected).toBeUndefined()
      expect(result.state.ancients.audit.hp).toBe(ANCIENT_HP - 100)
      expect(result.state.ancients.audit.alive).toBe(true)
      expect(result.events).toHaveLength(1)
      expect(result.events[0]!._tag).toBe('damage')
      expect(result.events[0]).toMatchObject({
        sourceId: 'p1',
        targetId: 'ancient_audit',
        amount: 100,
      })
    })

    it('resolves creep attackers by creep team', () => {
      const state = vulnerableState({
        creeps: [makeCreep({ id: 'c9', team: 'chaff', zone: 'audit-base' })],
      })

      const result = resolveAncientAttack(state, 'c9', 20)
      expect(result.rejected).toBeUndefined()
      expect(result.state.ancients.audit.hp).toBe(ANCIENT_HP - 20)
    })

    it('destroys the Ancient at 0 HP and emits a dedicated ancient_destroyed event', () => {
      const base = vulnerableState({
        players: { p1: makePlayer({ id: 'p1', team: 'chaff', zone: 'audit-base' }) },
      })
      const state: GameState = {
        ...base,
        ancients: { ...base.ancients, audit: { ...base.ancients.audit, hp: 50 } },
      }

      const result = resolveAncientAttack(state, 'p1', 100)
      expect(result.state.ancients.audit.hp).toBe(0)
      expect(result.state.ancients.audit.alive).toBe(false)
      // No ice_kill reuse — the Ancient has its own event so the UI does not
      // render a misleading "destroyed ice in <base>" line.
      expect(result.events.some((e) => e._tag === 'ice_kill')).toBe(false)
      const killEvent = result.events.find((e) => e._tag === 'ancient_destroyed')
      expect(killEvent).toBeDefined()
      expect(killEvent).toMatchObject({ team: 'audit', killerTeam: 'chaff' })
    })

    it('rejects attacks on an already-destroyed Ancient', () => {
      const base = vulnerableState({
        players: { p1: makePlayer({ id: 'p1', team: 'chaff', zone: 'audit-base' }) },
      })
      const state: GameState = {
        ...base,
        ancients: {
          ...base.ancients,
          audit: { ...base.ancients.audit, hp: 0, alive: false },
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

    it('audit attackers damage the chaff Ancient', () => {
      const base = makeGameState({
        players: { p1: makePlayer({ id: 'p1', team: 'audit', zone: 'chaff-base' }) },
      })
      const state = updateAncientVulnerability(withDeadT3(base, 'chaff'))

      const result = resolveAncientAttack(state, 'p1', 100)
      expect(result.state.ancients.chaff.hp).toBe(ANCIENT_HP - 100)
      expect(result.state.ancients.audit.hp).toBe(ANCIENT_HP)
    })
  })

  describe('checkAncientWin', () => {
    it('returns null while both Ancients stand', () => {
      expect(checkAncientWin(makeGameState())).toBeNull()
    })

    it('returns the winning team when an Ancient falls', () => {
      const state = makeGameState()
      const auditDown: GameState = {
        ...state,
        ancients: {
          ...state.ancients,
          audit: { ...state.ancients.audit, hp: 0, alive: false },
        },
      }
      expect(checkAncientWin(auditDown)).toBe('chaff')

      const chaffDown: GameState = {
        ...state,
        ancients: {
          ...state.ancients,
          chaff: { ...state.ancients.chaff, hp: 0, alive: false },
        },
      }
      expect(checkAncientWin(chaffDown)).toBe('audit')
    })

    it('returns null for legacy states without ancients', () => {
      const state = makeGameState()
      const legacy = { ...state } as Partial<GameState>
      delete legacy.ancients
      expect(checkAncientWin(legacy as GameState)).toBeNull()
    })
  })
})
