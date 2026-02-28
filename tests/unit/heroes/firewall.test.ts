import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import type { GameState, PlayerState } from '../../../shared/types/game'
import {
  resolveAbility,
  resolvePassive,
  applyBuff,
  hasBuff,
} from '../../../server/game/heroes/_base'
// Register firewall hero
import '../../../server/game/heroes/firewall'

// ── Test Helpers ──────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'TestFirewall',
    team: 'radiant',
    heroId: 'firewall',
    zone: 'mid-river',
    hp: 720,
    maxHp: 720,
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
    defense: 7,
    magicResist: 22,
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

describe('Firewall Hero', () => {
  describe('Q: Port Block (Physical Damage + Stun)', () => {
    it('deals physical damage and stuns target for 1 tick', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )

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

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(270 - 70) // Level 1 Q costs 70
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

  describe('W: DMZ (Shield)', () => {
    it('applies shield buff to self', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      const updated = result.state.players['p1']!
      expect(hasBuff(updated, 'shield')).toBe(true)
      const shield = updated.buffs.find((b) => b.id === 'shield')
      expect(shield!.stacks).toBe(200) // Level 1 shield
      expect(shield!.ticksRemaining).toBe(3)
    })

    it('scales shield with level', () => {
      const player = makePlayer({ level: 7 }) // W level 4
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      const shield = result.state.players['p1']!.buffs.find((b) => b.id === 'shield')
      expect(shield!.stacks).toBe(500) // Level 4 shield
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(270 - 80) // Level 1 W costs 80
      expect(updated.cooldowns.w).toBe(14)
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

  describe('E: Access Control (Taunt)', () => {
    it('taunts all enemies in zone for 2 ticks', () => {
      const player = makePlayer({ level: 1 })
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2' })
      const state = makeState([player, enemy1, enemy2])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      expect(hasBuff(result.state.players['e1']!, 'taunt')).toBe(true)
      expect(hasBuff(result.state.players['e2']!, 'taunt')).toBe(true)
      const taunt = result.state.players['e1']!.buffs.find((b) => b.id === 'taunt')
      expect(taunt!.ticksRemaining).toBe(2)
    })

    it('does not affect allies', () => {
      const player = makePlayer({ level: 1 })
      const ally = makePlayer({ id: 'a1', name: 'Ally', team: 'radiant' })
      const enemy = makeEnemy()
      const state = makeState([player, ally, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      expect(hasBuff(result.state.players['a1']!, 'taunt')).toBe(false)
      expect(hasBuff(result.state.players['e1']!, 'taunt')).toBe(true)
    })

    it('does not taunt enemies in different zone', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy({ zone: 'top-river' })
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      expect(hasBuff(result.state.players['e1']!, 'taunt')).toBe(false)
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(270 - 60) // Level 1 E costs 60
      expect(updated.cooldowns.e).toBe(16)
    })

    it('fails with insufficient mana', () => {
      const player = makePlayer({ mp: 10 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'e'))
      expect(result._tag).toBe('Failure')
    })
  })

  describe('R: Deep Packet Inspection (Root + DoT)', () => {
    it('requires level 6+', () => {
      const player = makePlayer({ level: 5, mp: 500 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'r'))
      expect(result._tag).toBe('Failure')
    })

    it('roots all enemies in zone for 2 ticks', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2' })
      const state = makeState([player, enemy1, enemy2])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      expect(hasBuff(result.state.players['e1']!, 'root')).toBe(true)
      expect(hasBuff(result.state.players['e2']!, 'root')).toBe(true)
      const root = result.state.players['e1']!.buffs.find((b) => b.id === 'root')
      expect(root!.ticksRemaining).toBe(2)
    })

    it('applies DoT debuff for 3 ticks', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      const updatedEnemy = result.state.players['e1']!
      expect(hasBuff(updatedEnemy, 'dpi_dot')).toBe(true)
      const dot = updatedEnemy.buffs.find((b) => b.id === 'dpi_dot')
      expect(dot!.ticksRemaining).toBe(3)
      expect(dot!.stacks).toBe(40) // 120 total / 3 ticks = 40 per tick at R1
    })

    it('does not affect allies', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const ally = makePlayer({ id: 'a1', name: 'Ally', team: 'radiant' })
      const enemy = makeEnemy()
      const state = makeState([player, ally, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      expect(hasBuff(result.state.players['a1']!, 'root')).toBe(false)
      expect(hasBuff(result.state.players['a1']!, 'dpi_dot')).toBe(false)
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(500 - 250) // R1 costs 250
      expect(updated.cooldowns.r).toBe(55)
    })

    it('scales DoT damage with R level', () => {
      const player18 = makePlayer({ level: 18, mp: 500 })
      const enemy = makeEnemy()
      const state = makeState([player18, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      const dot = result.state.players['e1']!.buffs.find((b) => b.id === 'dpi_dot')
      expect(dot!.stacks).toBe(93) // 280 total / 3 = 93 per tick at R3
    })
  })

  describe('Passive: Packet Inspection', () => {
    it('applies packetInspection buff if missing', () => {
      const player = makePlayer()
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'tick_end',
        payload: {},
      })

      expect(hasBuff(updated.players['p1']!, 'packetInspection')).toBe(true)
      const buff = updated.players['p1']!.buffs.find((b) => b.id === 'packetInspection')
      expect(buff!.stacks).toBe(8) // 8%
    })

    it('does not duplicate buff if already present', () => {
      let player = makePlayer()
      player = applyBuff(player, {
        id: 'packetInspection',
        stacks: 8,
        ticksRemaining: 9999,
        source: 'p1',
      })
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'tick_end',
        payload: {},
      })

      const piBuffs = updated.players['p1']!.buffs.filter((b) => b.id === 'packetInspection')
      expect(piBuffs.length).toBe(1)
    })

    it('reflects damage on damage_taken event', () => {
      let player = makePlayer()
      player = applyBuff(player, {
        id: 'packetInspection',
        stacks: 8,
        ticksRemaining: 9999,
        source: 'p1',
      })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'damage_taken',
        payload: { targetId: 'p1', attackerId: 'e1', damage: 100 },
      })

      // 8% of 100 = 8 magical damage reflected (mitigated by magic resist)
      expect(updated.players['e1']!.hp).toBeLessThan(enemy.hp)
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
