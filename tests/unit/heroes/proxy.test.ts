import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import type { GameState, PlayerState } from '../../../shared/types/game'
import {
  resolveAbility,
  resolvePassive,
  applyBuff,
  hasBuff,
} from '../../../server/game/heroes/_base'
// Register proxy hero
import '../../../server/game/heroes/proxy'

// ── Test Helpers ──────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'TestProxy',
    team: 'radiant',
    heroId: 'proxy',
    zone: 'mid-river',
    hp: 580,
    maxHp: 580,
    mp: 380,
    maxMp: 380,
    level: 7,
    xp: 0,
    gold: 600,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnTick: null,
    defense: 4,
    magicResist: 20,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    towerDamageDealt: 0,
    ...overrides,
  }
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
      'mid-t1-rad': { id: 'mid-t1-rad', wards: [], creeps: [] },
    },
    creeps: [],
    towers: [],
    events: [],
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────

describe('Proxy Hero', () => {
  describe('Q: Packet Redirect (Magic Damage + Slow)', () => {
    it('deals magical damage and slows target hero', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )

      const updatedEnemy = result.state.players['e1']!
      expect(updatedEnemy.hp).toBeLessThan(enemy.hp)
      expect(hasBuff(updatedEnemy, 'slow')).toBe(true)
      const slow = updatedEnemy.buffs.find((b) => b.id === 'slow')
      expect(slow!.stacks).toBe(25)
      expect(slow!.ticksRemaining).toBe(2)
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(380 - 70) // Level 1 Q costs 70
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

  describe('W: Cache Shield (Ally Shield)', () => {
    it('applies shield buff to target ally', () => {
      const player = makePlayer({ level: 1 })
      const ally = makeAlly()
      const state = makeState([player, ally])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'a1' }),
      )

      const updatedAlly = result.state.players['a1']!
      expect(hasBuff(updatedAlly, 'shield')).toBe(true)
      const shield = updatedAlly.buffs.find((b) => b.id === 'shield')
      expect(shield!.stacks).toBe(140) // Level 1 shield
      expect(shield!.ticksRemaining).toBe(3)
    })

    it('scales shield with level', () => {
      const player = makePlayer({ level: 7 }) // W level 4
      const ally = makeAlly()
      const state = makeState([player, ally])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'a1' }),
      )

      const shield = result.state.players['a1']!.buffs.find((b) => b.id === 'shield')
      expect(shield!.stacks).toBe(320) // Level 4 shield
    })

    it('can target self', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'w', { kind: 'self' }),
      )

      expect(hasBuff(result.state.players['p1']!, 'shield')).toBe(true)
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const ally = makeAlly()
      const state = makeState([player, ally])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'a1' }),
      )

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(380 - 90) // Level 1 W costs 90
      expect(updated.cooldowns.w).toBe(12)
    })

    it('fails when target is in different zone', () => {
      const player = makePlayer()
      const ally = makeAlly({ zone: 'top-river' })
      const state = makeState([player, ally])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'a1' }),
      )
      expect(result._tag).toBe('Failure')
    })
  })

  describe('E: Load Balance (Zone Heal)', () => {
    it('heals self when alone in zone', () => {
      const player = makePlayer({ level: 1, hp: 400, maxHp: 580 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      // Total heal 180, only self → full 180
      expect(result.state.players['p1']!.hp).toBe(580) // 400 + 180, capped at maxHp
    })

    it('splits healing among all allies in zone', () => {
      const player = makePlayer({ level: 1, hp: 400, maxHp: 580 })
      const ally = makeAlly({ hp: 300, maxHp: 550 })
      const state = makeState([player, ally])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      // Total 180, split between 2 → 90 each
      expect(result.state.players['p1']!.hp).toBe(490) // 400 + 90
      expect(result.state.players['a1']!.hp).toBe(390) // 300 + 90
    })

    it('does not heal above maxHp', () => {
      const player = makePlayer({ level: 7, hp: 570, maxHp: 580 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      expect(result.state.players['p1']!.hp).toBe(580)
    })

    it('does not heal allies in different zone', () => {
      const player = makePlayer({ level: 1, hp: 400, maxHp: 580 })
      const ally = makeAlly({ hp: 300, zone: 'top-river' })
      const state = makeState([player, ally])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      // Only self → full 180
      expect(result.state.players['p1']!.hp).toBe(580) // 400 + 180 capped
      expect(result.state.players['a1']!.hp).toBe(300) // unchanged
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(380 - 100) // Level 1 E costs 100
      expect(updated.cooldowns.e).toBe(10)
    })

    it('fails with insufficient mana', () => {
      const player = makePlayer({ mp: 10 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'e'))
      expect(result._tag).toBe('Failure')
    })
  })

  describe('R: Reverse Proxy (Swap + Invulnerability)', () => {
    it('requires level 6+', () => {
      const player = makePlayer({ level: 5, mp: 500 })
      const ally = makeAlly()
      const state = makeState([player, ally])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'a1' }),
      )
      expect(result._tag).toBe('Failure')
    })

    it('swaps zones between caster and ally', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const ally = makeAlly({ zone: 'top-river' })
      const state = makeState([player, ally])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'a1' }),
      )

      expect(result.state.players['p1']!.zone).toBe('top-river')
      expect(result.state.players['a1']!.zone).toBe('mid-river')
    })

    it('grants invulnerability to both for 1 tick', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const ally = makeAlly({ zone: 'top-river' })
      const state = makeState([player, ally])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'a1' }),
      )

      expect(hasBuff(result.state.players['p1']!, 'invulnerable')).toBe(true)
      expect(hasBuff(result.state.players['a1']!, 'invulnerable')).toBe(true)
      const buff = result.state.players['p1']!.buffs.find((b) => b.id === 'invulnerable')
      expect(buff!.ticksRemaining).toBe(1)
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const ally = makeAlly({ zone: 'top-river' })
      const state = makeState([player, ally])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'a1' }),
      )

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(500 - 200) // R1 costs 200
      expect(updated.cooldowns.r).toBe(50)
    })

    it('fails when targeting an enemy', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'e1' }),
      )
      expect(result._tag).toBe('Failure')
    })

    it('requires hero target', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'r'))
      expect(result._tag).toBe('Failure')
    })
  })

  describe('Passive: Middleman', () => {
    it('applies middleman buff if missing', () => {
      const player = makePlayer()
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'tick_end',
        payload: {},
      })

      expect(hasBuff(updated.players['p1']!, 'middleman')).toBe(true)
      const buff = updated.players['p1']!.buffs.find((b) => b.id === 'middleman')
      expect(buff!.stacks).toBe(12) // 12%
    })

    it('does not duplicate buff if already present', () => {
      let player = makePlayer()
      player = applyBuff(player, {
        id: 'middleman',
        stacks: 12,
        ticksRemaining: 9999,
        source: 'p1',
      })
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'tick_end',
        payload: {},
      })

      const middlemanBuffs = updated.players['p1']!.buffs.filter((b) => b.id === 'middleman')
      expect(middlemanBuffs.length).toBe(1)
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
