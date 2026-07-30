import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import type { GameState, PlayerState } from '~~/shared/types/game'
import { resolveAbility, resolvePassive, hasBuff } from '~~/server/game/heroes/_base'
// Register null_ref hero (side-effect import)
import '../../../server/game/heroes/null_ref'

// ── Test Helpers ──────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  const player = {
    id: 'p1',
    name: 'TestNullRef',
    team: 'chaff',
    heroId: 'null_ref',
    zone: 'mid-river',
    integ: 440,
    maxInteg: 440,
    bw: 420,
    maxBw: 420,
    level: 7,
    xp: 0,
    gold: 600,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnTick: null,
    plate: 1,
    ice: 16,
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
      buffs: [...player.buffs, { id: 'breached', stacks: 1, ticksRemaining: 99, source: 'test' }],
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
    tick: 10,
    phase: 'playing',
    teams: {
      chaff: { id: 'chaff', kills: 0, iceKills: 0, gold: 0 },
      audit: { id: 'audit', kills: 0, iceKills: 0, gold: 0 },
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

describe('Null (null_ref) Hero', () => {
  describe('Q: Void Bolt', () => {
    it('deals code damage to target hero in same zone', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

      const updatedEnemy = result.state.players['e1']!
      expect(updatedEnemy.integ).toBeLessThan(enemy.integ)
      expect(result.events.length).toBeGreaterThan(0)
      expect(result.events[0]!.type).toBe('ability_cast')
    })

    it('applies MR shred debuff to target', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

      const updatedEnemy = result.state.players['e1']!
      expect(hasBuff(updatedEnemy, 'mrShred')).toBe(true)
      const shred = updatedEnemy.buffs.find((b) => b.id === 'mrShred')
      expect(shred!.stacks).toBe(5) // 5 MR reduction
      expect(shred!.ticksRemaining).toBe(3)
    })

    it('deducts BW and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(420 - 55) // Level 1 Q costs 55 mana
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

      const dmg1 = enemy1.integ - result1.state.players['e1']!.integ
      const dmg2 = enemy2.integ - result2.state.players['e2']!.integ
      expect(dmg2).toBeGreaterThan(dmg1)
    })

    it('fails with InsufficientBwError when no BW', () => {
      const player = makePlayer({ bw: 10 })
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

    it('requires hero target', () => {
      const player = makePlayer()
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'q'))
      expect(result._tag).toBe('Failure')
    })
  })

  describe('W: Null Pointer (Silence)', () => {
    it('applies silence debuff for 2 ticks', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'e1' }))

      const updatedEnemy = result.state.players['e1']!
      expect(hasBuff(updatedEnemy, 'silence')).toBe(true)
      const silence = updatedEnemy.buffs.find((b) => b.id === 'silence')
      expect(silence!.ticksRemaining).toBe(2)
    })

    it('deducts BW and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'e1' }))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(420 - 80) // Level 1 W costs 80
      expect(updated.cooldowns.w).toBe(12)
    })

    it('scales BW cost with level', () => {
      const player = makePlayer({ level: 7 }) // W level 4
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'e1' }))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(420 - 125) // Level 4 W costs 125
    })

    it('fails with insufficient BW', () => {
      const player = makePlayer({ bw: 10 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'e1' }),
      )
      expect(result._tag).toBe('Failure')
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
  })

  describe('E: Void Zone (AoE DoT)', () => {
    it('applies DoT debuff to all enemies in zone', () => {
      const player = makePlayer({ level: 1 })
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2' })
      const state = makeState([player, enemy1, enemy2])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      const updatedE1 = result.state.players['e1']!
      const updatedE2 = result.state.players['e2']!
      const dot1 = updatedE1.buffs.find((b) => b.id === 'voidZone_dot')
      const dot2 = updatedE2.buffs.find((b) => b.id === 'voidZone_dot')
      expect(dot1).toBeDefined()
      expect(dot2).toBeDefined()
      expect(dot1!.stacks).toBe(40) // 40 damage per tick at level 1
      expect(dot1!.ticksRemaining).toBe(3)
    })

    it('applies revealed debuff to all enemies in zone', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      const updatedEnemy = result.state.players['e1']!
      expect(hasBuff(updatedEnemy, 'revealed')).toBe(true)
    })

    it('deducts BW and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(420 - 90) // Level 1 E costs 90
      expect(updated.cooldowns.e).toBe(14)
    })

    it('scales DoT damage with level', () => {
      const player = makePlayer({ level: 7 }) // E level 4
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      const dot = result.state.players['e1']!.buffs.find((b) => b.id === 'voidZone_dot')
      expect(dot!.stacks).toBe(85) // 85 damage per tick at level 4
    })

    it('does not affect allies', () => {
      const player = makePlayer()
      const ally = makePlayer({ id: 'a1', name: 'Ally', team: 'chaff' })
      const enemy = makeEnemy()
      const state = makeState([player, ally, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      const updatedAlly = result.state.players['a1']!
      expect(hasBuff(updatedAlly, 'voidZone_dot')).toBe(false)
    })

    it('fails with insufficient BW', () => {
      const player = makePlayer({ bw: 10 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'e'))
      expect(result._tag).toBe('Failure')
    })
  })

  describe('R: Dereference (AoE Execute)', () => {
    it('requires level 6+ to cast', () => {
      const player = makePlayer({ level: 5 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'r'))
      expect(result._tag).toBe('Failure')
    })

    it('deals AoE code damage to all enemies in zone', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2' })
      const state = makeState([player, enemy1, enemy2])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      expect(result.state.players['e1']!.integ).toBeLessThan(enemy1.integ)
      expect(result.state.players['e2']!.integ).toBeLessThan(enemy2.integ)
    })

    it('AOE+ talent (Cascading Dereference) also hits enemies in adjacent zones', () => {
      const player = makePlayer({
        level: 6,
        bw: 500,
        talents: { tier10: null, tier15: null, tier20: null, tier25: 'null_ref_25_right' },
      })
      const enemyInZone = makeEnemy({ integ: 800, maxInteg: 800 })
      // mid-t1-audit is adjacent to mid-river (the caster's zone).
      const enemyAdjacent = makeEnemy({
        id: 'e2',
        name: 'Enemy2',
        zone: 'mid-t1-audit',
        integ: 800,
        maxInteg: 800,
      })
      const state = makeState([player, enemyInZone, enemyAdjacent])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      // Both the in-zone enemy and the adjacent-zone enemy are hit with AOE+.
      expect(result.state.players['e1']!.integ).toBeLessThan(enemyInZone.integ)
      expect(result.state.players['e2']!.integ).toBeLessThan(enemyAdjacent.integ)
    })

    it('without AOE+ talent, Dereference does not hit enemies in adjacent zones', () => {
      const player = makePlayer({ level: 6, bw: 500 }) // no tier-25 talent
      const enemyInZone = makeEnemy({ integ: 800, maxInteg: 800 })
      const enemyAdjacent = makeEnemy({
        id: 'e2',
        name: 'Enemy2',
        zone: 'mid-t1-audit',
        integ: 800,
        maxInteg: 800,
      })
      const state = makeState([player, enemyInZone, enemyAdjacent])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      // In-zone enemy hit; adjacent-zone enemy untouched.
      expect(result.state.players['e1']!.integ).toBeLessThan(enemyInZone.integ)
      expect(result.state.players['e2']!.integ).toBe(enemyAdjacent.integ)
    })

    it('deals 50% bonus damage to enemies below 25% INTEG', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      // Give both enemies high INTEG pools so neither dies, but set current INTEG differently
      const healthyEnemy = makeEnemy({ integ: 800, maxInteg: 800 }) // 100% INTEG — above 25%
      const lowEnemy = makeEnemy({ id: 'e2', name: 'Enemy2', integ: 800, maxInteg: 4000 }) // 20% INTEG — below 25%
      const state = makeState([player, healthyEnemy, lowEnemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      const healthyDmg = healthyEnemy.integ - result.state.players['e1']!.integ
      const lowDmg = lowEnemy.integ - result.state.players['e2']!.integ
      // Low INTEG enemy should take more damage (50% bonus)
      expect(lowDmg).toBeGreaterThan(healthyDmg)
    })

    it('does not deal bonus to enemies above 25% INTEG', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const enemy1 = makeEnemy({ integ: 400, maxInteg: 550 }) // ~73% INTEG
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2', integ: 400, maxInteg: 550 }) // ~73% INTEG
      const state = makeState([player, enemy1, enemy2])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      const dmg1 = enemy1.integ - result.state.players['e1']!.integ
      const dmg2 = enemy2.integ - result.state.players['e2']!.integ
      // Both should take equal damage (no execute bonus)
      expect(dmg1).toBe(dmg2)
    })

    it('does not damage allies', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const ally = makePlayer({ id: 'a1', name: 'Ally', team: 'chaff' })
      const enemy = makeEnemy()
      const state = makeState([player, ally, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      expect(result.state.players['a1']!.integ).toBe(ally.integ)
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(500 - 280) // Level 1 R costs 280
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

    it('fails with insufficient BW', () => {
      const player = makePlayer({ level: 6, bw: 10 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'r'))
      expect(result._tag).toBe('Failure')
    })
  })

  describe('Passive: Void Drain', () => {
    it('restores 15% max BW on kill', () => {
      const player = makePlayer({ bw: 200, maxBw: 420 }) // 15% of 420 = 63
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'kill',
        payload: { killerId: 'p1', victimId: 'e1' },
      })

      expect(updated.players['p1']!.bw).toBe(200 + 63) // 263
    })

    it('caps BW at maxBw', () => {
      const player = makePlayer({ bw: 400, maxBw: 420 }) // 15% of 420 = 63, would exceed max
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'kill',
        payload: { killerId: 'p1', victimId: 'e1' },
      })

      expect(updated.players['p1']!.bw).toBe(420) // Capped at max
    })

    it('reduces all cooldowns by 2 on kill', () => {
      const player = makePlayer({ cooldowns: { q: 5, w: 10, e: 3, r: 1 } })
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'kill',
        payload: { killerId: 'p1', victimId: 'e1' },
      })

      const cd = updated.players['p1']!.cooldowns
      expect(cd.q).toBe(3) // 5 - 2
      expect(cd.w).toBe(8) // 10 - 2
      expect(cd.e).toBe(1) // 3 - 2
      expect(cd.r).toBe(0) // 1 - 2, clamped to 0
    })

    it('applies voidDrain buff for tracking', () => {
      const player = makePlayer()
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'kill',
        payload: { killerId: 'p1', victimId: 'e1' },
      })

      expect(hasBuff(updated.players['p1']!, 'voidDrain')).toBe(true)
    })

    it('does not trigger when another player gets the kill', () => {
      const player = makePlayer()
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'kill',
        payload: { killerId: 'e1', victimId: 'p1' },
      })

      expect(updated.players['p1']!.bw).toBe(420) // No BW restored
    })

    it('does not trigger on non-kill events', () => {
      const player = makePlayer({ cooldowns: { q: 5, w: 5, e: 5, r: 5 } })
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'attack',
        payload: { attackerId: 'p1', targetId: 'e1' },
      })

      expect(updated.players['p1']!.cooldowns.q).toBe(5) // Unchanged
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
