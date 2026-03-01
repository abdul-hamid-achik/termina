import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import type { GameState, PlayerState } from '../../../shared/types/game'
import {
  resolveAbility,
  resolvePassive,
  applyBuff,
  hasBuff,
  getBuffStacks,
} from '../../../server/game/heroes/_base'
// Register traceroute hero
import '../../../server/game/heroes/traceroute'

// ── Test Helpers ──────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'TestTraceroute',
    team: 'radiant',
    heroId: 'traceroute',
    zone: 'mid-river',
    hp: 470,
    maxHp: 470,
    mp: 290,
    maxMp: 290,
    level: 7,
    xp: 0,
    gold: 600,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnTick: null,
    defense: 2,
    magicResist: 14,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    towerDamageDealt: 0,
    ...overrides,
  }
}

function makeEnemy(overrides: Partial<PlayerState> = {}): PlayerState {
  return makePlayer({
    id: 'e1',
    name: 'Enemy',
    team: 'dire',
    heroId: 'echo',
    hp: 550,
    maxHp: 550,
    mp: 280,
    maxMp: 280,
    defense: 3,
    magicResist: 15,
    ...overrides,
  })
}

function makeAlly(overrides: Partial<PlayerState> = {}): PlayerState {
  return makePlayer({
    id: 'a1',
    name: 'Ally',
    team: 'radiant',
    heroId: 'echo',
    hp: 400,
    maxHp: 550,
    ...overrides,
  })
}

function makeState(players: PlayerState[], overrides: Partial<GameState> = {}): GameState {
  const playerMap: Record<string, PlayerState> = {}
  for (const p of players) {
    playerMap[p.id] = p
  }
  return {
    tick: 10,
    phase: 'playing',
    teams: {
      radiant: { id: 'radiant', kills: 0, towerKills: 0, gold: 0 },
      dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0 },
    },
    players: playerMap,
    zones: {
      'mid-river': { id: 'mid-river', wards: [], creeps: [] },
      'top-river': { id: 'top-river', wards: [], creeps: [] },
      'mid-t1-rad': { id: 'mid-t1-rad', wards: [], creeps: [] },
    },
    creeps: [],
    towers: [],
    events: [],
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────

describe('Traceroute Hero', () => {
  describe('Q: Probe (Physical Damage + Isolation Bonus)', () => {
    it('deals physical damage to target enemy', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )

      expect(result.state.players['e1']!.hp).toBeLessThan(enemy.hp)
    })

    it('deals 35% bonus damage when target is isolated', () => {
      const player = makePlayer({ level: 1 })
      // Enemy alone in zone (no allies)
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )

      const event = result.events[0]!
      expect(event.payload['isolated']).toBe(true)
      // Damage should be base * 1.35 = 100 * 1.35 = 135
      expect(event.payload['damage']).toBe(135) // 100 * 1.35 rounded
    })

    it('does not apply isolation bonus when target has allies', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const enemyAlly = makeEnemy({ id: 'e2', name: 'EnemyAlly' })
      const state = makeState([player, enemy, enemyAlly])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )

      const event = result.events[0]!
      expect(event.payload['isolated']).toBe(false)
      expect(event.payload['damage']).toBe(100) // Base damage at level 1
    })

    it('scales damage with level', () => {
      const player1 = makePlayer({ level: 1 })
      const player7 = makePlayer({ level: 7 })
      // Enemies with allies in zone to avoid isolation bonus
      const enemy1 = makeEnemy()
      const enemyAlly1 = makeEnemy({ id: 'e2', name: 'EA1' })
      const enemy2 = makeEnemy({ id: 'e3', name: 'Enemy2' })
      const enemyAlly2 = makeEnemy({ id: 'e4', name: 'EA2' })

      const state1 = makeState([player1, enemy1, enemyAlly1])
      const state2 = makeState([player7, enemy2, enemyAlly2])

      const result1 = Effect.runSync(
        resolveAbility(state1, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )
      const result2 = Effect.runSync(
        resolveAbility(state2, 'p1', 'q', { kind: 'hero', name: 'e3' }),
      )

      const dmg1 = enemy1.hp - result1.state.players['e1']!.hp
      const dmg2 = enemy2.hp - result2.state.players['e3']!.hp
      expect(dmg2).toBeGreaterThan(dmg1)
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(290 - 50) // Level 1 costs 50
      expect(updated.cooldowns.q).toBe(8)
    })

    it('requires hero target', () => {
      const player = makePlayer()
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'q'))
      expect(result._tag).toBe('Failure')
    })

    it('fails when target is in different zone', () => {
      const player = makePlayer()
      const enemy = makeEnemy({ zone: 'top-river' })
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )
      expect(result._tag).toBe('Failure')
    })

    it('fails with insufficient mana', () => {
      const player = makePlayer({ mp: 10 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )
      expect(result._tag).toBe('Failure')
    })
  })

  describe('W: TTL (Root)', () => {
    it('applies root debuff to target for 2 ticks', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'e1' }),
      )

      const updatedEnemy = result.state.players['e1']!
      expect(hasBuff(updatedEnemy, 'root')).toBe(true)
      const root = updatedEnemy.buffs.find((b) => b.id === 'root')
      expect(root!.ticksRemaining).toBe(2)
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'e1' }),
      )

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(290 - 70) // Level 1 costs 70
      expect(updated.cooldowns.w).toBe(12)
    })

    it('scales mana cost with level', () => {
      const player = makePlayer({ level: 7 }) // W level 4
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'e1' }),
      )

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(290 - 115) // Level 4 costs 115
    })

    it('requires hero target', () => {
      const player = makePlayer()
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'w'))
      expect(result._tag).toBe('Failure')
    })

    it('fails when target is in different zone', () => {
      const player = makePlayer()
      const enemy = makeEnemy({ zone: 'top-river' })
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'e1' }),
      )
      expect(result._tag).toBe('Failure')
    })

    it('fails with insufficient mana', () => {
      const player = makePlayer({ mp: 10 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'e1' }),
      )
      expect(result._tag).toBe('Failure')
    })
  })

  describe('E: Next Hop (Self Buff)', () => {
    it('applies nextHopShadow buff to self', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      const updated = result.state.players['p1']!
      expect(hasBuff(updated, 'nextHopShadow')).toBe(true)
      const buff = updated.buffs.find((b) => b.id === 'nextHopShadow')
      expect(buff!.ticksRemaining).toBe(2)
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(290 - 60) // Level 1 costs 60
      expect(updated.cooldowns.e).toBe(12)
    })

    it('scales mana cost with level', () => {
      const player = makePlayer({ level: 7 }) // E level 4
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(290 - 105) // Level 4 costs 105
    })

    it('fails with insufficient mana', () => {
      const player = makePlayer({ mp: 10 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'e'))
      expect(result._tag).toBe('Failure')
    })
  })

  describe('R: Full Trace (Global Reveal + Damage Buff)', () => {
    it('requires level 6+', () => {
      const player = makePlayer({ level: 5, mp: 500 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'r'))
      expect(result._tag).toBe('Failure')
    })

    it('applies revealed debuff to all enemy players', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2', zone: 'top-river' })
      const state = makeState([player, enemy1, enemy2])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      expect(hasBuff(result.state.players['e1']!, 'revealed')).toBe(true)
      expect(hasBuff(result.state.players['e2']!, 'revealed')).toBe(true)
      const reveal = result.state.players['e1']!.buffs.find((b) => b.id === 'revealed')
      expect(reveal!.ticksRemaining).toBe(3)
    })

    it('reveals enemies in different zones (global)', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const enemy = makeEnemy({ zone: 'top-river' })
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      expect(hasBuff(result.state.players['e1']!, 'revealed')).toBe(true)
    })

    it('applies self damage buff', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      const updated = result.state.players['p1']!
      expect(hasBuff(updated, 'fullTraceDmg')).toBe(true)
      const dmgBuff = updated.buffs.find((b) => b.id === 'fullTraceDmg')
      expect(dmgBuff!.stacks).toBe(50)
      expect(dmgBuff!.ticksRemaining).toBe(2)
    })

    it('does not affect allied players', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const ally = makeAlly()
      const enemy = makeEnemy()
      const state = makeState([player, ally, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      expect(hasBuff(result.state.players['a1']!, 'revealed')).toBe(false)
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(500 - 200) // R1 costs 200
      expect(updated.cooldowns.r).toBe(60)
    })

    it('fails with insufficient mana', () => {
      const player = makePlayer({ level: 6, mp: 50 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'r'))
      expect(result._tag).toBe('Failure')
    })
  })

  describe('Passive: Hop Count', () => {
    it('increments hopCount stacks on move', () => {
      const player = makePlayer()
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'move',
        payload: { playerId: 'p1', from: 'mid-t1-rad', to: 'mid-river' },
      })

      expect(getBuffStacks(updated.players['p1']!, 'hopCount')).toBe(1)
    })

    it('stacks up to max 3', () => {
      let player = makePlayer()
      player = applyBuff(player, {
        id: 'hopCount',
        stacks: 2,
        ticksRemaining: 2,
        source: 'p1',
      })
      let state = makeState([player])

      state = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'move',
        payload: { playerId: 'p1', from: 'mid-t1-rad', to: 'mid-river' },
      })

      expect(getBuffStacks(state.players['p1']!, 'hopCount')).toBe(3)

      // Try to go above 3
      state = resolvePassive(state, 'p1', {
        tick: 11,
        type: 'move',
        payload: { playerId: 'p1', from: 'mid-river', to: 'top-river' },
      })

      expect(getBuffStacks(state.players['p1']!, 'hopCount')).toBe(3) // still 3
    })

    it('refreshes decay timer on each move', () => {
      const player = makePlayer()
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'move',
        payload: { playerId: 'p1', from: 'mid-t1-rad', to: 'mid-river' },
      })

      const buff = updated.players['p1']!.buffs.find((b) => b.id === 'hopCount')
      expect(buff!.ticksRemaining).toBe(2) // decay timer reset
    })

    it('does not trigger on other players move', () => {
      const player = makePlayer()
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'move',
        payload: { playerId: 'e1', from: 'mid-t1-rad', to: 'mid-river' },
      })

      expect(getBuffStacks(updated.players['p1']!, 'hopCount')).toBe(0)
    })

    it('does not trigger on non-move events', () => {
      const player = makePlayer()
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'tick_end',
        payload: {},
      })

      expect(getBuffStacks(updated.players['p1']!, 'hopCount')).toBe(0)
    })
  })

  describe('Stun/Silence blocking', () => {
    it('prevents casting when stunned', () => {
      const player = makePlayer({
        buffs: [{ id: 'stun', stacks: 1, ticksRemaining: 1, source: 'enemy' }],
      })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )
      expect(result._tag).toBe('Failure')
    })

    it('prevents casting when silenced', () => {
      const player = makePlayer({
        buffs: [{ id: 'silence', stacks: 1, ticksRemaining: 2, source: 'enemy' }],
      })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )
      expect(result._tag).toBe('Failure')
    })
  })
})
