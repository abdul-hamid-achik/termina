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
// Register daemon hero
import '../../../server/game/heroes/daemon'

// ── Test Helpers ──────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'TestDaemon',
    team: 'radiant',
    heroId: 'daemon',
    zone: 'mid-river',
    hp: 480,
    maxHp: 480,
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
    defense: 3,
    magicResist: 15,
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
      'mid-t1-dire': { id: 'mid-t1-dire', wards: [], creeps: [] },
      'rune-top': { id: 'rune-top', wards: [], creeps: [] },
      'rune-bot': { id: 'rune-bot', wards: [], creeps: [] },
    },
    creeps: [],
    towers: [],
    events: [],
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────

describe('Daemon Hero', () => {
  describe('Passive: Stealth', () => {
    it('activates stealth after 2 idle ticks', () => {
      const player = makePlayer()
      let state = makeState([player])

      // Tick 1
      state = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'tick_end',
        payload: {},
      })
      expect(hasBuff(state.players['p1']!, 'stealth')).toBe(false)
      expect(getBuffStacks(state.players['p1']!, 'stealthIdle')).toBe(1)

      // Tick 2
      state = resolvePassive(state, 'p1', {
        tick: 11,
        type: 'tick_end',
        payload: {},
      })
      expect(hasBuff(state.players['p1']!, 'stealth')).toBe(true)
    })

    it('breaks stealth on attack', () => {
      let player = makePlayer()
      player = applyBuff(player, {
        id: 'stealth',
        stacks: 1,
        ticksRemaining: 99,
        source: 'p1',
      })
      player = applyBuff(player, {
        id: 'stealthIdle',
        stacks: 3,
        ticksRemaining: 99,
        source: 'p1',
      })
      let state = makeState([player])

      state = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'attack',
        payload: { attackerId: 'p1', targetId: 'e1' },
      })

      expect(hasBuff(state.players['p1']!, 'stealth')).toBe(false)
      expect(getBuffStacks(state.players['p1']!, 'stealthIdle')).toBe(0)
    })

    it('resets idle counter on ability cast', () => {
      let player = makePlayer()
      player = applyBuff(player, {
        id: 'stealthIdle',
        stacks: 1,
        ticksRemaining: 99,
        source: 'p1',
      })
      let state = makeState([player])

      state = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'ability_cast',
        payload: { playerId: 'p1' },
      })

      expect(getBuffStacks(state.players['p1']!, 'stealthIdle')).toBe(0)
    })
  })

  describe('Q: Inject (DoT)', () => {
    it('applies inject_dot debuff to target', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

      const updatedEnemy = result.state.players['e1']!
      const dot = updatedEnemy.buffs.find((b) => b.id === 'inject_dot')
      expect(dot).toBeDefined()
      expect(dot!.ticksRemaining).toBe(3)
      expect(dot!.stacks).toBe(20) // 60 total / 3 ticks = 20 per tick at level 1
    })

    it('scales DoT damage with level', () => {
      const player = makePlayer({ level: 7 }) // Q level 4
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

      const dot = result.state.players['e1']!.buffs.find((b) => b.id === 'inject_dot')
      expect(dot!.stacks).toBe(60) // 180 total / 3 ticks = 60 per tick at level 4
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(300 - 50) // Level 1 costs 50
      expect(updated.cooldowns.q).toBe(7)
    })

    it('breaks stealth when casting', () => {
      let player = makePlayer()
      player = applyBuff(player, {
        id: 'stealth',
        stacks: 1,
        ticksRemaining: 99,
        source: 'p1',
      })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

      expect(hasBuff(result.state.players['p1']!, 'stealth')).toBe(false)
    })
  })

  describe('E: Sudo (Execute)', () => {
    it('executes target below 30% HP with pure damage', () => {
      const player = makePlayer({ level: 6, mp: 500 }) // E level 3 (at player level 5), R level 1
      // Actually E is at level 3 at player level 5, level 4 at player level 7
      // But E_DAMAGE is only [300, 400, 500] — that's R-style scaling
      // Wait, E_DAMAGE is defined with 3 values because it's "execute" tier
      // Actually looking at my code, E uses scaleValue with level from getAbilityLevel
      // At level 6, E level = 3 (learned at 1,3,5 → levels 1,2,3), hmm
      // getAbilityLevel(6, 'e') = level 3 (player level 5 → 3, 6 → 3)
      // So E at level 6 player = ability level 3 → E_DAMAGE[2] = 500
      const enemy = makeEnemy({ hp: 100, maxHp: 550 }) // 100/550 ≈ 18% — below 30%
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'e1' }))

      // Should deal massive pure damage, likely killing the target
      expect(result.state.players['e1']!.hp).toBe(0)
      expect(result.state.players['e1']!.alive).toBe(false)
    })

    it('fails (no mana/CD cost) when target above 30% HP', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const enemy = makeEnemy({ hp: 400, maxHp: 550 }) // 400/550 ≈ 73% — above 30%
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'e1' }))

      // Ability fails but doesn't error — no mana deducted, no cooldown
      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(500) // Mana not deducted
      expect(updated.cooldowns.e).toBe(0) // No cooldown set
      expect(result.events[0]!.type).toBe('ability_failed')
    })

    it('requires hero target', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'e'))

      expect(result._tag).toBe('Failure')
    })
  })

  describe('W: Fork Bomb (Decoy)', () => {
    it('emits decoy_spawned event with target zone', () => {
      const player = makePlayer()
      const state = makeState([player])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'top-river' }),
      )

      const decoyEvent = result.events.find((e) => e.type === 'decoy_spawned')
      expect(decoyEvent).toBeDefined()
      expect(decoyEvent!.payload['zone']).toBe('top-river')
      expect(decoyEvent!.payload['heroId']).toBe('daemon')
    })

    it('deducts 100 mana and sets 18 tick cooldown', () => {
      const player = makePlayer()
      const state = makeState([player])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'top-river' }),
      )

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(300 - 100)
      expect(updated.cooldowns.w).toBe(18)
    })
  })

  describe('R: Root Access (Teleport)', () => {
    it('teleports to target zone', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const state = makeState([player])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'rune-top' }),
      )

      expect(result.state.players['p1']!.zone).toBe('rune-top')
    })

    it('requires level 6+ for R', () => {
      const player = makePlayer({ level: 5, mp: 500 })
      const state = makeState([player])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'rune-top' }),
      )

      expect(result._tag).toBe('Failure')
    })

    it('sets cooldown and deducts mana', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const state = makeState([player])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'rune-top' }),
      )

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(500 - 200) // Level 1 R costs 200
      expect(updated.cooldowns.r).toBe(60)
    })

    it('breaks stealth on teleport', () => {
      let player = makePlayer({ level: 6, mp: 500 })
      player = applyBuff(player, {
        id: 'stealth',
        stacks: 1,
        ticksRemaining: 99,
        source: 'p1',
      })
      const state = makeState([player])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'rune-top' }),
      )

      expect(hasBuff(result.state.players['p1']!, 'stealth')).toBe(false)
    })
  })
})
