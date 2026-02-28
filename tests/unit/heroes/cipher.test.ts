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
// Register cipher hero and import helpers
import { getEncryptionKeyReduction } from '../../../server/game/heroes/cipher'

// ── Test Helpers ──────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'TestCipher',
    team: 'radiant',
    heroId: 'cipher',
    zone: 'mid-river',
    hp: 480,
    maxHp: 480,
    mp: 320,
    maxMp: 320,
    level: 7,
    xp: 0,
    gold: 600,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnTick: null,
    defense: 2,
    magicResist: 13,
    kills: 0,
    deaths: 0,
    assists: 0,
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

describe('Cipher Hero', () => {
  describe('Q: XOR Strike (Magic + Physical Damage)', () => {
    it('deals both magical and physical damage', () => {
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

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(320 - 50) // Level 1 Q costs 50
      expect(updated.cooldowns.q).toBe(5)
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

    it('breaks stealth on cast', () => {
      let player = makePlayer({ level: 1 })
      player = applyBuff(player, {
        id: 'stealth',
        stacks: 1,
        ticksRemaining: 5,
        source: 'p1',
      })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )

      expect(hasBuff(result.state.players['p1']!, 'stealth')).toBe(false)
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

  describe('W: Encrypt (Stealth)', () => {
    it('applies stealth buff for 2 ticks', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      const updated = result.state.players['p1']!
      expect(hasBuff(updated, 'stealth')).toBe(true)
      const stealth = updated.buffs.find((b) => b.id === 'stealth')
      expect(stealth!.ticksRemaining).toBe(2)
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(320 - 80) // Level 1 W costs 80
      expect(updated.cooldowns.w).toBe(14)
    })

    it('scales mana cost with level', () => {
      const player = makePlayer({ level: 7 }) // W level 4
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(320 - 140) // Level 4 W costs 140
    })

    it('fails with insufficient mana', () => {
      const player = makePlayer({ mp: 10 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'w'))
      expect(result._tag).toBe('Failure')
    })
  })

  describe('E: Decrypt (Reveal + Silence)', () => {
    it('reveals target for 3 ticks and silences for 1 tick', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'e1' }),
      )

      const updatedEnemy = result.state.players['e1']!
      expect(hasBuff(updatedEnemy, 'revealed')).toBe(true)
      expect(hasBuff(updatedEnemy, 'silence')).toBe(true)
      const revealed = updatedEnemy.buffs.find((b) => b.id === 'revealed')
      expect(revealed!.ticksRemaining).toBe(3)
      const silence = updatedEnemy.buffs.find((b) => b.id === 'silence')
      expect(silence!.ticksRemaining).toBe(1)
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'e1' }),
      )

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(320 - 90) // Level 1 E costs 90
      expect(updated.cooldowns.e).toBe(12)
    })

    it('breaks stealth on cast', () => {
      let player = makePlayer({ level: 1 })
      player = applyBuff(player, {
        id: 'stealth',
        stacks: 1,
        ticksRemaining: 5,
        source: 'p1',
      })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'e1' }),
      )

      expect(hasBuff(result.state.players['p1']!, 'stealth')).toBe(false)
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
  })

  describe('R: Brute Force (6-Hit Burst + Encryption Key)', () => {
    it('requires level 6+', () => {
      const player = makePlayer({ level: 5, mp: 500 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'e1' }),
      )
      expect(result._tag).toBe('Failure')
    })

    it('deals massive magical damage (6 hits)', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'e1' }),
      )

      const dmg = enemy.hp - result.state.players['e1']!.hp
      expect(dmg).toBeGreaterThan(100) // 6 * 55 = 330 pre-mitigation
    })

    it('applies encryptionKey stacks (capped at 4)', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'e1' }),
      )

      const updatedEnemy = result.state.players['e1']!
      expect(hasBuff(updatedEnemy, 'encryptionKey')).toBe(true)
      expect(getBuffStacks(updatedEnemy, 'encryptionKey')).toBe(4) // 6 hits but max 4
      expect(getEncryptionKeyReduction(updatedEnemy)).toBe(8) // 4 * 2
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'e1' }),
      )

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(500 - 220) // R1 costs 220
      expect(updated.cooldowns.r).toBe(45)
    })

    it('breaks stealth on cast', () => {
      let player = makePlayer({ level: 6, mp: 500 })
      player = applyBuff(player, {
        id: 'stealth',
        stacks: 1,
        ticksRemaining: 5,
        source: 'p1',
      })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'e1' }),
      )

      expect(hasBuff(result.state.players['p1']!, 'stealth')).toBe(false)
    })

    it('requires hero target', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'r'))
      expect(result._tag).toBe('Failure')
    })

    it('scales damage with R level', () => {
      const player6 = makePlayer({ level: 6, mp: 500 })
      const player18 = makePlayer({ level: 18, mp: 500 })
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2' })

      const state1 = makeState([player6, enemy1])
      const state2 = makeState([player18, enemy2])

      const result1 = Effect.runSync(
        resolveAbility(state1, 'p1', 'r', { kind: 'hero', name: 'e1' }),
      )
      const result2 = Effect.runSync(
        resolveAbility(state2, 'p1', 'r', { kind: 'hero', name: 'e2' }),
      )

      const dmg1 = enemy1.hp - result1.state.players['e1']!.hp
      const dmg2 = enemy2.hp - result2.state.players['e2']!.hp
      expect(dmg2).toBeGreaterThan(dmg1)
    })
  })

  describe('Passive: Encryption Key', () => {
    it('applies encryptionKey debuff on attack', () => {
      const player = makePlayer()
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'attack',
        payload: { attackerId: 'p1', targetId: 'e1' },
      })

      expect(hasBuff(updated.players['e1']!, 'encryptionKey')).toBe(true)
      expect(getBuffStacks(updated.players['e1']!, 'encryptionKey')).toBe(1)
    })

    it('stacks up on consecutive attacks', () => {
      const player = makePlayer()
      let enemy = makeEnemy()
      enemy = applyBuff(enemy, {
        id: 'encryptionKey',
        stacks: 2,
        ticksRemaining: 3,
        source: 'p1',
      })
      const state = makeState([player, enemy])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'attack',
        payload: { attackerId: 'p1', targetId: 'e1' },
      })

      expect(getBuffStacks(updated.players['e1']!, 'encryptionKey')).toBe(3)
    })

    it('caps at 4 stacks', () => {
      const player = makePlayer()
      let enemy = makeEnemy()
      enemy = applyBuff(enemy, {
        id: 'encryptionKey',
        stacks: 4,
        ticksRemaining: 3,
        source: 'p1',
      })
      const state = makeState([player, enemy])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'attack',
        payload: { attackerId: 'p1', targetId: 'e1' },
      })

      expect(getBuffStacks(updated.players['e1']!, 'encryptionKey')).toBe(4)
      expect(getEncryptionKeyReduction(updated.players['e1']!)).toBe(8) // 4 * 2
    })

    it('does not trigger when another player attacks', () => {
      const player = makePlayer()
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'attack',
        payload: { attackerId: 'e1', targetId: 'p1' },
      })

      expect(hasBuff(updated.players['p1']!, 'encryptionKey')).toBe(false)
    })

    it('does not trigger on non-attack events', () => {
      const player = makePlayer()
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'tick_end',
        payload: {},
      })

      expect(hasBuff(updated.players['e1']!, 'encryptionKey')).toBe(false)
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
