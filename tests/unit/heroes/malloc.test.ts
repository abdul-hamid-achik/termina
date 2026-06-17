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
// Register malloc hero and import helpers
import { getHeapGrowthBonus } from '../../../server/game/heroes/malloc'
import { getEffectiveAttack, getTalentStatBonus } from '../../../server/game/engine/EffectiveStats'
import { TALENT_TREES } from '../../../shared/constants/talents'

// ── Test Helpers ──────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'TestMalloc',
    team: 'radiant',
    heroId: 'malloc',
    zone: 'mid-river',
    hp: 520,
    maxHp: 520,
    mp: 300,
    maxMp: 300,
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
    killStreak: 0,
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

describe('Malloc Hero', () => {
  describe('Q: Allocate (Self Attack Buff)', () => {
    it('applies allocate buff with 25 stacks for 3 ticks', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q'))

      const updated = result.state.players['p1']!
      expect(hasBuff(updated, 'allocate')).toBe(true)
      const buff = updated.buffs.find((b) => b.id === 'allocate')
      expect(buff!.stacks).toBe(25)
      expect(buff!.ticksRemaining).toBe(3)
    })

    it('feeds the allocate buff into effective attack (was ignored — +0 attack)', () => {
      const base = makePlayer({ gold: 0 })
      const withAllocate = applyBuff(makePlayer({ gold: 0 }), {
        id: 'allocate',
        stacks: 25,
        ticksRemaining: 3,
        source: 'p1',
      })
      // Before the fix, getEffectiveAttack omitted 'allocate' → delta was 0.
      expect(getEffectiveAttack(withAllocate) - getEffectiveAttack(base)).toBe(25)
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q'))

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(300 - 60) // Level 1 Q costs 60
      expect(updated.cooldowns.q).toBe(8)
    })

    it('scales mana cost with level', () => {
      const player = makePlayer({ level: 7 }) // Q level 4
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q'))

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(300 - 120) // Level 4 Q costs 120
    })

    it('fails with insufficient mana', () => {
      const player = makePlayer({ mp: 10 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'q'))
      expect(result._tag).toBe('Failure')
    })

    it('fails when on cooldown', () => {
      const player = makePlayer({ cooldowns: { q: 3, w: 0, e: 0, r: 0 } })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'q'))
      expect(result._tag).toBe('Failure')
    })
  })

  describe('W: Free() (Physical Damage + Low HP Bonus)', () => {
    it('deals physical damage to target hero', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'e1' }))

      expect(result.state.players['e1']!.hp).toBeLessThan(enemy.hp)
      expect(result.events[0]!.type).toBe('ability_cast')
    })

    it('deals 40% bonus damage when target is below 30% HP', () => {
      const player = makePlayer({ level: 1 })
      const enemy1 = makeEnemy({ hp: 550 }) // 100% HP - no bonus
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2', hp: 160, maxHp: 550 }) // ~29% HP - bonus

      const state1 = makeState([player, enemy1])
      const state2 = makeState([makePlayer({ level: 1 }), enemy2])

      const result1 = Effect.runSync(
        resolveAbility(state1, 'p1', 'w', { kind: 'hero', name: 'e1' }),
      )
      const result2 = Effect.runSync(
        resolveAbility(state2, 'p1', 'w', { kind: 'hero', name: 'e2' }),
      )

      const dmg1 = enemy1.hp - result1.state.players['e1']!.hp
      const dmg2 = enemy2.hp - result2.state.players['e2']!.hp
      // With low HP bonus the raw damage is 40% higher before mitigation
      expect(dmg2).toBeGreaterThan(dmg1)
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'e1' }))

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(300 - 70) // Level 1 W costs 70
      expect(updated.cooldowns.w).toBe(7)
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

  describe('E: Pointer Dereference (Dash + Stun)', () => {
    it('deals physical damage and stuns target for 1 tick', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'e1' }))

      const updatedEnemy = result.state.players['e1']!
      expect(updatedEnemy.hp).toBeLessThan(enemy.hp)
      expect(hasBuff(updatedEnemy, 'stun')).toBe(true)
      const stun = updatedEnemy.buffs.find((b) => b.id === 'stun')
      expect(stun!.ticksRemaining).toBe(1)
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'e1' }))

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(300 - 80) // Level 1 E costs 80
      expect(updated.cooldowns.e).toBe(12)
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

  describe('R: Stack Overflow (AoE Physical)', () => {
    it('requires level 6+', () => {
      const player = makePlayer({ level: 5, mp: 500 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'r'))
      expect(result._tag).toBe('Failure')
    })

    it('deals AoE physical damage to all enemies in zone', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const enemy1 = makeEnemy()
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

    it('costs the caster 20% of current HP (self-sacrifice)', () => {
      const player = makePlayer({ level: 6, mp: 500, hp: 1000, maxHp: 1000 })
      const state = makeState([player, makeEnemy()])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      // 20% of 1000 current HP = 200 burned → 800 left.
      expect(result.state.players['p1']!.hp).toBe(800)
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(500 - 150) // R1 costs 150
      expect(updated.cooldowns.r).toBe(50)
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
      expect(dmg2).toBeGreaterThan(dmg1)
    })
  })

  describe('Passive: Heap Growth', () => {
    it('grants bonus attack based on gold (1 per 100)', () => {
      const player = makePlayer({ gold: 500 })
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'tick_end',
        payload: {},
      })

      expect(getBuffStacks(updated.players['p1']!, 'heapGrowth')).toBe(5)
      expect(getHeapGrowthBonus(updated.players['p1']!)).toBe(5)
    })

    it('caps the heap-growth bonus at +40, no matter how much gold is hoarded', () => {
      // 6000 gold would be +60 at a raw 1-per-100, but the passive caps it at +40
      // (reached at 4000 gold) — the boundary the ability description now states.
      const player = makePlayer({ gold: 6000 })
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', { tick: 10, type: 'tick_end', payload: {} })

      expect(getHeapGrowthBonus(updated.players['p1']!)).toBe(40)
    })

    it('returns 0 with no gold', () => {
      const player = makePlayer({ gold: 50 })
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'tick_end',
        payload: {},
      })

      expect(getHeapGrowthBonus(updated.players['p1']!)).toBe(0)
    })

    it('updates stacks when gold changes', () => {
      let player = makePlayer({ gold: 300 })
      player = applyBuff(player, {
        id: 'heapGrowth',
        stacks: 3,
        ticksRemaining: 9999,
        source: 'p1',
      })
      // Simulate gold increasing
      player = { ...player, gold: 700 }
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'tick_end',
        payload: {},
      })

      expect(getHeapGrowthBonus(updated.players['p1']!)).toBe(7)
    })

    it('feeds heapGrowth stacks into effective attack (was ignored — the dead-passive bug)', () => {
      const base = makePlayer({ gold: 0 })
      const withHeap = applyBuff(makePlayer({ gold: 0 }), {
        id: 'heapGrowth',
        stacks: 12,
        ticksRemaining: 9999,
        source: 'p1',
      })
      // Before the fix, getEffectiveAttack ignored heapGrowth → delta was 0.
      expect(getEffectiveAttack(withHeap) - getEffectiveAttack(base)).toBe(12)
    })
  })

  describe('Stun/Silence blocking', () => {
    it('prevents casting when stunned', () => {
      const player = makePlayer({
        buffs: [{ id: 'stun', stacks: 1, ticksRemaining: 1, source: 'enemy' }],
      })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'q'))
      expect(result._tag).toBe('Failure')
    })
  })

  // Malloc has a HERO-TAILORED tree (no longer the shared generic menu): talents
  // built around its real kit — Free() execute, Pointer Dereference gap-close,
  // Stack Overflow AoE — plus carry stats. Crucially its damage_boost talents sit
  // on W/R (real damage), NOT Q: Q (Allocate) is a self-buff, so the old generic
  // +Q-damage talent was a silent no-op for malloc.
  describe('Tailored talents (hero-specific tree)', () => {
    it('malloc_15_left adds 30% to Free() (W) damage — a boost the generic +Q-damage could not give', () => {
      const enemyBase = makeEnemy()
      const base = Effect.runSync(
        resolveAbility(makeState([makePlayer({ level: 7 }), enemyBase]), 'p1', 'w', {
          kind: 'hero',
          name: 'e1',
        }),
      )
      const baseDmg = enemyBase.hp - base.state.players['e1']!.hp

      const enemyBoost = makeEnemy()
      const boosted = Effect.runSync(
        resolveAbility(
          makeState([
            makePlayer({
              level: 7,
              talents: { tier10: null, tier15: 'malloc_15_left', tier20: null, tier25: null },
            }),
            enemyBoost,
          ]),
          'p1',
          'w',
          { kind: 'hero', name: 'e1' },
        ),
      )
      const boostedDmg = enemyBoost.hp - boosted.state.players['e1']!.hp
      expect(boostedDmg).toBeGreaterThan(baseDmg)
    })

    it('malloc_15_right reduces Pointer Dereference (E) cooldown by 2', () => {
      const player = makePlayer({
        level: 7,
        talents: { tier10: null, tier15: 'malloc_15_right', tier20: null, tier25: null },
      })
      const result = Effect.runSync(
        resolveAbility(makeState([player, makeEnemy()]), 'p1', 'e', { kind: 'hero', name: 'e1' }),
      )
      // E cooldownTicks (12) − 2
      expect(result.state.players['p1']!.cooldowns.e).toBe(10)
    })

    it('malloc_20_left adds 40% to Stack Overflow (R) AoE damage', () => {
      const enemyBase = makeEnemy()
      const base = Effect.runSync(
        resolveAbility(makeState([makePlayer({ level: 7, mp: 500 }), enemyBase]), 'p1', 'r'),
      )
      const baseDmg = enemyBase.hp - base.state.players['e1']!.hp

      const enemyBoost = makeEnemy()
      const boosted = Effect.runSync(
        resolveAbility(
          makeState([
            makePlayer({
              level: 7,
              mp: 500,
              talents: { tier10: null, tier15: null, tier20: 'malloc_20_left', tier25: null },
            }),
            enemyBoost,
          ]),
          'p1',
          'r',
        ),
      )
      const boostedDmg = enemyBoost.hp - boosted.state.players['e1']!.hp
      expect(boostedDmg).toBeGreaterThan(baseDmg)
    })

    it('malloc_10_left grants +15 Attack via getTalentStatBonus', () => {
      const player = makePlayer({
        talents: { tier10: 'malloc_10_left', tier15: null, tier20: null, tier25: null },
      })
      expect(getTalentStatBonus(player, 'attack')).toBe(15)
    })

    it('malloc_25_left reduces ultimate cooldown by 10', () => {
      const player = makePlayer({
        level: 6,
        mp: 500,
        talents: { tier10: null, tier15: null, tier20: null, tier25: 'malloc_25_left' },
      })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      // R_COOLDOWN (50) − 10
      expect(result.state.players['p1']!.cooldowns.r).toBe(40)
    })

    it('malloc_25_right grants +20 magic resistance (was the dead double_cast_20 no-op)', () => {
      const player = makePlayer({
        talents: { tier10: null, tier15: null, tier20: null, tier25: 'malloc_25_right' },
      })
      expect(getTalentStatBonus(player, 'magicResist')).toBe(20)
    })

    it('no malloc talent is a dead/no-op (tailored tree)', () => {
      for (const t of Object.values(TALENT_TREES.malloc.tiers).flat()) {
        expect(t.type).not.toBe('special')
        expect(t.type).not.toBe('ability_boost')
        expect((t as { specialEffect?: string }).specialEffect).toBeUndefined()
        // A damage_boost talent must sit on an ability that deals instant damage,
        // else it silently does nothing — malloc's are on W/R, never the Q self-buff.
        if (t.type === 'damage_boost') expect(t.abilityId).not.toBe('q')
      }
    })
    // All 11 formerly-generic heroes now have hero-tailored trees; the cross-hero
    // "no dead generic talent" guard lives in tailored-talents.test.ts.
  })
})
