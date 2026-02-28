import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import type { GameState, PlayerState } from '../../../shared/types/game'
import {
  resolveAbility,
  getAbilityLevel,
  applyBuff,
} from '../../../server/game/heroes/_base'
// Register echo hero and import helpers
import { getResonanceMultiplier } from '../../../server/game/heroes/echo'

// ── Test Helpers ──────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'TestPlayer',
    team: 'radiant',
    heroId: 'echo',
    zone: 'mid-river',
    hp: 550,
    maxHp: 550,
    mp: 280,
    maxMp: 280,
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

describe('Echo Hero', () => {
  describe('getAbilityLevel', () => {
    it('returns correct Q/W/E levels at various player levels', () => {
      expect(getAbilityLevel(1, 'q')).toBe(1)
      expect(getAbilityLevel(2, 'q')).toBe(1)
      expect(getAbilityLevel(3, 'q')).toBe(2)
      expect(getAbilityLevel(5, 'q')).toBe(3)
      expect(getAbilityLevel(7, 'q')).toBe(4)
    })

    it('returns correct R levels', () => {
      expect(getAbilityLevel(5, 'r')).toBe(0)
      expect(getAbilityLevel(6, 'r')).toBe(1)
      expect(getAbilityLevel(12, 'r')).toBe(2)
      expect(getAbilityLevel(18, 'r')).toBe(3)
    })
  })

  describe('Q: Pulse Shot', () => {
    it('deals magic damage to target hero in same zone', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

      const updatedEnemy = result.state.players['e1']!
      expect(updatedEnemy.hp).toBeLessThan(enemy.hp)
      expect(result.events.length).toBeGreaterThan(0)
      expect(result.events[0]!.type).toBe('ability_cast')
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

      const updatedPlayer = result.state.players['p1']!
      expect(updatedPlayer.mp).toBe(280 - 60) // Level 1 Q costs 60 mana
      expect(updatedPlayer.cooldowns.q).toBe(8)
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

  describe('W: Phase Shift', () => {
    it('applies phaseShift buff to self', () => {
      const player = makePlayer()
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      const updated = result.state.players['p1']!
      expect(updated.buffs.some((b) => b.id === 'phaseShift')).toBe(true)
      expect(updated.mp).toBe(280 - 50)
      expect(updated.cooldowns.w).toBe(12)
    })

    it('phaseShift buff has 1 tick duration', () => {
      const player = makePlayer()
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      const buff = result.state.players['p1']!.buffs.find((b) => b.id === 'phaseShift')
      expect(buff?.ticksRemaining).toBe(1)
    })
  })

  describe('E: Feedback Loop', () => {
    it('applies feedbackLoop buff with 3 stacks', () => {
      const player = makePlayer()
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      const updated = result.state.players['p1']!
      const buff = updated.buffs.find((b) => b.id === 'feedbackLoop')
      expect(buff).toBeDefined()
      expect(buff!.stacks).toBe(3)
    })

    it('costs mana scaled by level', () => {
      const player = makePlayer({ level: 7 }) // ability level 4
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(280 - 110) // Level 4 E costs 110
    })
  })

  describe('R: Cascade', () => {
    it('requires level 6+ to cast', () => {
      const player = makePlayer({ level: 5 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'r'))

      expect(result._tag).toBe('Failure')
    })

    it('deals AoE magic damage to all enemies in zone', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const enemy1 = makeEnemy({ id: 'e1', name: 'Enemy1' })
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2' })
      const state = makeState([player, enemy1, enemy2])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      expect(result.state.players['e1']!.hp).toBeLessThan(enemy1.hp)
      expect(result.state.players['e2']!.hp).toBeLessThan(enemy2.hp)
    })

    it('does not damage allies', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const ally = makePlayer({ id: 'a1', name: 'Ally', team: 'radiant' })
      const enemy = makeEnemy()
      const state = makeState([player, ally, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      expect(result.state.players['a1']!.hp).toBe(ally.hp)
      expect(result.state.players['e1']!.hp).toBeLessThan(enemy.hp)
    })

    it('scales damage with R level', () => {
      const player6 = makePlayer({ level: 6, mp: 500 })
      const player18 = makePlayer({ level: 18, mp: 500 })
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2' })

      const state1 = makeState([player6, enemy1])
      const state2 = makeState([player18, enemy2])

      const result1 = Effect.runSync(resolveAbility(state1, 'p1', 'r'))
      const result2 = Effect.runSync(resolveAbility(state2, 'p1', 'r'))

      const dmg1 = enemy1.hp - result1.state.players['e1']!.hp
      const dmg2 = enemy2.hp - result2.state.players['e2']!.hp
      expect(dmg2).toBeGreaterThan(dmg1) // Level 3 R does more than level 1 R
    })
  })

  describe('Passive: Resonance', () => {
    it('tracks stacks via getResonanceMultiplier', () => {
      let player = makePlayer()
      player = applyBuff(player, {
        id: 'resonance',
        stacks: 3,
        ticksRemaining: 30,
        source: 'p1',
      })

      const multiplier = getResonanceMultiplier(player)
      expect(multiplier).toBeCloseTo(1.3) // 1 + 3 * 0.1
    })

    it('starts at 1x with no stacks', () => {
      const player = makePlayer()
      expect(getResonanceMultiplier(player)).toBe(1)
    })

    it('caps at 5 stacks (1.5x)', () => {
      let player = makePlayer()
      player = applyBuff(player, {
        id: 'resonance',
        stacks: 5,
        ticksRemaining: 30,
        source: 'p1',
      })

      expect(getResonanceMultiplier(player)).toBeCloseTo(1.5)
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
