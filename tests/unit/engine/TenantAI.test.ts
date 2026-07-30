import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import { resolveActions, type PlayerAction } from '~~/server/game/engine/ActionResolver'
import { processTenantDamage, runTenantAI } from '~~/server/game/engine/TenantAI'
import type { GameState, PlayerState, TenantState } from '~~/shared/types/game'
import { initializeZoneStates, initializeIce } from '~~/server/game/map/zones'
import { initializeTenant } from '~~/server/game/map/spawner'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'Player1',
    team: 'chaff',
    heroId: 'echo',
    zone: 'mid-t1-chaff',
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
    plate: 3,
    ice: 15,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    iceDamageDealt: 0,
    killStreak: 0,
    ...overrides,
  }
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    tick: 1,
    phase: 'playing',
    teams: {
      chaff: { id: 'chaff', kills: 0, iceKills: 0, gold: 0 },
      audit: { id: 'audit', kills: 0, iceKills: 0, gold: 0 },
    },
    players: {},
    zones: initializeZoneStates(),
    waves: [],
    neutrals: [],
    ice: initializeIce(),
    caches: [],
    tenant: initializeTenant(),
    backup: null,
    events: [],
    ...overrides,
  }
}

describe('TenantAI', () => {
  describe('runTenantAI', () => {
    it('should return no actions when Tenant is dead', () => {
      const state = makeGameState({
        tenant: { alive: false, hp: 0, maxHp: 5000, deathTick: 10 },
        players: {
          p1: makePlayer({ id: 'p1', zone: 'hollow' }),
        },
      })

      const actions = runTenantAI(state)
      expect(actions).toHaveLength(0)
    })

    it('should attack heroes in hollow', () => {
      const state = makeGameState({
        tenant: { alive: true, hp: 5000, maxHp: 5000, deathTick: null },
        players: {
          p1: makePlayer({ id: 'p1', zone: 'hollow', hp: 300 }),
        },
      })

      const actions = runTenantAI(state)
      expect(actions).toHaveLength(1)
      expect(actions[0]!.targetId).toBe('p1')
      expect(actions[0]!.damage).toBeGreaterThan(0)
    })

    it('should target lowest HP hero in pit', () => {
      const state = makeGameState({
        tenant: { alive: true, hp: 5000, maxHp: 5000, deathTick: null },
        players: {
          p1: makePlayer({ id: 'p1', zone: 'hollow', hp: 400 }),
          p2: makePlayer({ id: 'p2', zone: 'hollow', hp: 100, team: 'chaff' }),
        },
      })

      const actions = runTenantAI(state)
      expect(actions).toHaveLength(1)
      expect(actions[0]!.targetId).toBe('p2')
    })

    it('should not attack heroes outside hollow', () => {
      const state = makeGameState({
        tenant: { alive: true, hp: 5000, maxHp: 5000, deathTick: null },
        players: {
          p1: makePlayer({ id: 'p1', zone: 'mid-river' }),
        },
      })

      const actions = runTenantAI(state)
      expect(actions).toHaveLength(0)
    })
  })

  describe('processTenantDamage', () => {
    it('should apply damage to Tenant HP when heroes attack Tenant', () => {
      const state = makeGameState({
        tenant: { alive: true, hp: 5000, maxHp: 5000, deathTick: null },
      })

      const damageDealt = new Map<string, number>()
      damageDealt.set('p1', 500)
      damageDealt.set('p2', 300)

      const result = processTenantDamage(state, damageDealt)

      expect(result.state.tenant.hp).toBe(4200)
      expect(result.tenantKilled).toBe(false)
    })

    it('should handle Tenant death when HP reaches 0', () => {
      const state = makeGameState({
        tick: 100,
        tenant: { alive: true, hp: 500, maxHp: 5000, deathTick: null },
        players: {
          p1: makePlayer({ id: 'p1', zone: 'hollow' }),
          p2: makePlayer({ id: 'p2', zone: 'hollow', team: 'audit' }),
        },
      })

      const damageDealt = new Map<string, number>()
      damageDealt.set('p1', 300)
      damageDealt.set('p2', 300)

      const result = processTenantDamage(state, damageDealt)

      expect(result.tenantKilled).toBe(true)
      expect(result.backupDropped).toBe(true)
      expect(result.state.tenant.alive).toBe(false)
      expect(result.state.tenant.hp).toBe(0)
    })

    it('should distribute gold to damage dealers on Tenant kill', () => {
      const state = makeGameState({
        tick: 100,
        tenant: { alive: true, hp: 500, maxHp: 5000, deathTick: null },
        players: {
          p1: makePlayer({ id: 'p1', zone: 'hollow', gold: 0 }),
          p2: makePlayer({ id: 'p2', zone: 'hollow', team: 'audit', gold: 0 }),
        },
      })

      const damageDealt = new Map<string, number>()
      damageDealt.set('p1', 300)
      damageDealt.set('p2', 200)

      const result = processTenantDamage(state, damageDealt)

      const totalGold = result.state.players['p1']!.gold + result.state.players['p2']!.gold
      expect(totalGold).toBeGreaterThan(0)
    })

    it('should drop backup in hollow on death', () => {
      const state = makeGameState({
        tick: 100,
        tenant: { alive: true, hp: 500, maxHp: 5000, deathTick: null },
        players: {
          p1: makePlayer({ id: 'p1', zone: 'hollow' }),
        },
      })

      const damageDealt = new Map<string, number>()
      damageDealt.set('p1', 500)

      const result = processTenantDamage(state, damageDealt)

      expect(result.backupDropped).toBe(true)
      expect(result.state.backup).not.toBeNull()
      expect(result.state.backup!.zone).toBe('hollow')
    })

    it('should not apply damage when Tenant is dead', () => {
      const state = makeGameState({
        tenant: { alive: false, hp: 0, maxHp: 5000, deathTick: 10 },
      })

      const damageDealt = new Map<string, number>()
      damageDealt.set('p1', 500)

      const result = processTenantDamage(state, damageDealt)

      expect(result.state.tenant.hp).toBe(0)
      expect(result.tenantKilled).toBe(false)
    })
  })

  describe('resolveActions - Tenant attacks', () => {
    it('should apply damage to Tenant HP when heroes attack Tenant via ActionResolver', () => {
      const initialTenant: TenantState = { alive: true, hp: 5000, maxHp: 5000, deathTick: null }
      const state = makeGameState({
        tenant: initialTenant,
        players: {
          p1: makePlayer({ id: 'p1', zone: 'hollow', heroId: 'echo' }),
        },
      })

      const actions: PlayerAction[] = [
        { playerId: 'p1', command: { type: 'attack', target: { kind: 'tenant' } } },
      ]

      const result = Effect.runSync(resolveActions(state, actions))

      const damageEvents = result.events.filter(
        (e) => e._tag === 'damage' && 'targetId' in e && e.targetId === 'tenant',
      )
      expect(damageEvents.length).toBeGreaterThan(0)
      if (damageEvents.length > 0 && 'amount' in damageEvents[0]!) {
        expect((damageEvents[0] as { amount: number }).amount).toBeGreaterThan(0)
      }
    })
  })
})
