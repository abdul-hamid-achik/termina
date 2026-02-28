import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import type { GameState, PlayerState } from '../../../shared/types/game'
import {
  resolveAbility,
  resolvePassive,
} from '../../../server/game/heroes/_base'
// Register regex hero
import '../../../server/game/heroes/regex'

// ── Test Helpers ──────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'TestRegex',
    team: 'radiant',
    heroId: 'regex',
    zone: 'mid-river',
    hp: 450,
    maxHp: 450,
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
    defense: 1,
    magicResist: 18,
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

describe('Regex Hero', () => {
  describe('Q: Grep (Magic Damage)', () => {
    it('deals magical damage to target hero', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )

      expect(result.state.players['e1']!.hp).toBeLessThan(enemy.hp)
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
      expect(updated.mp).toBe(400 - 60) // Level 1 Q costs 60
      expect(updated.cooldowns.q).toBe(6)
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
  })

  describe('W: Sed (Attack Debuff)', () => {
    it('applies sed_debuff to target with 30% attack reduction', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'e1' }),
      )

      const debuff = result.state.players['e1']!.buffs.find((b) => b.id === 'sed_debuff')
      expect(debuff).toBeDefined()
      expect(debuff!.stacks).toBe(30) // 30% reduction
      expect(debuff!.ticksRemaining).toBe(3)
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'e1' }),
      )

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(400 - 70) // Level 1 W costs 70
      expect(updated.cooldowns.w).toBe(12)
    })

    it('requires hero target', () => {
      const player = makePlayer()
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'w'))
      expect(result._tag).toBe('Failure')
    })
  })

  describe('E: Awk (Zone Control)', () => {
    it('emits zone_control_placed event', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      const zoneEvent = result.events.find((e) => e.type === 'zone_control_placed')
      expect(zoneEvent).toBeDefined()
      expect(zoneEvent!.payload['zone']).toBe('mid-river')
      expect(zoneEvent!.payload['damageType']).toBe('magical')
      expect(zoneEvent!.payload['expiryTick']).toBe(14) // tick 10 + 4
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(400 - 100) // Level 1 E costs 100
      expect(updated.cooldowns.e).toBe(20)
    })

    it('fails with insufficient mana', () => {
      const player = makePlayer({ mp: 10 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'e'))
      expect(result._tag).toBe('Failure')
    })
  })

  describe('R: Eval (Massive Damage)', () => {
    it('requires level 6+', () => {
      const player = makePlayer({ level: 5, mp: 500 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'e1' }),
      )
      expect(result._tag).toBe('Failure')
    })

    it('deals massive magical damage to target', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'e1' }),
      )

      const dmg = enemy.hp - result.state.players['e1']!.hp
      expect(dmg).toBeGreaterThan(100) // R1 base is 300 pre-mitigation
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'e1' }),
      )

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(500 - 200) // R1 costs 200
      expect(updated.cooldowns.r).toBe(45)
    })

    it('requires hero target', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'r'))
      expect(result._tag).toBe('Failure')
    })
  })

  describe('Passive: Pattern Match', () => {
    it('deals 20% bonus damage when ability hits 2+ targets', () => {
      const player = makePlayer()
      const enemy1 = makeEnemy({ hp: 500 })
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2', hp: 500 })
      const state = makeState([player, enemy1, enemy2])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'ability_cast',
        payload: {
          playerId: 'p1',
          ability: 'e',
          damage: 100,
          targets: ['e1', 'e2'],
        },
      })

      // Each target should take 20% of 100 = 20 bonus magical damage (mitigated by MR)
      expect(updated.players['e1']!.hp).toBeLessThan(500)
      expect(updated.players['e2']!.hp).toBeLessThan(500)
    })

    it('does not trigger with only 1 target', () => {
      const player = makePlayer()
      const enemy = makeEnemy({ hp: 500 })
      const state = makeState([player, enemy])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'ability_cast',
        payload: {
          playerId: 'p1',
          ability: 'q',
          damage: 100,
          targets: ['e1'],
        },
      })

      expect(updated.players['e1']!.hp).toBe(500)
    })

    it('does not trigger for other players abilities', () => {
      const player = makePlayer()
      const enemy = makeEnemy({ hp: 500 })
      const state = makeState([player, enemy])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'ability_cast',
        payload: {
          playerId: 'e1', // different player
          damage: 100,
          targets: ['p1', 'e1'],
        },
      })

      expect(updated.players['e1']!.hp).toBe(500)
    })
  })
})
