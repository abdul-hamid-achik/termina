import { describe, it, expect } from 'vitest'
import {
  TERMINAL_ZONES,
  terminalTargetId,
  parseTerminalTargetId,
  initializeTerminals,
  ensureTerminals,
  isTerminalVulnerable,
  updateTerminalVulnerability,
  resolveTerminalAttack,
  checkTerminalWin,
} from '~~/server/game/engine/TerminalSystem'
import type { GameState, PlayerState, WaveUnitState } from '~~/shared/types/game'
import { initializeZoneStates, initializeIce } from '~~/server/game/map/zones'
import { TERMINAL_HP } from '~~/shared/constants/balance'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'Player1',
    team: 'chaff',
    heroId: 'echo',
    zone: 'landing-terminal',
    integ: 500,
    maxInteg: 500,
    bw: 200,
    maxBw: 200,
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

function makeWave(overrides: Partial<WaveUnitState> = {}): WaveUnitState {
  return {
    id: 'c1',
    team: 'chaff',
    zone: 'landing-terminal',
    integ: 400,
    type: 'line',
    ...overrides,
  }
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    cycle: 1,
    phase: 'playing',
    teams: {
      chaff: { id: 'chaff', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
      audit: { id: 'audit', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
    },
    players: {},
    zones: initializeZoneStates(),
    waves: [],
    neutrals: [],
    ice: initializeIce(),
    terminals: initializeTerminals(),
    caches: [],
    tenant: { alive: false, integ: 0, maxInteg: 5000, deathCycle: null },
    backup: null,
    events: [],
    surrenderVotes: { chaff: new Set(), audit: new Set() },
    timeOfDay: 'day',
    dayNightCycle: 0,
    ...overrides,
  }
}

/** State where the named team's mid T3 ice is destroyed. */
function withDeadT3(state: GameState, team: 'chaff' | 'audit'): GameState {
  const zone = team === 'chaff' ? 'coldstore-t3-chaff' : 'coldstore-t3-audit'
  return {
    ...state,
    ice: state.ice.map((t) => (t.zone === zone ? { ...t, integ: 0, alive: false } : t)),
  }
}

describe('TerminalSystem', () => {
  describe('initializeTerminals', () => {
    it('creates two full-INTEG, invulnerable, alive Terminals', () => {
      const terminals = initializeTerminals()
      for (const team of ['chaff', 'audit'] as const) {
        expect(terminals[team].team).toBe(team)
        expect(terminals[team].integ).toBe(TERMINAL_HP)
        expect(terminals[team].maxInteg).toBe(TERMINAL_HP)
        expect(terminals[team].alive).toBe(true)
        expect(terminals[team].vulnerable).toBe(false)
      }
    })
  })

  describe('target ids', () => {
    it('round-trips terminal target ids', () => {
      expect(parseTerminalTargetId(terminalTargetId('chaff'))).toBe('chaff')
      expect(parseTerminalTargetId(terminalTargetId('audit'))).toBe('audit')
      expect(parseTerminalTargetId('ice_coldstore-t1-chaff')).toBeNull()
      expect(parseTerminalTargetId('p1')).toBeNull()
    })

    it('places terminals in their base zones', () => {
      expect(TERMINAL_ZONES.chaff).toBe('rookery-terminal')
      expect(TERMINAL_ZONES.audit).toBe('landing-terminal')
    })
  })

  describe('ensureTerminals', () => {
    it('returns the same state when terminals exist', () => {
      const state = makeGameState()
      expect(ensureTerminals(state)).toBe(state)
    })

    it('backfills terminals on legacy states', () => {
      const state = makeGameState()
      const legacy = { ...state } as Partial<GameState>
      delete legacy.terminals

      const result = ensureTerminals(legacy as GameState)
      expect(result.terminals.chaff.alive).toBe(true)
      expect(result.terminals.audit.alive).toBe(true)
    })
  })

  describe('vulnerability', () => {
    it('is invulnerable while all own T3 ice stand', () => {
      const state = makeGameState()
      expect(isTerminalVulnerable(state, 'chaff')).toBe(false)
      expect(isTerminalVulnerable(state, 'audit')).toBe(false)
    })

    it('becomes vulnerable when one own T3 ice is dead', () => {
      const state = withDeadT3(makeGameState(), 'audit')
      expect(isTerminalVulnerable(state, 'audit')).toBe(true)
      expect(isTerminalVulnerable(state, 'chaff')).toBe(false)
    })

    it('is not made vulnerable by dead T1/T2 ice', () => {
      const state = makeGameState({
        ice: initializeIce().map((t) =>
          t.zone === 'coldstore-t1-audit' || t.zone === 'seawall-t2-audit'
            ? { ...t, integ: 0, alive: false }
            : t,
        ),
      })
      expect(isTerminalVulnerable(state, 'audit')).toBe(false)
    })

    it('updateTerminalVulnerability flips the flag and is a no-op otherwise', () => {
      const unchanged = makeGameState()
      expect(updateTerminalVulnerability(unchanged)).toBe(unchanged)

      const state = withDeadT3(makeGameState(), 'audit')
      const updated = updateTerminalVulnerability(state)
      expect(updated).not.toBe(state)
      expect(updated.terminals.audit.vulnerable).toBe(true)
      expect(updated.terminals.chaff.vulnerable).toBe(false)
    })
  })

  describe('resolveTerminalAttack', () => {
    function vulnerableState(overrides: Partial<GameState> = {}): GameState {
      return updateTerminalVulnerability(withDeadT3(makeGameState(overrides), 'audit'))
    }

    it('rejects attacks while the Terminal is invulnerable', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ id: 'p1', team: 'chaff', zone: 'landing-terminal' }) },
      })

      const result = resolveTerminalAttack(state, 'p1', 100)
      expect(result.rejected).toBeDefined()
      expect(result.state.terminals.audit.integ).toBe(TERMINAL_HP)
      expect(result.events).toHaveLength(0)
    })

    it('applies hero damage to the enemy Terminal when vulnerable', () => {
      const state = vulnerableState({
        players: { p1: makePlayer({ id: 'p1', team: 'chaff', zone: 'landing-terminal' }) },
      })

      const result = resolveTerminalAttack(state, 'p1', 100)
      expect(result.rejected).toBeUndefined()
      expect(result.state.terminals.audit.integ).toBe(TERMINAL_HP - 100)
      expect(result.state.terminals.audit.alive).toBe(true)
      expect(result.events).toHaveLength(1)
      expect(result.events[0]!._tag).toBe('damage')
      expect(result.events[0]).toMatchObject({
        sourceId: 'p1',
        targetId: 'terminal_audit',
        amount: 100,
      })
    })

    it('resolves wave attackers by wave team', () => {
      const state = vulnerableState({
        waves: [makeWave({ id: 'c9', team: 'chaff', zone: 'landing-terminal' })],
      })

      const result = resolveTerminalAttack(state, 'c9', 20)
      expect(result.rejected).toBeUndefined()
      expect(result.state.terminals.audit.integ).toBe(TERMINAL_HP - 20)
    })

    it('destroys the Terminal at 0 INTEG and emits a dedicated terminal_destroyed event', () => {
      const base = vulnerableState({
        players: { p1: makePlayer({ id: 'p1', team: 'chaff', zone: 'landing-terminal' }) },
      })
      const state: GameState = {
        ...base,
        terminals: { ...base.terminals, audit: { ...base.terminals.audit, integ: 50 } },
      }

      const result = resolveTerminalAttack(state, 'p1', 100)
      expect(result.state.terminals.audit.integ).toBe(0)
      expect(result.state.terminals.audit.alive).toBe(false)
      // No ice_kill reuse — the Terminal has its own event so the UI does not
      // render a misleading "destroyed ice in <base>" line.
      expect(result.events.some((e) => e._tag === 'ice_kill')).toBe(false)
      const killEvent = result.events.find((e) => e._tag === 'terminal_destroyed')
      expect(killEvent).toBeDefined()
      expect(killEvent).toMatchObject({ team: 'audit', killerTeam: 'chaff' })
    })

    it('rejects attacks on an already-destroyed Terminal', () => {
      const base = vulnerableState({
        players: { p1: makePlayer({ id: 'p1', team: 'chaff', zone: 'landing-terminal' }) },
      })
      const state: GameState = {
        ...base,
        terminals: {
          ...base.terminals,
          audit: { ...base.terminals.audit, integ: 0, alive: false },
        },
      }

      const result = resolveTerminalAttack(state, 'p1', 100)
      expect(result.rejected).toBeDefined()
      expect(result.events).toHaveLength(0)
    })

    it('rejects unknown attackers', () => {
      const state = vulnerableState()
      const result = resolveTerminalAttack(state, 'ghost', 100)
      expect(result.rejected).toBeDefined()
      expect(result.state).toBe(state)
    })

    it('audit attackers damage the chaff Terminal', () => {
      const base = makeGameState({
        players: { p1: makePlayer({ id: 'p1', team: 'audit', zone: 'rookery-terminal' }) },
      })
      const state = updateTerminalVulnerability(withDeadT3(base, 'chaff'))

      const result = resolveTerminalAttack(state, 'p1', 100)
      expect(result.state.terminals.chaff.integ).toBe(TERMINAL_HP - 100)
      expect(result.state.terminals.audit.integ).toBe(TERMINAL_HP)
    })
  })

  describe('checkTerminalWin', () => {
    it('returns null while both Terminals stand', () => {
      expect(checkTerminalWin(makeGameState())).toBeNull()
    })

    it('returns the winning team when a Terminal falls', () => {
      const state = makeGameState()
      const auditDown: GameState = {
        ...state,
        terminals: {
          ...state.terminals,
          audit: { ...state.terminals.audit, integ: 0, alive: false },
        },
      }
      expect(checkTerminalWin(auditDown)).toBe('chaff')

      const chaffDown: GameState = {
        ...state,
        terminals: {
          ...state.terminals,
          chaff: { ...state.terminals.chaff, integ: 0, alive: false },
        },
      }
      expect(checkTerminalWin(chaffDown)).toBe('audit')
    })

    it('returns null for legacy states without terminals', () => {
      const state = makeGameState()
      const legacy = { ...state } as Partial<GameState>
      delete legacy.terminals
      expect(checkTerminalWin(legacy as GameState)).toBeNull()
    })
  })
})
