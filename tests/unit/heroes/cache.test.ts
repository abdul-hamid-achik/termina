import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import type { GameState, PlayerState } from '../../../shared/types/game'
import {
  resolveAbility,
  resolvePassive,
  applyBuff,
  hasBuff,
} from '../../../server/game/heroes/_base'
// Register cache hero and import helpers
import { getCachedEnergy } from '../../../server/game/heroes/cache'

// ── Test Helpers ──────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'TestCache',
    team: 'radiant',
    heroId: 'cache',
    zone: 'mid-river',
    hp: 700,
    maxHp: 700,
    mp: 260,
    maxMp: 260,
    level: 7,
    xp: 0,
    gold: 600,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnTick: null,
    defense: 7,
    magicResist: 24,
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
    },
    creeps: [],
    towers: [],
    events: [],
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────

describe('Cache Hero', () => {
  describe('Passive: Write-Back (Cached Energy)', () => {
    it('stores 15% of damage taken as cachedEnergy', () => {
      const player = makePlayer()
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'damage_taken',
        payload: { targetId: 'p1', attackerId: 'e1', damage: 100 },
      })

      const energy = getCachedEnergy(updated.players['p1']!)
      expect(energy).toBe(15) // 15% of 100
    })

    it('accumulates cached energy across multiple hits', () => {
      const player = makePlayer()
      const enemy = makeEnemy()
      let state = makeState([player, enemy])

      state = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'damage_taken',
        payload: { targetId: 'p1', attackerId: 'e1', damage: 100 },
      })
      state = resolvePassive(state, 'p1', {
        tick: 11,
        type: 'damage_taken',
        payload: { targetId: 'p1', attackerId: 'e1', damage: 100 },
      })

      const energy = getCachedEnergy(state.players['p1']!)
      expect(energy).toBe(30) // 15 + 15
    })

    it('caps cached energy at 30% of maxHP', () => {
      const player = makePlayer({ maxHp: 700 })
      const enemy = makeEnemy()
      let state = makeState([player, enemy])

      // Max energy = 700 * 0.3 = 210
      // Take 2000 damage (15% = 300, but capped at 210)
      state = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'damage_taken',
        payload: { targetId: 'p1', attackerId: 'e1', damage: 2000 },
      })

      const energy = getCachedEnergy(state.players['p1']!)
      expect(energy).toBe(210) // 30% of 700
    })

    it('does not trigger on non-damage_taken events', () => {
      const player = makePlayer()
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'attack',
        payload: { attackerId: 'p1', targetId: 'e1', damage: 100 },
      })

      expect(getCachedEnergy(updated.players['p1']!)).toBe(0)
    })

    it('does not trigger when another player takes damage', () => {
      const player = makePlayer()
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'damage_taken',
        payload: { targetId: 'e1', attackerId: 'p1', damage: 100 },
      })

      expect(getCachedEnergy(updated.players['p1']!)).toBe(0)
    })

    it('ignores zero damage', () => {
      const player = makePlayer()
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'damage_taken',
        payload: { targetId: 'p1', attackerId: 'e1', damage: 0 },
      })

      expect(getCachedEnergy(updated.players['p1']!)).toBe(0)
    })
  })

  describe('Q: Cache Hit (Physical Damage + Cached Bonus)', () => {
    it('deals physical damage to target hero', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )

      const updatedEnemy = result.state.players['e1']!
      expect(updatedEnemy.hp).toBeLessThan(enemy.hp)
      expect(result.events[0]!.type).toBe('ability_cast')
    })

    it('adds bonus damage from cached energy (50%)', () => {
      let player = makePlayer({ level: 1 })
      player = applyBuff(player, {
        id: 'cachedEnergy',
        stacks: 100,
        ticksRemaining: 9999,
        source: 'p1',
      })
      const enemy = makeEnemy()
      const stateWithCache = makeState([player, enemy])

      const playerNoCache = makePlayer({ level: 1 })
      const enemyNoCache = makeEnemy({ id: 'e2', name: 'Enemy2' })
      const stateNoCache = makeState([playerNoCache, enemyNoCache])

      const resultWithCache = Effect.runSync(
        resolveAbility(stateWithCache, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )
      const resultNoCache = Effect.runSync(
        resolveAbility(stateNoCache, 'p1', 'q', { kind: 'hero', name: 'e2' }),
      )

      const dmgWithCache = enemy.hp - resultWithCache.state.players['e1']!.hp
      const dmgNoCache = enemyNoCache.hp - resultNoCache.state.players['e2']!.hp
      expect(dmgWithCache).toBeGreaterThan(dmgNoCache)
    })

    it('does NOT consume cached energy', () => {
      let player = makePlayer({ level: 1 })
      player = applyBuff(player, {
        id: 'cachedEnergy',
        stacks: 100,
        ticksRemaining: 9999,
        source: 'p1',
      })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )

      // Cached energy should still be 100
      expect(getCachedEnergy(result.state.players['p1']!)).toBe(100)
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(260 - 55) // Level 1 Q costs 55
      expect(updated.cooldowns.q).toBe(8)
    })

    it('scales damage with level', () => {
      const player1 = makePlayer({ level: 1 })
      const player7 = makePlayer({ level: 7 })
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2' })

      const state1 = makeState([player1, enemy1])
      const state2 = makeState([player7, enemy2])

      const result1 = Effect.runSync(
        resolveAbility(state1, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )
      const result2 = Effect.runSync(
        resolveAbility(state2, 'p1', 'q', { kind: 'hero', name: 'e2' }),
      )

      const dmg1 = enemy1.hp - result1.state.players['e1']!.hp
      const dmg2 = enemy2.hp - result2.state.players['e2']!.hp
      expect(dmg2).toBeGreaterThan(dmg1)
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

  describe('W: Flush (Convert Cached Energy to Shield)', () => {
    it('converts cached energy to shield', () => {
      let player = makePlayer({ level: 1 })
      player = applyBuff(player, {
        id: 'cachedEnergy',
        stacks: 150,
        ticksRemaining: 9999,
        source: 'p1',
      })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      const updated = result.state.players['p1']!
      expect(hasBuff(updated, 'shield')).toBe(true)
      const shield = updated.buffs.find((b) => b.id === 'shield')
      expect(shield!.stacks).toBe(150) // shield = cached energy
    })

    it('consumes all cached energy', () => {
      let player = makePlayer({ level: 1 })
      player = applyBuff(player, {
        id: 'cachedEnergy',
        stacks: 150,
        ticksRemaining: 9999,
        source: 'p1',
      })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      expect(getCachedEnergy(result.state.players['p1']!)).toBe(0)
    })

    it('produces no shield when no cached energy', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      const updated = result.state.players['p1']!
      expect(hasBuff(updated, 'shield')).toBe(false)
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(260 - 60) // Level 1 W costs 60
      expect(updated.cooldowns.w).toBe(12)
    })

    it('fails with insufficient mana', () => {
      const player = makePlayer({ mp: 10 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'w'))
      expect(result._tag).toBe('Failure')
    })

    it('fails when on cooldown', () => {
      const player = makePlayer({ cooldowns: { q: 0, w: 5, e: 0, r: 0 } })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'w'))
      expect(result._tag).toBe('Failure')
    })
  })

  describe('E: Invalidate (Magic Damage + Anti-Heal)', () => {
    it('deals magic damage and applies anti-heal debuff', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'e1' }),
      )

      const updatedEnemy = result.state.players['e1']!
      expect(updatedEnemy.hp).toBeLessThan(enemy.hp)
      expect(hasBuff(updatedEnemy, 'antiHeal')).toBe(true)
      const debuff = updatedEnemy.buffs.find((b) => b.id === 'antiHeal')
      expect(debuff!.stacks).toBe(50) // 50% reduced healing
      expect(debuff!.ticksRemaining).toBe(3)
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'e1' }),
      )

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(260 - 65) // Level 1 E costs 65
      expect(updated.cooldowns.e).toBe(10)
    })

    it('scales damage with level', () => {
      const player1 = makePlayer({ level: 1 })
      const player7 = makePlayer({ level: 7 })
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2' })

      const state1 = makeState([player1, enemy1])
      const state2 = makeState([player7, enemy2])

      const result1 = Effect.runSync(
        resolveAbility(state1, 'p1', 'e', { kind: 'hero', name: 'e1' }),
      )
      const result2 = Effect.runSync(
        resolveAbility(state2, 'p1', 'e', { kind: 'hero', name: 'e2' }),
      )

      const dmg1 = enemy1.hp - result1.state.players['e1']!.hp
      const dmg2 = enemy2.hp - result2.state.players['e2']!.hp
      expect(dmg2).toBeGreaterThan(dmg1)
    })

    it('requires hero target', () => {
      const player = makePlayer()
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'e'))
      expect(result._tag).toBe('Failure')
    })

    it('fails when target is in different zone', () => {
      const player = makePlayer()
      const enemy = makeEnemy({ zone: 'top-river' })
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'e1' }),
      )
      expect(result._tag).toBe('Failure')
    })

    it('fails with insufficient mana', () => {
      const player = makePlayer({ mp: 10 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'e1' }),
      )
      expect(result._tag).toBe('Failure')
    })
  })

  describe('R: Eviction (AoE Pure Damage + Slow)', () => {
    it('requires level 6+ to cast', () => {
      const player = makePlayer({ level: 5, mp: 500 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'r'))
      expect(result._tag).toBe('Failure')
    })

    it('deals pure AoE damage equal to cached energy', () => {
      let player = makePlayer({ level: 6, mp: 500 })
      player = applyBuff(player, {
        id: 'cachedEnergy',
        stacks: 200,
        ticksRemaining: 9999,
        source: 'p1',
      })
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2' })
      const state = makeState([player, enemy1, enemy2])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      // Pure damage = 200 (full cached energy), no reduction
      expect(result.state.players['e1']!.hp).toBeLessThan(enemy1.hp)
      expect(result.state.players['e2']!.hp).toBeLessThan(enemy2.hp)
    })

    it('applies slow debuff to all enemies in zone', () => {
      let player = makePlayer({ level: 6, mp: 500 })
      player = applyBuff(player, {
        id: 'cachedEnergy',
        stacks: 100,
        ticksRemaining: 9999,
        source: 'p1',
      })
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2' })
      const state = makeState([player, enemy1, enemy2])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      expect(hasBuff(result.state.players['e1']!, 'slow')).toBe(true)
      expect(hasBuff(result.state.players['e2']!, 'slow')).toBe(true)
      const slow = result.state.players['e1']!.buffs.find((b) => b.id === 'slow')
      expect(slow!.stacks).toBe(35) // 35% slow
      expect(slow!.ticksRemaining).toBe(2)
    })

    it('consumes all cached energy', () => {
      let player = makePlayer({ level: 6, mp: 500 })
      player = applyBuff(player, {
        id: 'cachedEnergy',
        stacks: 200,
        ticksRemaining: 9999,
        source: 'p1',
      })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      expect(getCachedEnergy(result.state.players['p1']!)).toBe(0)
    })

    it('still applies slow even with no cached energy (zero damage)', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      // No damage but slow still applied
      expect(result.state.players['e1']!.hp).toBe(enemy.hp)
      expect(hasBuff(result.state.players['e1']!, 'slow')).toBe(true)
    })

    it('does not damage allies', () => {
      let player = makePlayer({ level: 6, mp: 500 })
      player = applyBuff(player, {
        id: 'cachedEnergy',
        stacks: 200,
        ticksRemaining: 9999,
        source: 'p1',
      })
      const ally = makePlayer({ id: 'a1', name: 'Ally', team: 'radiant' })
      const enemy = makeEnemy()
      const state = makeState([player, ally, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      expect(result.state.players['a1']!.hp).toBe(ally.hp)
      expect(result.state.players['e1']!.hp).toBeLessThan(enemy.hp)
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(500 - 180) // R1 costs 180
      expect(updated.cooldowns.r).toBe(50)
    })

    it('scales mana cost with R level', () => {
      const player = makePlayer({ level: 18, mp: 500 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(500 - 320) // R3 costs 320
    })

    it('fails with insufficient mana', () => {
      const player = makePlayer({ level: 6, mp: 100 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'r'))
      expect(result._tag).toBe('Failure')
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
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'w'))
      expect(result._tag).toBe('Failure')
    })
  })
})
