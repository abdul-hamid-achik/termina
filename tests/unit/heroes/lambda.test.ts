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
// Register lambda hero (side-effect import)
import '../../../server/game/heroes/lambda'

// ── Test Helpers ──────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'TestLambda',
    team: 'radiant',
    heroId: 'lambda',
    zone: 'mid-river',
    hp: 460,
    maxHp: 460,
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
    magicResist: 17,
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

describe('Lambda Hero', () => {
  describe('Q: Invoke', () => {
    it('deals magic damage to target hero in same zone', () => {
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
      expect(updated.mp).toBe(400 - 40) // Level 1 Q costs 40
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

    it('costs no mana with closureActive buff', () => {
      let player = makePlayer({ level: 7 })
      player = applyBuff(player, {
        id: 'closureActive',
        stacks: 1,
        ticksRemaining: 10,
        source: 'p1',
      })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(400) // No mana deducted
    })

    it('deals 30% bonus damage with closureActive buff', () => {
      const normalPlayer = makePlayer({ level: 7 })
      let closurePlayer = makePlayer({ level: 7 })
      closurePlayer = applyBuff(closurePlayer, {
        id: 'closureActive',
        stacks: 1,
        ticksRemaining: 10,
        source: 'p1',
      })
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2' })

      const state1 = makeState([normalPlayer, enemy1])
      const state2 = makeState([closurePlayer, enemy2])

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

    it('consumes closureActive after use', () => {
      let player = makePlayer({ level: 7 })
      player = applyBuff(player, {
        id: 'closureActive',
        stacks: 1,
        ticksRemaining: 10,
        source: 'p1',
      })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )

      expect(hasBuff(result.state.players['p1']!, 'closureActive')).toBe(false)
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

  describe('W: Return', () => {
    it('applies returnMark buff to self', () => {
      const player = makePlayer()
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      const updated = result.state.players['p1']!
      expect(hasBuff(updated, 'returnMark')).toBe(true)
    })

    it('records current zone in returnMark buff', () => {
      const player = makePlayer({ zone: 'mid-river' })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      const updated = result.state.players['p1']!
      const mark = updated.buffs.find((b) => b.id === 'returnMark')
      expect(mark).toBeDefined()
      expect(mark!.source).toBe('mid-river') // Zone stored in source
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(400 - 70) // Level 1 W costs 70
      expect(updated.cooldowns.w).toBe(14)
    })

    it('costs no mana with closureActive', () => {
      let player = makePlayer({ level: 7 })
      player = applyBuff(player, {
        id: 'closureActive',
        stacks: 1,
        ticksRemaining: 10,
        source: 'p1',
      })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(400) // No mana deducted
      expect(hasBuff(updated, 'closureActive')).toBe(false) // Consumed
    })

    it('fails with insufficient mana', () => {
      const player = makePlayer({ mp: 10 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'w'))
      expect(result._tag).toBe('Failure')
    })
  })

  describe('E: Map (AoE Slow + Damage)', () => {
    it('deals AoE magic damage to all enemies in zone', () => {
      const player = makePlayer({ level: 1 })
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2' })
      const state = makeState([player, enemy1, enemy2])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      expect(result.state.players['e1']!.hp).toBeLessThan(enemy1.hp)
      expect(result.state.players['e2']!.hp).toBeLessThan(enemy2.hp)
    })

    it('applies slow debuff to all enemies in zone', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      const updatedEnemy = result.state.players['e1']!
      expect(hasBuff(updatedEnemy, 'slow')).toBe(true)
      const slow = updatedEnemy.buffs.find((b) => b.id === 'slow')
      expect(slow!.stacks).toBe(30) // 30% slow
      expect(slow!.ticksRemaining).toBe(2)
    })

    it('does not damage allies', () => {
      const player = makePlayer()
      const ally = makePlayer({ id: 'a1', name: 'Ally', team: 'radiant' })
      const enemy = makeEnemy()
      const state = makeState([player, ally, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      expect(result.state.players['a1']!.hp).toBe(ally.hp)
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(400 - 80) // Level 1 E costs 80
      expect(updated.cooldowns.e).toBe(10)
    })

    it('scales damage with level', () => {
      const player1 = makePlayer({ level: 1 })
      const player7 = makePlayer({ level: 7 })
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2' })

      const state1 = makeState([player1, enemy1])
      const state2 = makeState([player7, enemy2])

      const result1 = Effect.runSync(resolveAbility(state1, 'p1', 'e'))
      const result2 = Effect.runSync(resolveAbility(state2, 'p1', 'e'))

      const dmg1 = enemy1.hp - result1.state.players['e1']!.hp
      const dmg2 = enemy2.hp - result2.state.players['e2']!.hp
      expect(dmg2).toBeGreaterThan(dmg1)
    })

    it('deals bonus damage with closureActive', () => {
      const normalPlayer = makePlayer({ level: 7 })
      let closurePlayer = makePlayer({ level: 7 })
      closurePlayer = applyBuff(closurePlayer, {
        id: 'closureActive',
        stacks: 1,
        ticksRemaining: 10,
        source: 'p1',
      })
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2' })

      const state1 = makeState([normalPlayer, enemy1])
      const state2 = makeState([closurePlayer, enemy2])

      const result1 = Effect.runSync(resolveAbility(state1, 'p1', 'e'))
      const result2 = Effect.runSync(resolveAbility(state2, 'p1', 'e'))

      const dmg1 = enemy1.hp - result1.state.players['e1']!.hp
      const dmg2 = enemy2.hp - result2.state.players['e2']!.hp
      expect(dmg2).toBeGreaterThan(dmg1)
    })

    it('fails with insufficient mana', () => {
      const player = makePlayer({ mp: 10 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'e'))
      expect(result._tag).toBe('Failure')
    })
  })

  describe('R: Reduce', () => {
    it('requires level 6+ to cast', () => {
      const player = makePlayer({ level: 5 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'e1' }),
      )
      expect(result._tag).toBe('Failure')
    })

    it('deals big single-target magic damage', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'e1' }),
      )

      const dmg = enemy.hp - result.state.players['e1']!.hp
      expect(dmg).toBeGreaterThan(100) // 300 pre-mitigation at level 1 R
    })

    it('stuns for 1 tick when closureActive is present', () => {
      let player = makePlayer({ level: 6, mp: 500 })
      player = applyBuff(player, {
        id: 'closureActive',
        stacks: 1,
        ticksRemaining: 10,
        source: 'p1',
      })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'e1' }),
      )

      const updatedEnemy = result.state.players['e1']!
      expect(hasBuff(updatedEnemy, 'stun')).toBe(true)
      const stun = updatedEnemy.buffs.find((b) => b.id === 'stun')
      expect(stun!.ticksRemaining).toBe(1)
    })

    it('does not stun without closureActive', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'e1' }),
      )

      const updatedEnemy = result.state.players['e1']!
      expect(hasBuff(updatedEnemy, 'stun')).toBe(false)
    })

    it('costs no mana with closureActive', () => {
      let player = makePlayer({ level: 6, mp: 500 })
      player = applyBuff(player, {
        id: 'closureActive',
        stacks: 1,
        ticksRemaining: 10,
        source: 'p1',
      })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'e1' }),
      )

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(500) // No mana deducted
    })

    it('consumes closureActive after use', () => {
      let player = makePlayer({ level: 6, mp: 500 })
      player = applyBuff(player, {
        id: 'closureActive',
        stacks: 1,
        ticksRemaining: 10,
        source: 'p1',
      })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'e1' }),
      )

      expect(hasBuff(result.state.players['p1']!, 'closureActive')).toBe(false)
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'e1' }),
      )

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(500 - 250) // Level 1 R costs 250
      expect(updated.cooldowns.r).toBe(50)
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

    it('requires hero target', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'r'))
      expect(result._tag).toBe('Failure')
    })

    it('fails with insufficient mana', () => {
      const player = makePlayer({ level: 6, mp: 10 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'e1' }),
      )
      expect(result._tag).toBe('Failure')
    })

    it('fails when target is in different zone', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const enemy = makeEnemy({ zone: 'top-river' })
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'e1' }),
      )
      expect(result._tag).toBe('Failure')
    })
  })

  describe('Passive: Closure', () => {
    it('tracks casts via closureCasts buff', () => {
      const player = makePlayer()
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'ability_cast',
        payload: { playerId: 'p1', ability: 'q' },
      })

      expect(getBuffStacks(updated.players['p1']!, 'closureCasts')).toBe(1)
    })

    it('increments cast count on subsequent casts', () => {
      let player = makePlayer()
      player = applyBuff(player, {
        id: 'closureCasts',
        stacks: 1,
        ticksRemaining: 4,
        source: 'p1',
      })
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'ability_cast',
        payload: { playerId: 'p1', ability: 'q' },
      })

      expect(getBuffStacks(updated.players['p1']!, 'closureCasts')).toBe(2)
    })

    it('activates closureActive after 3 casts', () => {
      let player = makePlayer()
      player = applyBuff(player, {
        id: 'closureCasts',
        stacks: 2,
        ticksRemaining: 4,
        source: 'p1',
      })
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'ability_cast',
        payload: { playerId: 'p1', ability: 'q' },
      })

      expect(hasBuff(updated.players['p1']!, 'closureActive')).toBe(true)
    })

    it('does not trigger when another player casts', () => {
      const player = makePlayer()
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'ability_cast',
        payload: { playerId: 'e1', ability: 'q' },
      })

      expect(hasBuff(updated.players['p1']!, 'closureCasts')).toBe(false)
    })

    it('does not trigger on non-ability events', () => {
      const player = makePlayer()
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'attack',
        payload: { attackerId: 'p1', targetId: 'e1' },
      })

      expect(hasBuff(updated.players['p1']!, 'closureCasts')).toBe(false)
    })

    it('does not track casts when closureActive is already present', () => {
      let player = makePlayer()
      player = applyBuff(player, {
        id: 'closureActive',
        stacks: 1,
        ticksRemaining: 10,
        source: 'p1',
      })
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'ability_cast',
        payload: { playerId: 'p1', ability: 'q' },
      })

      // closureCasts should not be incremented
      expect(getBuffStacks(updated.players['p1']!, 'closureCasts')).toBe(0)
    })

    it('closureCasts buff has 4 tick window', () => {
      const player = makePlayer()
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'ability_cast',
        payload: { playerId: 'p1', ability: 'q' },
      })

      const castsBuff = updated.players['p1']!.buffs.find((b) => b.id === 'closureCasts')
      expect(castsBuff!.ticksRemaining).toBe(4)
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
