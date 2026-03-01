import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import type { GameState, PlayerState } from '../../../shared/types/game'
import {
  resolveAbility,
  resolvePassive,
  hasBuff,
} from '../../../server/game/heroes/_base'
// Register thread hero
import '../../../server/game/heroes/thread'

// ── Test Helpers ──────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'TestThread',
    team: 'radiant',
    heroId: 'thread',
    zone: 'mid-river',
    hp: 530,
    maxHp: 530,
    mp: 270,
    maxMp: 270,
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

describe('Thread Hero', () => {
  describe('Q: Fork (Physical Damage + Attack Buff)', () => {
    it('deals physical damage to target hero in same zone', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )

      const updatedEnemy = result.state.players['e1']!
      expect(updatedEnemy.hp).toBeLessThan(enemy.hp)
      expect(result.events.length).toBeGreaterThan(0)
      expect(result.events[0]!.type).toBe('ability_cast')
    })

    it('applies forkAtk buff to self for 3 ticks', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )

      const updated = result.state.players['p1']!
      expect(hasBuff(updated, 'forkAtk')).toBe(true)
      const buff = updated.buffs.find((b) => b.id === 'forkAtk')
      expect(buff!.stacks).toBe(20)
      expect(buff!.ticksRemaining).toBe(3)
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(270 - 55) // Level 1 Q costs 55
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

    it('scales mana cost with level', () => {
      const player = makePlayer({ level: 7 }) // Q level 4
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(270 - 100) // Level 4 Q costs 100
    })

    it('fails with InsufficientManaError when no mana', () => {
      const player = makePlayer({ mp: 10 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )
      expect(result._tag).toBe('Failure')
    })

    it('fails with CooldownError when on cooldown', () => {
      const player = makePlayer({ cooldowns: { q: 3, w: 0, e: 0, r: 0 } })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )
      expect(result._tag).toBe('Failure')
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
  })

  describe('W: Sync Barrier (Shield)', () => {
    it('applies shield buff to self', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      const updated = result.state.players['p1']!
      expect(hasBuff(updated, 'shield')).toBe(true)
      const shield = updated.buffs.find((b) => b.id === 'shield')
      expect(shield!.stacks).toBe(100) // Level 1 base shield, no allies
      expect(shield!.ticksRemaining).toBe(3)
    })

    it('increases shield per ally in zone', () => {
      const player = makePlayer({ level: 1 })
      const ally1 = makePlayer({ id: 'a1', name: 'Ally1', team: 'radiant' })
      const ally2 = makePlayer({ id: 'a2', name: 'Ally2', team: 'radiant' })
      const state = makeState([player, ally1, ally2])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      const shield = result.state.players['p1']!.buffs.find((b) => b.id === 'shield')
      expect(shield!.stacks).toBe(100 + 2 * 40) // 100 base + 2 allies * 40
    })

    it('scales base shield with level', () => {
      const player = makePlayer({ level: 7 }) // W level 4
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      const shield = result.state.players['p1']!.buffs.find((b) => b.id === 'shield')
      expect(shield!.stacks).toBe(250) // Level 4 base shield, no allies
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(270 - 70) // Level 1 W costs 70
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

  describe('E: Yield (Bonus Damage Debuff)', () => {
    it('applies yield debuff to target for 3 ticks', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'e1' }),
      )

      const updatedEnemy = result.state.players['e1']!
      expect(hasBuff(updatedEnemy, 'yield')).toBe(true)
      const debuff = updatedEnemy.buffs.find((b) => b.id === 'yield')
      expect(debuff!.stacks).toBe(25) // 25% bonus damage
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
      expect(updated.mp).toBe(270 - 60) // Level 1 E costs 60
      expect(updated.cooldowns.e).toBe(10)
    })

    it('scales mana cost with level', () => {
      const player = makePlayer({ level: 7 }) // E level 4
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'e1' }),
      )

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(270 - 105) // Level 4 E costs 105
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

  describe('R: Thread Pool (AoE Attack Buff)', () => {
    it('requires level 6+ to cast', () => {
      const player = makePlayer({ level: 5 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'r'))
      expect(result._tag).toBe('Failure')
    })

    it('applies threadPool buff to self for 4 ticks', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      const updated = result.state.players['p1']!
      expect(hasBuff(updated, 'threadPool')).toBe(true)
      const buff = updated.buffs.find((b) => b.id === 'threadPool')
      expect(buff!.ticksRemaining).toBe(4)
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(500 - 250) // R1 costs 250
      expect(updated.cooldowns.r).toBe(55)
    })

    it('scales mana cost with R level', () => {
      const player = makePlayer({ level: 18, mp: 500 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(500 - 430) // R3 costs 430
    })

    it('fails with insufficient mana', () => {
      const player = makePlayer({ level: 6, mp: 100 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'r'))
      expect(result._tag).toBe('Failure')
    })
  })

  describe('Passive: Multithread (Splash Damage)', () => {
    it('splashes 40% damage to one additional enemy on attack', () => {
      const player = makePlayer({ level: 5 })
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2' })
      const state = makeState([player, enemy1, enemy2])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'attack',
        payload: { attackerId: 'p1', targetId: 'e1', damage: 100 },
      })

      // enemy2 should have taken splash damage (40% of 100 = 40, reduced by defense)
      expect(updated.players['e2']!.hp).toBeLessThan(enemy2.hp)
    })

    it('does not splash to the primary target', () => {
      const player = makePlayer({ level: 5 })
      const enemy1 = makeEnemy()
      const state = makeState([player, enemy1])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'attack',
        payload: { attackerId: 'p1', targetId: 'e1', damage: 100 },
      })

      // With only one enemy (the target), no splash occurs — hp unchanged by passive
      expect(updated.players['e1']!.hp).toBe(enemy1.hp)
    })

    it('splashes to 2 enemies at level 10+', () => {
      const player = makePlayer({ level: 10 })
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2' })
      const enemy3 = makeEnemy({ id: 'e3', name: 'Enemy3' })
      const state = makeState([player, enemy1, enemy2, enemy3])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'attack',
        payload: { attackerId: 'p1', targetId: 'e1', damage: 100 },
      })

      // Both e2 and e3 should take splash damage
      expect(updated.players['e2']!.hp).toBeLessThan(enemy2.hp)
      expect(updated.players['e3']!.hp).toBeLessThan(enemy3.hp)
    })

    it('does nothing when no other enemies are in zone', () => {
      const player = makePlayer()
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'attack',
        payload: { attackerId: 'p1', targetId: 'e1', damage: 100 },
      })

      // No additional enemies to splash to
      expect(updated.players['e1']!.hp).toBe(enemy.hp)
    })

    it('does not trigger on non-attack events', () => {
      const player = makePlayer()
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2' })
      const state = makeState([player, enemy1, enemy2])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'ability_cast',
        payload: { playerId: 'p1' },
      })

      expect(updated.players['e2']!.hp).toBe(enemy2.hp)
    })

    it('does not trigger when another player attacks', () => {
      const player = makePlayer()
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2' })
      const state = makeState([player, enemy1, enemy2])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'attack',
        payload: { attackerId: 'e1', targetId: 'p1', damage: 100 },
      })

      expect(updated.players['e2']!.hp).toBe(enemy2.hp)
    })

    it('does not splash to enemies in different zone', () => {
      const player = makePlayer()
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2', zone: 'top-river' })
      const state = makeState([player, enemy1, enemy2])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'attack',
        payload: { attackerId: 'p1', targetId: 'e1', damage: 100 },
      })

      expect(updated.players['e2']!.hp).toBe(enemy2.hp)
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
