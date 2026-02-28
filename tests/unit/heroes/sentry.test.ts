import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import type { GameState, PlayerState } from '../../../shared/types/game'
import {
  resolveAbility,
  resolvePassive,
  applyBuff,
  hasBuff,
} from '../../../server/game/heroes/_base'
// Register sentry hero
import '../../../server/game/heroes/sentry'

// ── Test Helpers ──────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'TestSentry',
    team: 'radiant',
    heroId: 'sentry',
    zone: 'mid-river',
    hp: 600,
    maxHp: 600,
    mp: 350,
    maxMp: 350,
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

describe('Sentry Hero', () => {
  describe('Q: Ping (Zone Reveal)', () => {
    it('places a ward in the target zone', () => {
      const player = makePlayer()
      const state = makeState([player])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'top-river' }),
      )

      const zone = result.state.zones['top-river']
      expect(zone!.wards.length).toBe(1)
      expect(zone!.wards[0]!.team).toBe('radiant')
      expect(zone!.wards[0]!.expiryTick).toBe(13) // tick 10 + 3
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer()
      const state = makeState([player])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'top-river' }),
      )

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(350 - 50) // Q costs 50 flat
      expect(updated.cooldowns.q).toBe(10)
    })

    it('requires a zone target', () => {
      const player = makePlayer()
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'q'))
      expect(result._tag).toBe('Failure')
    })
  })

  describe('W: Firewall (Team Damage Reduction)', () => {
    it('applies firewallDefense buff to self and allies in zone', () => {
      const player = makePlayer({ level: 1 })
      const ally = makeAlly()
      const state = makeState([player, ally])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      expect(hasBuff(result.state.players['p1']!, 'firewallDefense')).toBe(true)
      expect(hasBuff(result.state.players['a1']!, 'firewallDefense')).toBe(true)
      const buff = result.state.players['p1']!.buffs.find((b) => b.id === 'firewallDefense')
      expect(buff!.ticksRemaining).toBe(2)
    })

    it('does not affect allies in different zone', () => {
      const player = makePlayer({ level: 1 })
      const ally = makeAlly({ zone: 'top-river' })
      const state = makeState([player, ally])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      expect(hasBuff(result.state.players['p1']!, 'firewallDefense')).toBe(true)
      expect(hasBuff(result.state.players['a1']!, 'firewallDefense')).toBe(false)
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(350 - 80) // Level 1 W costs 80
      expect(updated.cooldowns.w).toBe(14)
    })
  })

  describe('E: Patch (Heal)', () => {
    it('heals target ally', () => {
      const player = makePlayer({ level: 1 })
      const ally = makeAlly({ hp: 300, maxHp: 550 })
      const state = makeState([player, ally])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'a1' }),
      )

      expect(result.state.players['a1']!.hp).toBe(400) // 300 + 100 heal at level 1
    })

    it('scales heal amount with level', () => {
      const player = makePlayer({ level: 7 }) // E level 4
      const ally = makeAlly({ hp: 200, maxHp: 550 })
      const state = makeState([player, ally])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'a1' }),
      )

      expect(result.state.players['a1']!.hp).toBe(480) // 200 + 280 heal at level 4
    })

    it('does not heal above maxHp', () => {
      const player = makePlayer({ level: 7 })
      const ally = makeAlly({ hp: 500, maxHp: 550 })
      const state = makeState([player, ally])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'a1' }),
      )

      expect(result.state.players['a1']!.hp).toBe(550)
    })

    it('can target self', () => {
      const player = makePlayer({ level: 1, hp: 400, maxHp: 600 })
      const state = makeState([player])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'e', { kind: 'self' }),
      )

      expect(result.state.players['p1']!.hp).toBe(500) // 400 + 100
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const ally = makeAlly()
      const state = makeState([player, ally])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'a1' }),
      )

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(350 - 60) // Level 1 E costs 60
      expect(updated.cooldowns.e).toBe(6)
    })

    it('fails when target is in different zone', () => {
      const player = makePlayer()
      const ally = makeAlly({ zone: 'top-river' })
      const state = makeState([player, ally])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'a1' }),
      )
      expect(result._tag).toBe('Failure')
    })
  })

  describe('R: Lockdown (Silence)', () => {
    it('requires level 6+', () => {
      const player = makePlayer({ level: 5, mp: 500 })
      const state = makeState([player])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'mid-river' }),
      )
      expect(result._tag).toBe('Failure')
    })

    it('silences all enemies in target zone for 3 ticks', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2' })
      const state = makeState([player, enemy1, enemy2])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'mid-river' }),
      )

      expect(hasBuff(result.state.players['e1']!, 'silence')).toBe(true)
      expect(hasBuff(result.state.players['e2']!, 'silence')).toBe(true)
      const silence = result.state.players['e1']!.buffs.find((b) => b.id === 'silence')
      expect(silence!.ticksRemaining).toBe(3)
    })

    it('does not silence allies', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const ally = makeAlly()
      const enemy = makeEnemy()
      const state = makeState([player, ally, enemy])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'mid-river' }),
      )

      expect(hasBuff(result.state.players['a1']!, 'silence')).toBe(false)
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const state = makeState([player])

      const result = Effect.runSync(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'mid-river' }),
      )

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(500 - 250) // R1 costs 250
      expect(updated.cooldowns.r).toBe(50)
    })
  })

  describe('Passive: Watchtower', () => {
    it('applies watchtower buff if missing', () => {
      const player = makePlayer()
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'tick_end',
        payload: {},
      })

      expect(hasBuff(updated.players['p1']!, 'watchtower')).toBe(true)
    })

    it('does not duplicate buff if already present', () => {
      let player = makePlayer()
      player = applyBuff(player, {
        id: 'watchtower',
        stacks: 1,
        ticksRemaining: 9999,
        source: 'p1',
      })
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        tick: 10,
        type: 'tick_end',
        payload: {},
      })

      const watchBuffs = updated.players['p1']!.buffs.filter((b) => b.id === 'watchtower')
      expect(watchBuffs.length).toBe(1)
    })
  })
})
