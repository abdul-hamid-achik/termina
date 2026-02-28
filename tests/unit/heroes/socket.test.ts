import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import type { GameState, PlayerState } from '../../../shared/types/game'
import {
  resolveAbility,
  resolvePassive,
  hasBuff,
} from '../../../server/game/heroes/_base'
// Register socket hero
import '../../../server/game/heroes/socket'

// ── Test Helpers ──────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'TestSocket',
    team: 'radiant',
    heroId: 'socket',
    zone: 'mid-river',
    hp: 650,
    maxHp: 650,
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
    defense: 5,
    magicResist: 18,
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
      'mid-t1-rad': { id: 'mid-t1-rad', wards: [], creeps: [] },
      'mid-t1-dire': { id: 'mid-t1-dire', wards: [], creeps: [] },
      'top-river': { id: 'top-river', wards: [], creeps: [] },
      'rune-top': { id: 'rune-top', wards: [], creeps: [] },
      'rune-bot': { id: 'rune-bot', wards: [], creeps: [] },
      'dire-fountain': { id: 'dire-fountain', wards: [], creeps: [] },
    },
    creeps: [],
    towers: [],
    events: [],
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────

describe('Socket Hero', () => {
  describe('Q: Bind (Root)', () => {
    it('roots target hero for 2 ticks', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )

      const updatedEnemy = result.state.players['e1']!
      expect(hasBuff(updatedEnemy, 'root')).toBe(true)
      const root = updatedEnemy.buffs.find((b) => b.id === 'root')
      expect(root!.ticksRemaining).toBe(2)
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(300 - 80) // Level 1 Q costs 80
      expect(updated.cooldowns.q).toBe(12)
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

  describe('W: Listen (Trap)', () => {
    it('emits trap_placed event', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      const trapEvent = result.events.find((e) => e.type === 'trap_placed')
      expect(trapEvent).toBeDefined()
      expect(trapEvent!.payload['zone']).toBe('mid-river')
      expect(trapEvent!.payload['owner']).toBe('p1')
      expect(trapEvent!.payload['expiryTick']).toBe(40) // tick 10 + 30
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(300 - 60) // Level 1 W costs 60
      expect(updated.cooldowns.w).toBe(16)
    })

    it('fails with insufficient mana', () => {
      const player = makePlayer({ mp: 10 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'w'))
      expect(result._tag).toBe('Failure')
    })
  })

  describe('E: Accept (Pull)', () => {
    it('pulls target enemy into caster zone', () => {
      const player = makePlayer({ level: 1 })
      // Enemy in adjacent zone
      const enemy = makeEnemy({ zone: 'mid-t1-dire' })
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'e1' }),
      )

      // Enemy should have moved closer to player's zone
      const updatedEnemy = result.state.players['e1']!
      expect(updatedEnemy.zone).toBe('mid-river') // Pulled to caster's zone
    })

    it('fails if target is not in adjacent zone', () => {
      const player = makePlayer()
      const enemy = makeEnemy({ zone: 'dire-fountain' })
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'e1' }),
      )
      expect(result._tag).toBe('Failure')
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy({ zone: 'mid-t1-dire' })
      const state = makeState([player, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'e1' }),
      )

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(300 - 100) // Level 1 E costs 100
      expect(updated.cooldowns.e).toBe(20)
    })

    it('requires hero target', () => {
      const player = makePlayer()
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'e'))
      expect(result._tag).toBe('Failure')
    })
  })

  describe('R: Broadcast (Global Slow)', () => {
    it('requires level 6+', () => {
      const player = makePlayer({ level: 5, mp: 500 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'r'))
      expect(result._tag).toBe('Failure')
    })

    it('applies broadcast_slow to all enemies on the map', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2', zone: 'top-river' })
      const state = makeState([player, enemy1, enemy2])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      expect(hasBuff(result.state.players['e1']!, 'broadcast_slow')).toBe(true)
      expect(hasBuff(result.state.players['e2']!, 'broadcast_slow')).toBe(true)
      const slow = result.state.players['e1']!.buffs.find((b) => b.id === 'broadcast_slow')
      expect(slow!.ticksRemaining).toBe(3)
    })

    it('does not affect allies', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const ally = makePlayer({ id: 'a1', name: 'Ally', team: 'radiant' })
      const enemy = makeEnemy()
      const state = makeState([player, ally, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      expect(hasBuff(result.state.players['a1']!, 'broadcast_slow')).toBe(false)
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(500 - 200) // R1 costs 200
      expect(updated.cooldowns.r).toBe(55)
    })
  })

  describe('Passive: Handshake', () => {
    it('grants vision buff of attacked target for 5 ticks', () => {
      const player = makePlayer()
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'attack',
        payload: { attackerId: 'p1', targetId: 'e1' },
      })

      expect(hasBuff(updated.players['p1']!, 'handshake_vision_e1')).toBe(true)
      const visionBuff = updated.players['p1']!.buffs.find(
        (b) => b.id === 'handshake_vision_e1',
      )
      expect(visionBuff!.ticksRemaining).toBe(5)
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

      expect(hasBuff(updated.players['p1']!, 'handshake_vision_e1')).toBe(false)
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

      const hasVision = updated.players['p1']!.buffs.some((b) =>
        b.id.startsWith('handshake_vision_'),
      )
      expect(hasVision).toBe(false)
    })
  })
})
