import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import type { GameState, PlayerState } from '~~/shared/types/game'
import {
  resolveAbility,
  resolvePassive,
  applyBuff,
  hasBuff,
  getBuffStacks,
} from '~~/server/game/heroes/_base'
// Register mutex hero and import helpers
import { getDeadlockPlateBonus, getDeadlockAttackBonus } from '~~/server/game/heroes/mutex'

// ── Test Helpers ──────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  const player = {
    id: 'p1',
    name: 'TestMutex',
    team: 'chaff',
    heroId: 'mutex',
    zone: 'mid-river',
    integ: 680,
    maxInteg: 680,
    bw: 260,
    maxBw: 260,
    level: 7,
    xp: 0,
    scrip: 600,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnCycle: null,
    plate: 6,
    ice: 20,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    iceDamageDealt: 0,
    killStreak: 0,
    ...overrides,
  }
  if (player.team === 'audit' && !player.buffs.some((b) => b.id === 'breached')) {
    return {
      ...player,
      buffs: [...player.buffs, { id: 'breached', stacks: 1, cyclesRemaining: 99, source: 'test' }],
    }
  }
  return player
}

function makeEnemy(overrides: Partial<PlayerState> = {}): PlayerState {
  return makePlayer({
    id: 'e1',
    name: 'Enemy',
    team: 'audit',
    heroId: 'echo',
    integ: 550,
    maxInteg: 550,
    bw: 280,
    maxBw: 280,
    plate: 3,
    ice: 15,
    ...overrides,
  })
}

function makeState(players: PlayerState[], overrides: Partial<GameState> = {}): GameState {
  const playerMap: Record<string, PlayerState> = {}
  for (const p of players) {
    playerMap[p.id] = p
  }
  return {
    cycle: 10,
    phase: 'playing',
    teams: {
      chaff: { id: 'chaff', kills: 0, iceKills: 0, scrip: 0 },
      audit: { id: 'audit', kills: 0, iceKills: 0, scrip: 0 },
    },
    players: playerMap,
    zones: {
      'mid-river': { id: 'mid-river', wards: [], waves: [] },
      'top-river': { id: 'top-river', wards: [], waves: [] },
    },
    waves: [],
    ice: [],
    events: [],
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────

describe('Mutex Hero', () => {
  describe('Q: Lock (Physical Damage + Root)', () => {
    it('deals kinetic damage and roots target for 1 tick', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

      const updatedEnemy = result.state.players['e1']!
      expect(updatedEnemy.integ).toBeLessThan(enemy.integ)
      expect(hasBuff(updatedEnemy, 'root')).toBe(true)
      const root = updatedEnemy.buffs.find((b) => b.id === 'root')
      // raw 2 = one gated action: a cast-applied disable is reaped same-tick.
      expect(root!.cyclesRemaining).toBe(2)
    })

    it('deducts BW and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(260 - 60) // Level 1 Q costs 60
      expect(updated.cooldowns.q).toBe(8)
    })

    it('scales BW cost with level', () => {
      const player = makePlayer({ level: 7 }) // Q level 4
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(260 - 105) // Level 4 Q costs 105
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

      const dmg1 = enemy1.integ - result1.state.players['e1']!.integ
      const dmg2 = enemy2.integ - result2.state.players['e2']!.integ
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

    it('fails with insufficient BW', () => {
      const player = makePlayer({ bw: 10 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )
      expect(result._tag).toBe('Failure')
    })

    it('fails when on cooldown', () => {
      const player = makePlayer({ cooldowns: { q: 3, w: 0, e: 0, r: 0 } })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )
      expect(result._tag).toBe('Failure')
    })
  })

  describe('W: Critical Section (Shield + Defense + Self-Root)', () => {
    it('applies shield, plate bonus, and self-root', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      const updated = result.state.players['p1']!
      expect(hasBuff(updated, 'shield')).toBe(true)
      expect(hasBuff(updated, 'criticalSectionDefense')).toBe(true)
      expect(hasBuff(updated, 'root')).toBe(true)

      const shield = updated.buffs.find((b) => b.id === 'shield')
      expect(shield!.stacks).toBe(180) // Level 1 shield = 180
      expect(shield!.cyclesRemaining).toBe(2)

      const defBuff = updated.buffs.find((b) => b.id === 'criticalSectionDefense')
      expect(defBuff!.stacks).toBe(10)
      expect(defBuff!.cyclesRemaining).toBe(2)
    })

    it('scales shield amount with level', () => {
      const player = makePlayer({ level: 7 }) // W level 4
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      const shield = result.state.players['p1']!.buffs.find((b) => b.id === 'shield')
      expect(shield!.stacks).toBe(360) // Level 4 shield = 360
    })

    it('deducts BW and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(260 - 70) // Level 1 W costs 70
      expect(updated.cooldowns.w).toBe(12)
    })

    it('fails with insufficient BW', () => {
      const player = makePlayer({ bw: 10 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'w'))
      expect(result._tag).toBe('Failure')
    })
  })

  describe('E: Spinlock (AoE 3-Hit + Stacking Slow)', () => {
    it('damages all enemies in zone with 3 hits', () => {
      const player = makePlayer({ level: 1 })
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2' })
      const state = makeState([player, enemy1, enemy2])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      expect(result.state.players['e1']!.integ).toBeLessThan(enemy1.integ)
      expect(result.state.players['e2']!.integ).toBeLessThan(enemy2.integ)
    })

    it('applies stacking slow (max 30% after 3 hits)', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      const updatedEnemy = result.state.players['e1']!
      expect(hasBuff(updatedEnemy, 'slow')).toBe(true)
      const slow = updatedEnemy.buffs.find((b) => b.id === 'slow')
      expect(slow!.stacks).toBe(30) // 10% * 3 hits
      expect(slow!.cyclesRemaining).toBe(2)
    })

    it('does not affect allies', () => {
      const player = makePlayer({ level: 1 })
      const ally = makePlayer({ id: 'a1', name: 'Ally', team: 'chaff' })
      const enemy = makeEnemy()
      const state = makeState([player, ally, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      expect(result.state.players['a1']!.integ).toBe(ally.integ)
      expect(result.state.players['e1']!.integ).toBeLessThan(enemy.integ)
    })

    it('deducts BW and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(260 - 50) // Level 1 E costs 50
      expect(updated.cooldowns.e).toBe(10)
    })

    it('scales BW cost with level', () => {
      const player = makePlayer({ level: 7 }) // E level 4
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(260 - 95) // Level 4 E costs 95
    })

    it('fails with insufficient BW', () => {
      const player = makePlayer({ bw: 10 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'e'))
      expect(result._tag).toBe('Failure')
    })
  })

  describe('R: Priority Inversion (AoE Fear + Damage)', () => {
    it('requires level 6+', () => {
      const player = makePlayer({ level: 5, bw: 500 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'r'))
      expect(result._tag).toBe('Failure')
    })

    it('deals kinetic damage and applies fear for 2 ticks', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      const updatedEnemy = result.state.players['e1']!
      expect(updatedEnemy.integ).toBeLessThan(enemy.integ)
      expect(hasBuff(updatedEnemy, 'feared')).toBe(true)
      const feared = updatedEnemy.buffs.find((b) => b.id === 'feared')
      expect(feared!.cyclesRemaining).toBe(2)
    })

    it('deals bonus damage per Deadlock stack', () => {
      const playerNoStacks = makePlayer({ level: 6, bw: 500 })
      let playerWithStacks = makePlayer({ level: 6, bw: 500 })
      playerWithStacks = applyBuff(playerWithStacks, {
        id: 'deadlock',
        stacks: 5,
        cyclesRemaining: 9999,
        source: 'p1',
      })
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2' })

      const state1 = makeState([playerNoStacks, enemy1])
      const state2 = makeState([playerWithStacks, enemy2])

      const result1 = Effect.runSync(resolveAbility(state1, 'p1', 'r'))
      const result2 = Effect.runSync(resolveAbility(state2, 'p1', 'r'))

      const dmg1 = enemy1.integ - result1.state.players['e1']!.integ
      const dmg2 = enemy2.integ - result2.state.players['e2']!.integ
      expect(dmg2).toBeGreaterThan(dmg1)
    })

    it('hits all enemies in zone', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2' })
      const state = makeState([player, enemy1, enemy2])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      expect(result.state.players['e1']!.integ).toBeLessThan(enemy1.integ)
      expect(result.state.players['e2']!.integ).toBeLessThan(enemy2.integ)
      expect(hasBuff(result.state.players['e1']!, 'feared')).toBe(true)
      expect(hasBuff(result.state.players['e2']!, 'feared')).toBe(true)
    })

    it('does not damage allies', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const ally = makePlayer({ id: 'a1', name: 'Ally', team: 'chaff' })
      const enemy = makeEnemy()
      const state = makeState([player, ally, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      expect(result.state.players['a1']!.integ).toBe(ally.integ)
    })

    it('deducts BW and sets cooldown', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(500 - 200) // R1 costs 200
      expect(updated.cooldowns.r).toBe(50)
    })

    it('scales damage with R level', () => {
      const player6 = makePlayer({ level: 6, bw: 500 })
      const player18 = makePlayer({ level: 18, bw: 500 })
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2' })

      const state1 = makeState([player6, enemy1])
      const state2 = makeState([player18, enemy2])

      const result1 = Effect.runSync(resolveAbility(state1, 'p1', 'r'))
      const result2 = Effect.runSync(resolveAbility(state2, 'p1', 'r'))

      const dmg1 = enemy1.integ - result1.state.players['e1']!.integ
      const dmg2 = enemy2.integ - result2.state.players['e2']!.integ
      expect(dmg2).toBeGreaterThan(dmg1)
    })
  })

  describe('Passive: Deadlock', () => {
    it('tracks zone on first tick_end', () => {
      const player = makePlayer({ zone: 'mid-river' })
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        cycle: 10,
        type: 'tick_end',
        payload: {},
      })

      const updatedPlayer = updated.players['p1']!
      expect(hasBuff(updatedPlayer, 'deadlockZone')).toBe(true)
      const zoneBuff = updatedPlayer.buffs.find((b) => b.id === 'deadlockZone')
      expect(zoneBuff!.source).toBe('mid-river')
    })

    it('increments stacks when staying in same zone', () => {
      let player = makePlayer({ zone: 'mid-river' })
      player = applyBuff(player, {
        id: 'deadlockZone',
        stacks: 1,
        cyclesRemaining: 9999,
        source: 'mid-river',
      })
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        cycle: 11,
        type: 'tick_end',
        payload: {},
      })

      expect(getBuffStacks(updated.players['p1']!, 'deadlock')).toBe(1)
    })

    it('caps at 5 stacks', () => {
      let player = makePlayer({ zone: 'mid-river' })
      player = applyBuff(player, {
        id: 'deadlock',
        stacks: 5,
        cyclesRemaining: 9999,
        source: 'p1',
      })
      player = applyBuff(player, {
        id: 'deadlockZone',
        stacks: 1,
        cyclesRemaining: 9999,
        source: 'mid-river',
      })
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        cycle: 15,
        type: 'tick_end',
        payload: {},
      })

      expect(getBuffStacks(updated.players['p1']!, 'deadlock')).toBe(5)
    })

    it('resets stacks on move event', () => {
      let player = makePlayer({ zone: 'top-river' })
      player = applyBuff(player, {
        id: 'deadlock',
        stacks: 3,
        cyclesRemaining: 9999,
        source: 'p1',
      })
      player = applyBuff(player, {
        id: 'deadlockZone',
        stacks: 1,
        cyclesRemaining: 9999,
        source: 'mid-river',
      })
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        cycle: 11,
        type: 'move',
        payload: { playerId: 'p1', from: 'mid-river', to: 'top-river' },
      })

      expect(getBuffStacks(updated.players['p1']!, 'deadlock')).toBe(0)
      expect(hasBuff(updated.players['p1']!, 'deadlockZone')).toBe(false)
    })

    it('provides plate and attack bonuses via helper functions', () => {
      let player = makePlayer()
      player = applyBuff(player, {
        id: 'deadlock',
        stacks: 3,
        cyclesRemaining: 9999,
        source: 'p1',
      })

      expect(getDeadlockPlateBonus(player)).toBe(3) // 3 stacks * 1 def
      expect(getDeadlockAttackBonus(player)).toBe(9) // 3 stacks * 3 atk
    })

    it('returns 0 bonuses with no stacks', () => {
      const player = makePlayer()
      expect(getDeadlockPlateBonus(player)).toBe(0)
      expect(getDeadlockAttackBonus(player)).toBe(0)
    })
  })

  describe('Stun/Silence blocking', () => {
    it('prevents casting when stunned', () => {
      const player = makePlayer({
        buffs: [{ id: 'stun', stacks: 1, cyclesRemaining: 1, source: 'enemy' }],
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
        buffs: [{ id: 'silence', stacks: 1, cyclesRemaining: 2, source: 'enemy' }],
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
