import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import type { GameState, PlayerState } from '~~/shared/types/game'
import {
  resolveAbility,
  resolvePassive,
  applyBuff,
  hasBuff,
  getBuffStacks,
  cycleAllBuffs,
} from '~~/server/game/heroes/_base'
// Register traceroute hero
import '../../../server/game/heroes/traceroute'

// ── Test Helpers ──────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  const player = {
    id: 'p1',
    name: 'TestTraceroute',
    team: 'chaff',
    heroId: 'traceroute',
    zone: 'coldstore-cross',
    integ: 470,
    maxInteg: 470,
    bw: 290,
    maxBw: 290,
    level: 7,
    xp: 0,
    scrip: 600,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnCycle: null,
    plate: 2,
    ice: 14,
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
    integ: 400,
    maxInteg: 550,
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
      'coldstore-t1-chaff': { id: 'coldstore-t1-chaff', wards: [] },
    },
    waves: [],
    ice: [],
    events: [],
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────

describe('Traceroute Hero', () => {
  describe('Q: Probe (Physical Damage + Isolation Bonus)', () => {
    it('deals kinetic damage to target enemy', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

      expect(result.state.players['e1']!.integ).toBeLessThan(enemy.integ)
    })

    it('deals 35% bonus damage when target is isolated', () => {
      const player = makePlayer({ level: 1 })
      // Enemy alone in zone (no allies)
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

      const event = result.events[0]!
      expect(event.payload['isolated']).toBe(true)
      // Damage should be base * 1.35 = 100 * 1.35 = 135
      expect(event.payload['damage']).toBe(135) // 100 * 1.35 rounded
    })

    it('Hop Count stacks amplify Probe damage (+20% per hop — formerly a dead multiplier)', () => {
      let player = makePlayer({ level: 1 })
      player = applyBuff(player, { id: 'hopCount', stacks: 3, cyclesRemaining: 2, source: 'p1' })
      const enemy = makeEnemy() // isolated → 1.35 bonus too
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

      // base 100 × 1.35 (isolated) = 135, × (1 + 3×0.2 = 1.6) = 216
      expect(result.events[0]!.payload['damage']).toBe(216)
    })

    it('does not apply isolation bonus when target has allies', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const enemyAlly = makeEnemy({ id: 'e2', name: 'EnemyAlly' })
      const state = makeState([player, enemy, enemyAlly])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

      const event = result.events[0]!
      expect(event.payload['isolated']).toBe(false)
      expect(event.payload['damage']).toBe(100) // Base damage at level 1
    })

    it('scales damage with level', () => {
      const player1 = makePlayer({ level: 1 })
      const player7 = makePlayer({ level: 7 })
      // Enemies with allies in zone to avoid isolation bonus
      const enemy1 = makeEnemy()
      const enemyAlly1 = makeEnemy({ id: 'e2', name: 'EA1' })
      const enemy2 = makeEnemy({ id: 'e3', name: 'Enemy2' })
      const enemyAlly2 = makeEnemy({ id: 'e4', name: 'EA2' })

      const state1 = makeState([player1, enemy1, enemyAlly1])
      const state2 = makeState([player7, enemy2, enemyAlly2])

      const result1 = Effect.runSync(
        resolveAbility(state1, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )
      const result2 = Effect.runSync(
        resolveAbility(state2, 'p1', 'q', { kind: 'hero', name: 'e3' }),
      )

      const dmg1 = enemy1.integ - result1.state.players['e1']!.integ
      const dmg2 = enemy2.integ - result2.state.players['e3']!.integ
      expect(dmg2).toBeGreaterThan(dmg1)
    })

    it('deducts BW and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(290 - 50) // Level 1 costs 50
      expect(updated.cooldowns.q).toBe(8)
    })

    it('requires hero target', () => {
      const player = makePlayer()
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'q'))
      expect(result._tag).toBe('Failure')
    })

    it('fails when target is in different zone', () => {
      const player = makePlayer()
      const enemy = makeEnemy({ zone: 'seawall-cross' })
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
  })

  describe('W: TTL (Root)', () => {
    it('applies root debuff to target for 2 ticks', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'e1' }))

      const updatedEnemy = result.state.players['e1']!
      expect(hasBuff(updatedEnemy, 'root')).toBe(true)
      const root = updatedEnemy.buffs.find((b) => b.id === 'root')
      expect(root!.cyclesRemaining).toBe(2)
    })

    it('deducts BW and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'e1' }))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(290 - 70) // Level 1 costs 70
      expect(updated.cooldowns.w).toBe(12)
    })

    it('scales BW cost with level', () => {
      const player = makePlayer({ level: 7 }) // W level 4
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'e1' }))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(290 - 115) // Level 4 costs 115
    })

    it('requires hero target', () => {
      const player = makePlayer()
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'w'))
      expect(result._tag).toBe('Failure')
    })

    it('fails when target is in different zone', () => {
      const player = makePlayer()
      const enemy = makeEnemy({ zone: 'seawall-cross' })
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'e1' }),
      )
      expect(result._tag).toBe('Failure')
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
  })

  describe('E: Next Hop (Self Buff)', () => {
    it('applies nextHopShadow buff to self', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      const updated = result.state.players['p1']!
      expect(hasBuff(updated, 'nextHopShadow')).toBe(true)
      const buff = updated.buffs.find((b) => b.id === 'nextHopShadow')
      expect(buff!.cyclesRemaining).toBe(2)
    })

    it('deducts BW and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(290 - 60) // Level 1 costs 60
      expect(updated.cooldowns.e).toBe(12)
    })

    it('scales BW cost with level', () => {
      const player = makePlayer({ level: 7 }) // E level 4
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(290 - 105) // Level 4 costs 105
    })

    it('fails with insufficient BW', () => {
      const player = makePlayer({ bw: 10 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'e'))
      expect(result._tag).toBe('Failure')
    })

    it('marks the current zone as the return point on cast', () => {
      const player = makePlayer({ zone: 'coldstore-cross', level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      const shadow = result.state.players['p1']!.buffs.find((b) => b.id === 'nextHopShadow')
      expect(shadow!.destination).toBe('coldstore-cross')
    })

    it('snaps the caster back to the marked zone when the shadow expires', () => {
      // Cast E in coldstore-cross → drops a return shadow marking coldstore-cross.
      const player = makePlayer({ zone: 'coldstore-cross', level: 1 })
      const state = makeState([player])
      const cast = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      // Player roams to seawall-cross while the shadow is up.
      let s: GameState = {
        ...cast.state,
        players: {
          ...cast.state.players,
          p1: { ...cast.state.players['p1']!, zone: 'seawall-cross' },
        },
      }

      // Tick 1: shadow still pending (cyclesRemaining 2 → 1), no return yet.
      s = cycleAllBuffs(s)
      expect(s.players['p1']!.zone).toBe('seawall-cross')
      expect(hasBuff(s.players['p1']!, 'nextHopShadow')).toBe(true)

      // Tick 2: shadow expires → snap back to coldstore-cross.
      s = cycleAllBuffs(s)
      expect(s.players['p1']!.zone).toBe('coldstore-cross')
      expect(hasBuff(s.players['p1']!, 'nextHopShadow')).toBe(false)

      const ev = s.events.find((e) => e.type === 'teleport_complete')
      expect(ev).toBeDefined()
      expect(ev!.payload['destination']).toBe('coldstore-cross')
      expect(ev!.payload['source']).toBe('next_hop')
    })

    it('does not fire a teleport if the caster never left the marked zone', () => {
      const player = makePlayer({ zone: 'coldstore-cross', level: 1 })
      const state = makeState([player])
      let s = Effect.runSync(resolveAbility(state, 'p1', 'e')).state

      s = cycleAllBuffs(s) // cyclesRemaining 2 → 1
      s = cycleAllBuffs(s) // expires; destination === zone, so no teleport

      expect(s.players['p1']!.zone).toBe('coldstore-cross')
      expect(s.events.find((e) => e.type === 'teleport_complete')).toBeUndefined()
    })
  })

  describe('R: Full Trace (Global Reveal + Damage Buff)', () => {
    it('requires level 6+', () => {
      const player = makePlayer({ level: 5, bw: 500 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'r'))
      expect(result._tag).toBe('Failure')
    })

    it('applies revealed debuff to all enemy players', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2', zone: 'seawall-cross' })
      const state = makeState([player, enemy1, enemy2])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      expect(hasBuff(result.state.players['e1']!, 'revealed')).toBe(true)
      expect(hasBuff(result.state.players['e2']!, 'revealed')).toBe(true)
      const reveal = result.state.players['e1']!.buffs.find((b) => b.id === 'revealed')
      expect(reveal!.cyclesRemaining).toBe(3)
    })

    it('reveals enemies in different zones (global)', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const enemy = makeEnemy({ zone: 'seawall-cross' })
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      expect(hasBuff(result.state.players['e1']!, 'revealed')).toBe(true)
    })

    it('applies self damage buff', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      const updated = result.state.players['p1']!
      expect(hasBuff(updated, 'fullTraceDmg')).toBe(true)
      const dmgBuff = updated.buffs.find((b) => b.id === 'fullTraceDmg')
      expect(dmgBuff!.stacks).toBe(50)
      expect(dmgBuff!.cyclesRemaining).toBe(2)
    })

    it('does not affect allied players', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const ally = makeAlly()
      const enemy = makeEnemy()
      const state = makeState([player, ally, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      expect(hasBuff(result.state.players['a1']!, 'revealed')).toBe(false)
    })

    it('deducts BW and sets cooldown', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(500 - 200) // R1 costs 200
      expect(updated.cooldowns.r).toBe(60)
    })

    it('fails with insufficient BW', () => {
      const player = makePlayer({ level: 6, bw: 50 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'r'))
      expect(result._tag).toBe('Failure')
    })
  })

  describe('Passive: Hop Count', () => {
    it('increments hopCount stacks on move', () => {
      const player = makePlayer()
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        cycle: 10,
        type: 'move',
        payload: { playerId: 'p1', from: 'coldstore-t1-chaff', to: 'coldstore-cross' },
      })

      expect(getBuffStacks(updated.players['p1']!, 'hopCount')).toBe(1)
    })

    it('stacks up to max 3', () => {
      let player = makePlayer()
      player = applyBuff(player, {
        id: 'hopCount',
        stacks: 2,
        cyclesRemaining: 2,
        source: 'p1',
      })
      let state = makeState([player])

      state = resolvePassive(state, 'p1', {
        cycle: 10,
        type: 'move',
        payload: { playerId: 'p1', from: 'coldstore-t1-chaff', to: 'coldstore-cross' },
      })

      expect(getBuffStacks(state.players['p1']!, 'hopCount')).toBe(3)

      // Try to go above 3
      state = resolvePassive(state, 'p1', {
        cycle: 11,
        type: 'move',
        payload: { playerId: 'p1', from: 'coldstore-cross', to: 'seawall-cross' },
      })

      expect(getBuffStacks(state.players['p1']!, 'hopCount')).toBe(3) // still 3
    })

    it('refreshes decay timer on each move', () => {
      const player = makePlayer()
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        cycle: 10,
        type: 'move',
        payload: { playerId: 'p1', from: 'coldstore-t1-chaff', to: 'coldstore-cross' },
      })

      const buff = updated.players['p1']!.buffs.find((b) => b.id === 'hopCount')
      expect(buff!.cyclesRemaining).toBe(2) // decay timer reset
    })

    it('does not trigger on other players move', () => {
      const player = makePlayer()
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const updated = resolvePassive(state, 'p1', {
        cycle: 10,
        type: 'move',
        payload: { playerId: 'e1', from: 'coldstore-t1-chaff', to: 'coldstore-cross' },
      })

      expect(getBuffStacks(updated.players['p1']!, 'hopCount')).toBe(0)
    })

    it('does not trigger on non-move events', () => {
      const player = makePlayer()
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        cycle: 10,
        type: 'tick_end',
        payload: {},
      })

      expect(getBuffStacks(updated.players['p1']!, 'hopCount')).toBe(0)
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
