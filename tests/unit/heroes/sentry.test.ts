import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import type { GameState, PlayerState } from '~~/shared/types/game'
import { resolveAbility, resolvePassive, getBuffStacks } from '~~/server/game/heroes/_base'
import '../../../server/game/heroes/sentry'

const tickEnd = { cycle: 10, type: 'tick_end' as const, payload: {} }

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  const player = {
    id: 'p1',
    name: 'TestSentry',
    team: 'chaff',
    heroId: 'sentry',
    zone: 'coldstore-cross',
    integ: 600,
    maxInteg: 600,
    bw: 350,
    maxBw: 350,
    level: 7,
    xp: 0,
    scrip: 600,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnCycle: null,
    plate: 4,
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

function makeAlly(overrides: Partial<PlayerState> = {}): PlayerState {
  return makePlayer({
    id: 'a1',
    name: 'Ally',
    team: 'chaff',
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
      'coldstore-cross': { id: 'coldstore-cross', wards: [] },
      'seawall-cross': { id: 'seawall-cross', wards: [] },
    },
    waves: [],
    neutrals: [],
    ice: [],
    caches: [],
    tenant: { alive: false, integ: 0, maxInteg: 0, deathCycle: null },
    backup: null,
    events: [],
    ...overrides,
  }
}

describe('Sentry Hero', () => {
  describe('Q: Mend Protocol', () => {
    it('heals target ally', () => {
      const player = makePlayer({ level: 1 })
      const ally = makeAlly({ integ: 300 })
      const state = makeState([player, ally])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'a1' }))

      expect(result.state.players['a1']!.integ).toBeGreaterThan(300)
    })

    it('deducts BW and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const ally = makeAlly()
      const state = makeState([player, ally])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'a1' }))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(350 - 80)
      expect(updated.cooldowns.q).toBe(6)
    })

    it('scales heal with level', () => {
      const player1 = makePlayer({ level: 1 })
      const player7 = makePlayer({ level: 7 })
      const ally1 = makeAlly({ integ: 300 })
      const ally2 = makeAlly({ id: 'a2', name: 'Ally2', integ: 300 })

      const state1 = makeState([player1, ally1])
      const state2 = makeState([player7, ally2])

      const result1 = Effect.runSync(
        resolveAbility(state1, 'p1', 'q', { kind: 'hero', name: 'a1' }),
      )
      const result2 = Effect.runSync(
        resolveAbility(state2, 'p1', 'q', { kind: 'hero', name: 'a2' }),
      )

      const heal1 = result1.state.players['a1']!.integ - 300
      const heal2 = result2.state.players['a2']!.integ - 300
      expect(heal2).toBeGreaterThan(heal1)
    })

    it('scales cooldown with level', () => {
      const player1 = makePlayer({ level: 1 })
      const player7 = makePlayer({ level: 7 })
      const ally1 = makeAlly()
      const ally2 = makeAlly({ id: 'a2', name: 'Ally2' })

      const state1 = makeState([player1, ally1])
      const state2 = makeState([player7, ally2])

      const result1 = Effect.runSync(
        resolveAbility(state1, 'p1', 'q', { kind: 'hero', name: 'a1' }),
      )
      const result2 = Effect.runSync(
        resolveAbility(state2, 'p1', 'q', { kind: 'hero', name: 'a2' }),
      )

      expect(result1.state.players['p1']!.cooldowns.q).toBe(6)
      expect(result2.state.players['p1']!.cooldowns.q).toBe(3)
    })

    it('can heal self', () => {
      const player = makePlayer({ integ: 300 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'self' }))

      expect(result.state.players['p1']!.integ).toBeGreaterThan(300)
    })

    it('requires hero target', () => {
      const player = makePlayer()
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'q'))
      expect(result._tag).toBe('Failure')
    })

    it('fails when target is in different zone', () => {
      const player = makePlayer()
      const ally = makeAlly({ zone: 'seawall-cross' })
      const state = makeState([player, ally])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'a1' }),
      )
      expect(result._tag).toBe('Failure')
    })
  })

  describe('W: Barrier', () => {
    it('applies shield to target ally', () => {
      const player = makePlayer({ level: 1 })
      const ally = makeAlly()
      const state = makeState([player, ally])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'a1' }))

      const shield = result.state.players['a1']!.buffs.find((b) => b.id === 'shield')
      expect(shield).toBeDefined()
      expect(shield!.stacks).toBe(100)
      expect(shield!.cyclesRemaining).toBe(3)
    })

    it('deducts BW and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const ally = makeAlly()
      const state = makeState([player, ally])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'a1' }))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(350 - 100)
      expect(updated.cooldowns.w).toBe(10)
    })

    it('scales shield with level', () => {
      const player1 = makePlayer({ level: 1 })
      const player7 = makePlayer({ level: 7 })
      const ally1 = makeAlly()
      const ally2 = makeAlly({ id: 'a2', name: 'Ally2' })

      const state1 = makeState([player1, ally1])
      const state2 = makeState([player7, ally2])

      const result1 = Effect.runSync(
        resolveAbility(state1, 'p1', 'w', { kind: 'hero', name: 'a1' }),
      )
      const result2 = Effect.runSync(
        resolveAbility(state2, 'p1', 'w', { kind: 'hero', name: 'a2' }),
      )

      const shield1 = result1.state.players['a1']!.buffs.find((b) => b.id === 'shield')
      const shield2 = result2.state.players['a2']!.buffs.find((b) => b.id === 'shield')
      expect(shield2!.stacks).toBeGreaterThan(shield1!.stacks)
    })

    it('scales cooldown with level', () => {
      const player1 = makePlayer({ level: 1 })
      const player7 = makePlayer({ level: 7 })
      const ally1 = makeAlly()
      const ally2 = makeAlly({ id: 'a2', name: 'Ally2' })

      const state1 = makeState([player1, ally1])
      const state2 = makeState([player7, ally2])

      const result1 = Effect.runSync(
        resolveAbility(state1, 'p1', 'w', { kind: 'hero', name: 'a1' }),
      )
      const result2 = Effect.runSync(
        resolveAbility(state2, 'p1', 'w', { kind: 'hero', name: 'a2' }),
      )

      expect(result1.state.players['p1']!.cooldowns.w).toBe(10)
      expect(result2.state.players['p1']!.cooldowns.w).toBe(7)
    })

    it('can shield self', () => {
      const player = makePlayer()
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w', { kind: 'self' }))

      const shield = result.state.players['p1']!.buffs.find((b) => b.id === 'shield')
      expect(shield).toBeDefined()
    })

    it('requires hero target', () => {
      const player = makePlayer()
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'w'))
      expect(result._tag).toBe('Failure')
    })
  })

  describe('E: Scan Pulse', () => {
    it('slows enemies in zone', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      const slow = result.state.players['e1']!.buffs.find((b) => b.id === 'slow')
      expect(slow).toBeDefined()
      expect(slow!.stacks).toBe(30)
      expect(slow!.cyclesRemaining).toBe(2)
    })

    it('does not slow allies', () => {
      const player = makePlayer()
      const ally = makeAlly()
      const state = makeState([player, ally])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      const slow = result.state.players['a1']!.buffs.find((b) => b.id === 'slow')
      expect(slow).toBeUndefined()
    })

    it('deducts BW and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(350 - 70)
      expect(updated.cooldowns.e).toBe(12)
    })

    it('scales cooldown with level', () => {
      const player1 = makePlayer({ level: 1 })
      const player7 = makePlayer({ level: 7 })

      const state1 = makeState([player1])
      const state2 = makeState([player7])

      const result1 = Effect.runSync(resolveAbility(state1, 'p1', 'e'))
      const result2 = Effect.runSync(resolveAbility(state2, 'p1', 'e'))

      expect(result1.state.players['p1']!.cooldowns.e).toBe(12)
      expect(result2.state.players['p1']!.cooldowns.e).toBe(9)
    })

    it('does not require target', () => {
      const player = makePlayer()
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))
      expect(result.events[0]!.type).toBe('ability_cast')
    })
  })

  describe('R: Fortify', () => {
    it('requires level 6+', () => {
      const player = makePlayer({ level: 5 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'r'))
      expect(result._tag).toBe('Failure')
    })

    it('applies shield to all allies in zone', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const ally = makeAlly()
      const state = makeState([player, ally])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      const playerShield = result.state.players['p1']!.buffs.find((b) => b.id === 'shield')
      const allyShield = result.state.players['a1']!.buffs.find((b) => b.id === 'shield')
      expect(playerShield).toBeDefined()
      expect(allyShield).toBeDefined()
      expect(playerShield!.stacks).toBe(150)
      expect(allyShield!.stacks).toBe(150)
    })

    it('applies plate buff to all allies in zone', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const ally = makeAlly()
      const state = makeState([player, ally])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      const playerDef = result.state.players['p1']!.buffs.find((b) => b.id === 'defenseBuff')
      const allyDef = result.state.players['a1']!.buffs.find((b) => b.id === 'defenseBuff')
      expect(playerDef).toBeDefined()
      expect(allyDef).toBeDefined()
      expect(playerDef!.stacks).toBe(3)
      expect(allyDef!.stacks).toBe(3)
    })

    it('buffs last 4 ticks', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      const shield = result.state.players['p1']!.buffs.find((b) => b.id === 'shield')
      const defBuff = result.state.players['p1']!.buffs.find((b) => b.id === 'defenseBuff')
      expect(shield!.cyclesRemaining).toBe(4)
      expect(defBuff!.cyclesRemaining).toBe(4)
    })

    it('deducts BW and sets cooldown', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(500 - 250)
      expect(updated.cooldowns.r).toBe(60)
    })

    it('scales cooldown with level', () => {
      const player6 = makePlayer({ level: 6, bw: 500 })
      const player18 = makePlayer({ level: 18, bw: 500 })

      const state1 = makeState([player6])
      const state2 = makeState([player18])

      const result1 = Effect.runSync(resolveAbility(state1, 'p1', 'r'))
      const result2 = Effect.runSync(resolveAbility(state2, 'p1', 'r'))

      expect(result1.state.players['p1']!.cooldowns.r).toBe(60)
      expect(result2.state.players['p1']!.cooldowns.r).toBe(50)
    })

    it('does not buff enemies', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      const enemyShield = result.state.players['e1']!.buffs.find((b) => b.id === 'shield')
      expect(enemyShield).toBeUndefined()
    })
  })

  describe('Stun/Silence blocking', () => {
    it('prevents casting when stunned', () => {
      const player = makePlayer({
        buffs: [{ id: 'stun', stacks: 1, cyclesRemaining: 1, source: 'enemy' }],
      })
      const ally = makeAlly()
      const state = makeState([player, ally])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'a1' }),
      )

      expect(result._tag).toBe('Failure')
    })

    it('prevents casting when silenced', () => {
      const player = makePlayer({
        buffs: [{ id: 'silence', stacks: 1, cyclesRemaining: 2, source: 'enemy' }],
      })
      const ally = makeAlly()
      const state = makeState([player, ally])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'a1' }),
      )

      expect(result._tag).toBe('Failure')
    })
  })

  describe('Passive: Overwatch aura', () => {
    it('grants +5 plate to the Sentry and allies in its zone (read by EffectiveStats)', () => {
      const sentry = makePlayer({ id: 'p1', zone: 'coldstore-cross' })
      const allyInZone = makeAlly({ id: 'a1', zone: 'coldstore-cross' })
      const allyElsewhere = makeAlly({ id: 'a2', zone: 'seawall-cross' })
      const state = makeState([sentry, allyInZone, allyElsewhere])

      const updated = resolvePassive(state, 'p1', tickEnd)

      expect(getBuffStacks(updated.players['p1']!, 'overwatch')).toBe(5) // the sentry itself
      expect(getBuffStacks(updated.players['a1']!, 'overwatch')).toBe(5) // ally in zone
      expect(getBuffStacks(updated.players['a2']!, 'overwatch')).toBe(0) // out of zone
    })

    it('does not buff enemies in the zone', () => {
      const sentry = makePlayer({ id: 'p1', zone: 'coldstore-cross' })
      const enemy = makeAlly({ id: 'e1', team: 'audit', zone: 'coldstore-cross' })
      const state = makeState([sentry, enemy])

      const updated = resolvePassive(state, 'p1', tickEnd)

      expect(getBuffStacks(updated.players['e1']!, 'overwatch')).toBe(0)
    })
  })
})
