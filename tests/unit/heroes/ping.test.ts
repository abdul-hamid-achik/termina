import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import type { GameState, PlayerState } from '~~/shared/types/game'
import { resolveAbility, resolvePassive, hasBuff } from '~~/server/game/heroes/_base'
// Register ping hero
import '../../../server/game/heroes/ping'

// ── Test Helpers ──────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  const player = {
    id: 'p1',
    name: 'TestPing',
    team: 'chaff',
    heroId: 'ping',
    zone: 'mid-river',
    integ: 580,
    maxInteg: 580,
    bw: 310,
    maxBw: 310,
    level: 7,
    xp: 0,
    scrip: 600,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnCycle: null,
    plate: 4,
    ice: 18,
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

describe('Ping Hero', () => {
  describe('Q: ICMP Echo (Magic Damage)', () => {
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

    it('deducts BW and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(310 - 45) // Level 1 Q costs 45
      expect(updated.cooldowns.q).toBe(5)
    })

    it('scales BW cost with level', () => {
      const player = makePlayer({ level: 7 }) // Q level 4
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(310 - 90) // Level 4 Q costs 90
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

    it('fails when target is in a NON-adjacent zone', () => {
      const player = makePlayer() // mid-river
      const enemy = makeEnemy({ zone: 'top-river' }) // not adjacent to mid-river
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )
      expect(result._tag).toBe('Failure')
    })

    it('reaches an ADJACENT-zone target for 60% damage (the cross-zone poke)', () => {
      // Full hit on a same-zone target.
      const inZone = makeEnemy()
      const full = Effect.runSync(
        resolveAbility(makeState([makePlayer({ level: 1 }), inZone]), 'p1', 'q', {
          kind: 'hero',
          name: 'e1',
        }),
      )
      const fullDmg = inZone.integ - full.state.players['e1']!.integ
      expect(fullDmg).toBeGreaterThan(0)

      // mid-t1-audit is adjacent to the caster's mid-river → the Q reaches it but
      // for reduced (60%) damage.
      const adjacent = makeEnemy({ zone: 'mid-t1-audit' })
      const adj = Effect.runSync(
        resolveAbility(makeState([makePlayer({ level: 1 }), adjacent]), 'p1', 'q', {
          kind: 'hero',
          name: 'e1',
        }),
      )
      const adjDmg = adjacent.integ - adj.state.players['e1']!.integ
      expect(adjDmg).toBeGreaterThan(0)
      expect(adjDmg).toBeLessThan(fullDmg)
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

  describe('W: Timeout (Silence + Attack Reduction)', () => {
    it('silences target for 1 tick and reduces attack for 3 ticks', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'e1' }))

      const updatedEnemy = result.state.players['e1']!
      expect(hasBuff(updatedEnemy, 'silence')).toBe(true)
      const silence = updatedEnemy.buffs.find((b) => b.id === 'silence')
      // raw 2 = one gated action: a cast-applied disable is reaped same-tick.
      expect(silence!.cyclesRemaining).toBe(2)

      expect(hasBuff(updatedEnemy, 'attackReduction')).toBe(true)
      const atkReduce = updatedEnemy.buffs.find((b) => b.id === 'attackReduction')
      expect(atkReduce!.stacks).toBe(20)
      expect(atkReduce!.cyclesRemaining).toBe(3)
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'e1' }))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(310 - 75) // Level 1 W costs 75
      expect(updated.cooldowns.w).toBe(12)
    })

    it('scales BW cost with level', () => {
      const player = makePlayer({ level: 7 }) // W level 4
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'e1' }))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(310 - 120) // Level 4 W costs 120
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

  describe('E: Tracepath (Self Vision)', () => {
    it('applies the vision buff (and not a dead speed buff)', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      const updated = result.state.players['p1']!
      expect(hasBuff(updated, 'tracepath_vision')).toBe(true)
      expect(hasBuff(updated, 'tracepath_speed')).toBe(false)

      const vision = updated.buffs.find((b) => b.id === 'tracepath_vision')
      expect(vision!.cyclesRemaining).toBe(3)
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(310 - 60) // Level 1 E costs 60
      expect(updated.cooldowns.e).toBe(14)
    })

    it('scales BW cost with level', () => {
      const player = makePlayer({ level: 7 }) // E level 4
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(310 - 105) // Level 4 E costs 105
    })

    it('fails with insufficient BW', () => {
      const player = makePlayer({ bw: 10 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'e'))
      expect(result._tag).toBe('Failure')
    })
  })

  describe('R: Flood (AoE DoT + Slow)', () => {
    it('requires level 6+', () => {
      const player = makePlayer({ level: 5, bw: 500 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'r'))
      expect(result._tag).toBe('Failure')
    })

    it('applies DoT and slow to all enemies in zone', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2' })
      const state = makeState([player, enemy1, enemy2])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      // DoT buff applied
      expect(hasBuff(result.state.players['e1']!, 'flood_dot')).toBe(true)
      expect(hasBuff(result.state.players['e2']!, 'flood_dot')).toBe(true)

      const dot = result.state.players['e1']!.buffs.find((b) => b.id === 'flood_dot')
      expect(dot!.cyclesRemaining).toBe(3)
      expect(dot!.stacks).toBe(60) // 180 / 3 = 60 per cycle at R1

      // Slow buff applied
      expect(hasBuff(result.state.players['e1']!, 'slow')).toBe(true)
      const slow = result.state.players['e1']!.buffs.find((b) => b.id === 'slow')
      expect(slow!.stacks).toBe(40) // 40% slow
      expect(slow!.cyclesRemaining).toBe(3)
    })

    it('does not affect allies', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const ally = makePlayer({ id: 'a1', name: 'Ally', team: 'chaff' })
      const enemy = makeEnemy()
      const state = makeState([player, ally, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      expect(hasBuff(result.state.players['a1']!, 'flood_dot')).toBe(false)
      expect(hasBuff(result.state.players['a1']!, 'slow')).toBe(false)
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(500 - 200) // R1 costs 200
      expect(updated.cooldowns.r).toBe(50)
    })

    it('scales DoT damage with R level', () => {
      const player6 = makePlayer({ level: 6, bw: 500 })
      const player18 = makePlayer({ level: 18, bw: 500 })
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2' })

      const state1 = makeState([player6, enemy1])
      const state2 = makeState([player18, enemy2])

      const result1 = Effect.runSync(resolveAbility(state1, 'p1', 'r'))
      const result2 = Effect.runSync(resolveAbility(state2, 'p1', 'r'))

      const dot1 = result1.state.players['e1']!.buffs.find((b) => b.id === 'flood_dot')
      const dot2 = result2.state.players['e2']!.buffs.find((b) => b.id === 'flood_dot')
      expect(dot2!.stacks).toBeGreaterThan(dot1!.stacks) // Higher damage per cycle at R3
    })
  })

  describe('Passive: Latency', () => {
    it('applies latency debuff to attack target', () => {
      const player = makePlayer()
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const updated = resolvePassive(state, 'p1', {
        cycle: 10,
        type: 'attack',
        payload: { attackerId: 'p1', targetId: 'e1', damage: 50 },
      })

      const updatedEnemy = updated.players['e1']!
      expect(hasBuff(updatedEnemy, 'latency')).toBe(true)
      const latency = updatedEnemy.buffs.find((b) => b.id === 'latency')
      expect(latency!.stacks).toBe(1)
      expect(latency!.cyclesRemaining).toBe(1)
      expect(latency!.source).toBe('p1')
    })

    it('does not apply on non-attack events', () => {
      const player = makePlayer()
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const updated = resolvePassive(state, 'p1', {
        cycle: 10,
        type: 'tick_end',
        payload: {},
      })

      expect(hasBuff(updated.players['e1']!, 'latency')).toBe(false)
    })

    it('does not apply when another player attacks', () => {
      const player = makePlayer()
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const updated = resolvePassive(state, 'p1', {
        cycle: 10,
        type: 'attack',
        payload: { attackerId: 'someone_else', targetId: 'e1', damage: 50 },
      })

      expect(hasBuff(updated.players['e1']!, 'latency')).toBe(false)
    })

    it('does not apply to dead targets', () => {
      const player = makePlayer()
      const enemy = makeEnemy({ alive: false, integ: 0 })
      const state = makeState([player, enemy])

      const updated = resolvePassive(state, 'p1', {
        cycle: 10,
        type: 'attack',
        payload: { attackerId: 'p1', targetId: 'e1', damage: 50 },
      })

      expect(hasBuff(updated.players['e1']!, 'latency')).toBe(false)
    })

    it('adds +1 tick to the victim’s next ability cooldown and is consumed (the formerly-dead effect)', () => {
      const player = makePlayer({
        buffs: [{ id: 'latency', stacks: 1, cyclesRemaining: 1, source: 'enemy' }],
      })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

      const caster = result.state.players['p1']!
      expect(caster.cooldowns.q).toBe(6) // Q_COOLDOWN (5) + 1
      expect(hasBuff(caster, 'latency')).toBe(false) // spent on the cast
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
