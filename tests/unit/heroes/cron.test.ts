import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import type { GameState, PlayerState } from '~~/shared/types/game'
import { resolveAbility, resolvePassive, hasBuff } from '~~/server/game/heroes/_base'
// Register cron hero
import '../../../server/game/heroes/cron'

// ── Test Helpers ──────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  const player = {
    id: 'p1',
    name: 'TestCron',
    team: 'chaff',
    heroId: 'cron',
    zone: 'mid-river',
    integ: 620,
    maxInteg: 620,
    bw: 380,
    maxBw: 380,
    level: 7,
    xp: 0,
    scrip: 600,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnCycle: null,
    plate: 5,
    ice: 22,
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
      'mid-river': { id: 'mid-river', wards: [] },
      'top-river': { id: 'top-river', wards: [] },
      'mid-t1-chaff': { id: 'mid-t1-chaff', wards: [] },
    },
    waves: [],
    ice: [],
    events: [],
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────

describe('Cron Hero', () => {
  describe('Q: Uptime (Buff Ally)', () => {
    it('applies uptimeAtk and uptimeDef buffs to target ally', () => {
      const player = makePlayer({ level: 1 })
      const ally = makeAlly()
      const state = makeState([player, ally])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'a1' }))

      const updatedAlly = result.state.players['a1']!
      expect(hasBuff(updatedAlly, 'uptimeAtk')).toBe(true)
      expect(hasBuff(updatedAlly, 'uptimeDef')).toBe(true)
      const atkBuff = updatedAlly.buffs.find((b) => b.id === 'uptimeAtk')
      expect(atkBuff!.stacks).toBe(15)
      expect(atkBuff!.cyclesRemaining).toBe(3)
      const defBuff = updatedAlly.buffs.find((b) => b.id === 'uptimeDef')
      expect(defBuff!.stacks).toBe(5)
      expect(defBuff!.cyclesRemaining).toBe(3)
    })

    it('deducts BW and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const ally = makeAlly()
      const state = makeState([player, ally])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'a1' }))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(380 - 65) // Level 1 costs 65
      expect(updated.cooldowns.q).toBe(8)
    })

    it('scales BW cost with level', () => {
      const player = makePlayer({ level: 7 }) // Q level 4
      const ally = makeAlly()
      const state = makeState([player, ally])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'a1' }))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(380 - 110) // Level 4 costs 110
    })

    it('fails when targeting self', () => {
      const player = makePlayer()
      const state = makeState([player])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'p1' }),
      )
      expect(result._tag).toBe('Failure')
    })

    it('fails when targeting enemy', () => {
      const player = makePlayer()
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )
      expect(result._tag).toBe('Failure')
    })

    it('fails when target is in different zone', () => {
      const player = makePlayer()
      const ally = makeAlly({ zone: 'top-river' })
      const state = makeState([player, ally])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'a1' }),
      )
      expect(result._tag).toBe('Failure')
    })

    it('requires hero target', () => {
      const player = makePlayer()
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'q'))
      expect(result._tag).toBe('Failure')
    })

    it('fails with insufficient BW', () => {
      const player = makePlayer({ bw: 10 })
      const ally = makeAlly()
      const state = makeState([player, ally])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'a1' }),
      )
      expect(result._tag).toBe('Failure')
    })
  })

  describe('W: Purge (Cleanse + Shield)', () => {
    it('removes debuffs and applies shield to target ally', () => {
      const ally = makeAlly({
        buffs: [
          { id: 'stun', stacks: 1, cyclesRemaining: 2, source: 'enemy' },
          { id: 'slow', stacks: 25, cyclesRemaining: 3, source: 'enemy' },
          { id: 'uptimeAtk', stacks: 15, cyclesRemaining: 2, source: 'p1' },
        ],
      })
      const player = makePlayer({ level: 1 })
      const state = makeState([player, ally])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'a1' }))

      const updatedAlly = result.state.players['a1']!
      expect(hasBuff(updatedAlly, 'stun')).toBe(false)
      expect(hasBuff(updatedAlly, 'slow')).toBe(false)
      // Non-debuff buff should remain
      expect(hasBuff(updatedAlly, 'uptimeAtk')).toBe(true)
      // Shield should be applied
      expect(hasBuff(updatedAlly, 'shield')).toBe(true)
      const shield = updatedAlly.buffs.find((b) => b.id === 'shield')
      expect(shield!.stacks).toBe(130) // Level 1 shield
      expect(shield!.cyclesRemaining).toBe(2)
    })

    it('removes root and silence debuffs', () => {
      const ally = makeAlly({
        buffs: [
          { id: 'root', stacks: 1, cyclesRemaining: 2, source: 'enemy' },
          { id: 'silence', stacks: 1, cyclesRemaining: 3, source: 'enemy' },
        ],
      })
      const player = makePlayer({ level: 1 })
      const state = makeState([player, ally])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'a1' }))

      const updatedAlly = result.state.players['a1']!
      expect(hasBuff(updatedAlly, 'root')).toBe(false)
      expect(hasBuff(updatedAlly, 'silence')).toBe(false)
    })

    it('scales shield with level', () => {
      const player = makePlayer({ level: 7 }) // W level 4
      const ally = makeAlly()
      const state = makeState([player, ally])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'a1' }))

      const shield = result.state.players['a1']!.buffs.find((b) => b.id === 'shield')
      expect(shield!.stacks).toBe(250) // Level 4 shield
    })

    it('can target self', () => {
      const player = makePlayer({
        level: 1,
        buffs: [{ id: 'slow', stacks: 25, cyclesRemaining: 3, source: 'enemy' }],
      })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w', { kind: 'self' }))

      const updated = result.state.players['p1']!
      expect(hasBuff(updated, 'slow')).toBe(false)
      expect(hasBuff(updated, 'shield')).toBe(true)
    })

    it('deducts BW and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const ally = makeAlly()
      const state = makeState([player, ally])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'a1' }))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(380 - 90) // Level 1 W costs 90
      expect(updated.cooldowns.w).toBe(12)
    })

    it('fails with insufficient BW', () => {
      const player = makePlayer({ bw: 10 })
      const ally = makeAlly()
      const state = makeState([player, ally])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'a1' }),
      )
      expect(result._tag).toBe('Failure')
    })
  })

  describe('E: Kill Signal (Damage + Taunt)', () => {
    it('deals kinetic damage and taunts target enemy', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'e1' }))

      const updatedEnemy = result.state.players['e1']!
      expect(updatedEnemy.integ).toBeLessThan(enemy.integ)
      expect(hasBuff(updatedEnemy, 'taunt')).toBe(true)
      const taunt = updatedEnemy.buffs.find((b) => b.id === 'taunt')
      // raw 2 = one gated action: a cast-applied disable is reaped same-tick.
      expect(taunt!.cyclesRemaining).toBe(2)
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

      const dmg1 = enemy1.integ - result1.state.players['e1']!.integ
      const dmg2 = enemy2.integ - result2.state.players['e2']!.integ
      expect(dmg2).toBeGreaterThan(dmg1)
    })

    it('deducts BW and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'e1' }))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(380 - 55) // Level 1 E costs 55
      expect(updated.cooldowns.e).toBe(10)
    })

    it('requires hero target', () => {
      const player = makePlayer()
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'e'))
      expect(result._tag).toBe('Failure')
    })

    it('fails when target is in different zone', () => {
      const player = makePlayer()
      const enemy = makeEnemy({ zone: 'top-river' })
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'e1' }),
      )
      expect(result._tag).toBe('Failure')
    })

    it('fails with insufficient BW', () => {
      const player = makePlayer({ bw: 10 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'e1' }),
      )
      expect(result._tag).toBe('Failure')
    })
  })

  describe('R: Crontab (AoE HoT)', () => {
    it('requires level 6+', () => {
      const player = makePlayer({ level: 5, bw: 500 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'r'))
      expect(result._tag).toBe('Failure')
    })

    it('applies crontabHeal buff to self and allies in zone', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const ally = makeAlly()
      const state = makeState([player, ally])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      expect(hasBuff(result.state.players['p1']!, 'crontabHeal')).toBe(true)
      expect(hasBuff(result.state.players['a1']!, 'crontabHeal')).toBe(true)
      const buff = result.state.players['p1']!.buffs.find((b) => b.id === 'crontabHeal')
      expect(buff!.stacks).toBe(75) // Level 1 R heal per cycle
      expect(buff!.cyclesRemaining).toBe(4)
    })

    it('also applies the crontabBw buff (the BW-over-time half) to self and allies', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const ally = makeAlly()
      const state = makeState([player, ally])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      expect(hasBuff(result.state.players['p1']!, 'crontabBw')).toBe(true)
      expect(hasBuff(result.state.players['a1']!, 'crontabBw')).toBe(true)
      const mana = result.state.players['p1']!.buffs.find((b) => b.id === 'crontabBw')
      expect(mana!.stacks).toBe(15) // R_BW_PER_CYCLE
      expect(mana!.cyclesRemaining).toBe(4)
    })

    it('does not affect allies in different zone', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const ally = makeAlly({ zone: 'top-river' })
      const state = makeState([player, ally])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      expect(hasBuff(result.state.players['p1']!, 'crontabHeal')).toBe(true)
      expect(hasBuff(result.state.players['a1']!, 'crontabHeal')).toBe(false)
    })

    it('scales heal per cycle with R level', () => {
      const player = makePlayer({ level: 12, bw: 500 }) // R level 2
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      const buff = result.state.players['p1']!.buffs.find((b) => b.id === 'crontabHeal')
      expect(buff!.stacks).toBe(110) // Level 2 R heal per cycle
    })

    it('deducts BW and sets cooldown', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(500 - 250) // R1 costs 250
      expect(updated.cooldowns.r).toBe(55)
    })

    it('fails with insufficient BW', () => {
      const player = makePlayer({ level: 6, bw: 100 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'r'))
      expect(result._tag).toBe('Failure')
    })
  })

  describe('Passive: Scheduled Task', () => {
    it('heals lowest INTEG ally on tick divisible by 4', () => {
      const player = makePlayer()
      const ally1 = makeAlly({ integ: 300, maxInteg: 550 })
      const ally2 = makeAlly({ id: 'a2', name: 'Ally2', integ: 200, maxInteg: 550 })
      const state = makeState([player, ally1, ally2], { cycle: 8 })

      const updated = resolvePassive(state, 'p1', {
        cycle: 8,
        type: 'tick_end',
        payload: {},
      })

      // Ally2 has lower INTEG so should be healed
      expect(updated.players['a2']!.integ).toBe(240) // 200 + 40
      // Ally1 should not be healed
      expect(updated.players['a1']!.integ).toBe(300)
    })

    it('does not heal on ticks not divisible by 4', () => {
      const player = makePlayer()
      const ally = makeAlly({ integ: 300, maxInteg: 550 })
      const state = makeState([player, ally], { cycle: 9 })

      const updated = resolvePassive(state, 'p1', {
        cycle: 9,
        type: 'tick_end',
        payload: {},
      })

      expect(updated.players['a1']!.integ).toBe(300) // unchanged
    })

    it('does nothing when no allies in zone', () => {
      const player = makePlayer()
      const state = makeState([player], { cycle: 8 })

      const updated = resolvePassive(state, 'p1', {
        cycle: 8,
        type: 'tick_end',
        payload: {},
      })

      expect(updated.players['p1']!.integ).toBe(620) // unchanged
    })

    it('does not heal allies in different zone', () => {
      const player = makePlayer()
      const ally = makeAlly({ integ: 300, maxInteg: 550, zone: 'top-river' })
      const state = makeState([player, ally], { cycle: 8 })

      const updated = resolvePassive(state, 'p1', {
        cycle: 8,
        type: 'tick_end',
        payload: {},
      })

      expect(updated.players['a1']!.integ).toBe(300) // unchanged
    })

    it('does not trigger on non-tick_end events', () => {
      const player = makePlayer()
      const ally = makeAlly({ integ: 300, maxInteg: 550 })
      const state = makeState([player, ally], { cycle: 8 })

      const updated = resolvePassive(state, 'p1', {
        cycle: 8,
        type: 'attack',
        payload: { attackerId: 'e1', targetId: 'p1' },
      })

      expect(updated.players['a1']!.integ).toBe(300) // unchanged
    })

    it('does not heal above maxInteg', () => {
      const player = makePlayer()
      const ally = makeAlly({ integ: 540, maxInteg: 550 })
      const state = makeState([player, ally], { cycle: 8 })

      const updated = resolvePassive(state, 'p1', {
        cycle: 8,
        type: 'tick_end',
        payload: {},
      })

      expect(updated.players['a1']!.integ).toBe(550) // capped at maxInteg
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
})
