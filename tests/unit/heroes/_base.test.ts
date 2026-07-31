import { describe, it, expect, vi } from 'vitest'
import {
  processDoTs,
  cycleAllBuffs,
  levelUpHero,
  dealDamage,
  applyBuff,
  cycleBuffs,
  removeBuff,
  hasBuff,
  getBuffStacks,
  updatePlayer,
  updatePlayers,
  addEvent,
  getAbilityLevel,
  scaleValue,
  getPlayerCombatStats,
  findTargetPlayer,
  getPlayersInZone,
  getEnemiesInZone,
  getAlliesInZone,
  getAllEnemyPlayers,
  damageEnemyNpcsInZone,
  zonesInAbilityRange,
  healPlayer,
  deductBandwidth,
  setCooldown,
  resetAllCooldowns,
  registerHero,
  getHeroResolver,
  type HeroAbilityResolver,
  type HeroPassiveResolver,
} from '~~/server/game/heroes/_base'
import { initializeZoneStates, initializeIce } from '~~/server/game/map/zones'
import type { WaveUnitState, SiltDwellerState } from '~~/shared/types/game'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  const player = {
    id: 'p1',
    name: 'TestPlayer',
    team: 'chaff',
    heroId: 'echo',
    zone: 'mid-t1-chaff',
    integ: 500,
    maxInteg: 500,
    bw: 200,
    maxBw: 200,
    level: 1,
    xp: 0,
    scrip: 600,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnCycle: null,
    plate: 3,
    ice: 15,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    iceDamageDealt: 0,
    killStreak: 0,
    buybackCost: 100,
    talents: {
      tier10: null,
      tier15: null,
      tier20: null,
      tier25: null,
    },
    ...overrides,
  }
  return player
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    cycle: 1,
    phase: 'playing',
    teams: {
      chaff: { id: 'chaff', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
      audit: { id: 'audit', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
    },
    players: {},
    zones: initializeZoneStates(),
    waves: [],
    neutrals: [],
    ice: initializeIce(),
    caches: [],
    tenant: { alive: true, integ: 5000, maxInteg: 5000, deathCycle: null },
    backup: null,
    events: [],
    surrenderVotes: { chaff: new Set(), audit: new Set() },
    timeOfDay: 'day',
    dayNightCycle: 0,
    ...overrides,
  }
}

describe('_base hero utilities', () => {
  describe('processDoTs', () => {
    it('should apply damage from DoT buffs', () => {
      const player = makePlayer({
        integ: 500,
        buffs: [{ id: 'phys_dot', stacks: 20, cyclesRemaining: 5, source: 'test' }],
      })
      const state = makeGameState({ players: { p1: player } })

      const result = processDoTs(state)
      expect(result.state.players['p1']!.integ).toBeLessThan(500)
      const dmgEvents = result.events.filter((e) => e._tag === 'damage')
      expect(dmgEvents).toHaveLength(1)
      expect(dmgEvents[0]!.targetId).toBe('p1')
      expect(dmgEvents[0]!.sourceId).toBe('test')
    })

    it('should apply multiple DoT buffs', () => {
      const player = makePlayer({
        integ: 500,
        buffs: [
          { id: 'phys_dot', stacks: 20, cyclesRemaining: 5, source: 'test' },
          { id: 'magic_dot', stacks: 30, cyclesRemaining: 5, source: 'test' },
        ],
      })
      const state = makeGameState({ players: { p1: player } })

      const result = processDoTs(state)
      expect(result.state.players['p1']!.integ).toBeLessThan(500)
      expect(result.events.filter((e) => e._tag === 'damage')).toHaveLength(2)
    })

    it('should not affect players without DoT buffs', () => {
      const player = makePlayer({ integ: 500 })
      const state = makeGameState({ players: { p1: player } })

      const result = processDoTs(state)
      expect(result.state.players['p1']!.integ).toBe(500)
      expect(result.events).toHaveLength(0)
    })

    it('should not affect dead players', () => {
      const player = makePlayer({
        integ: 0,
        alive: false,
        buffs: [{ id: 'phys_dot', stacks: 20, cyclesRemaining: 5, source: 'test' }],
      })
      const state = makeGameState({ players: { p1: player } })

      const result = processDoTs(state)
      expect(result.state.players['p1']!.integ).toBe(0)
    })

    it('should kill player if DoT damage exceeds INTEG', () => {
      const player = makePlayer({
        integ: 5,
        buffs: [{ id: 'phys_dot', stacks: 100, cyclesRemaining: 5, source: 'test' }],
      })
      const state = makeGameState({ players: { p1: player } })

      const result = processDoTs(state)
      expect(result.state.players['p1']!.integ).toBe(0)
      expect(result.state.players['p1']!.alive).toBe(false)
    })
  })

  describe('cycleAllBuffs', () => {
    it('should decrement cyclesRemaining on all buffs', () => {
      const player = makePlayer({
        buffs: [{ id: 'test_buff', stacks: 1, cyclesRemaining: 5, source: 'test' }],
      })
      const state = makeGameState({ players: { p1: player } })

      const result = cycleAllBuffs(state)
      expect(result.players['p1']!.buffs[0]!.cyclesRemaining).toBe(4)
    })

    it('should remove expired buffs', () => {
      const player = makePlayer({
        buffs: [{ id: 'expiring', stacks: 1, cyclesRemaining: 1, source: 'test' }],
      })
      const state = makeGameState({ players: { p1: player } })

      const result = cycleAllBuffs(state)
      expect(result.players['p1']!.buffs).toHaveLength(0)
    })

    it('should handle multiple buffs with different durations', () => {
      const player = makePlayer({
        buffs: [
          { id: 'buff1', stacks: 1, cyclesRemaining: 5, source: 'test' },
          { id: 'buff2', stacks: 1, cyclesRemaining: 1, source: 'test' },
        ],
      })
      const state = makeGameState({ players: { p1: player } })

      const result = cycleAllBuffs(state)
      expect(result.players['p1']!.buffs).toHaveLength(1)
      expect(result.players['p1']!.buffs[0]!.id).toBe('buff1')
    })

    it('should not affect dead players', () => {
      const player = makePlayer({
        alive: false,
        buffs: [{ id: 'test', stacks: 1, cyclesRemaining: 5, source: 'test' }],
      })
      const state = makeGameState({ players: { p1: player } })

      const result = cycleAllBuffs(state)
      expect(result.players['p1']!.buffs[0]!.cyclesRemaining).toBe(5)
    })
  })

  describe('levelUpHero', () => {
    it('should increase level', () => {
      const player = makePlayer({ level: 1 })
      const result = levelUpHero(player)
      expect(result.level).toBe(2)
    })

    it('should increase max INTEG', () => {
      const player = makePlayer({ level: 1, maxInteg: 500 })
      const result = levelUpHero(player)
      expect(result.maxInteg).toBeGreaterThan(500)
    })

    it('should increase max BW', () => {
      const player = makePlayer({ level: 1, maxBw: 200 })
      const result = levelUpHero(player)
      expect(result.maxBw).toBeGreaterThan(200)
    })

    it('should heal INTEG on level up', () => {
      const player = makePlayer({ level: 1, integ: 400, maxInteg: 500 })
      const result = levelUpHero(player)
      expect(result.integ).toBeGreaterThan(400)
    })

    it('should not exceed max INTEG on level up', () => {
      const player = makePlayer({ level: 1, integ: 500, maxInteg: 500 })
      const result = levelUpHero(player)
      expect(result.integ).toBe(result.maxInteg)
    })

    it('should handle hero without definition', () => {
      const player = makePlayer({ heroId: 'nonexistent' })
      const result = levelUpHero(player)
      expect(result.level).toBe(1)
    })
  })

  describe('dealDamage', () => {
    it('should reduce INTEG', () => {
      const player = makePlayer({ integ: 500 })
      const result = dealDamage(player, 50, 'black')
      expect(result.integ).toBe(450)
    })

    it('should kill player when INTEG reaches 0', () => {
      const player = makePlayer({ integ: 50 })
      const result = dealDamage(player, 100, 'black')
      expect(result.integ).toBe(0)
      expect(result.alive).toBe(false)
    })

    it('should absorb damage with shield buff', () => {
      const player = makePlayer({
        integ: 500,
        buffs: [{ id: 'shield', stacks: 50, cyclesRemaining: 5, source: 'test' }],
      })
      const result = dealDamage(player, 30, 'black')
      expect(result.integ).toBe(500)
      expect(result.buffs.find((b) => b.id === 'shield')!.stacks).toBe(20)
    })

    it('should remove shield when depleted', () => {
      const player = makePlayer({
        integ: 500,
        buffs: [{ id: 'shield', stacks: 20, cyclesRemaining: 5, source: 'test' }],
      })
      const result = dealDamage(player, 50, 'black')
      expect(result.integ).toBe(470)
      expect(result.buffs.find((b) => b.id === 'shield')).toBeUndefined()
    })

    it('should dodge attack with phaseShift buff', () => {
      const player = makePlayer({
        integ: 500,
        buffs: [{ id: 'phaseShift', stacks: 1, cyclesRemaining: 5, source: 'test' }],
      })
      const result = dealDamage(player, 100, 'black')
      expect(result.integ).toBe(500)
      expect(result.buffs.find((b) => b.id === 'phaseShift')).toBeUndefined()
    })

    it('consumes only the needed shields when holding two (no over-drain)', () => {
      // Regression: absorbShield sized off the FIRST shield only and then
      // subtracted the damage from ALL shields (full-absorb) — a 20 hit against
      // a 30+40 pool wrongly drained both. It must spend the first shield first.
      const player = makePlayer({
        integ: 500,
        buffs: [
          { id: 'shield', stacks: 30, cyclesRemaining: 5, source: 's1' },
          { id: 'shield', stacks: 40, cyclesRemaining: 5, source: 's2' },
        ],
      })
      const result = dealDamage(player, 20, 'black')
      expect(result.integ).toBe(500)
      expect(result.buffs.find((b) => b.id === 'shield' && b.source === 's1')?.stacks).toBe(10)
      expect(result.buffs.find((b) => b.id === 'shield' && b.source === 's2')?.stacks).toBe(40)
    })

    it('drains the first shield then the second across a two-shield pool (no leak/loss)', () => {
      // Regression: the partial-absorb branch filtered out ALL shields and leaked
      // the overflow to INTEG — a 50 hit against a 30+40 pool wrongly deleted both
      // shields AND dealt 20 to INTEG. It must keep the partially-spent second shield
      // and absorb the whole 50.
      const player = makePlayer({
        integ: 500,
        buffs: [
          { id: 'shield', stacks: 30, cyclesRemaining: 5, source: 's1' },
          { id: 'shield', stacks: 40, cyclesRemaining: 5, source: 's2' },
        ],
      })
      const result = dealDamage(player, 50, 'black')
      expect(result.integ).toBe(500) // 50 < 70 pool → fully absorbed
      expect(result.buffs.find((b) => b.id === 'shield' && b.source === 's1')).toBeUndefined()
      expect(result.buffs.find((b) => b.id === 'shield' && b.source === 's2')?.stacks).toBe(20)
    })

    it('halves code damage into a closed (non-breached) target', () => {
      // heroId null so EffectiveStats falls back to player plate/ice (0).
      const closed = makePlayer({ integ: 500, plate: 0, ice: 0, heroId: null })
      const open = makePlayer({
        integ: 500,
        plate: 0,
        ice: 0,
        heroId: null,
        buffs: [{ id: 'breached', stacks: 1, cyclesRemaining: 3, source: 'enemy' }],
      })
      const closedDmg = 500 - dealDamage(closed, 100, 'code').integ
      const openDmg = 500 - dealDamage(open, 100, 'code').integ
      expect(closedDmg).toBe(50) // 100 * 0.5
      expect(openDmg).toBe(100)
      expect(closedDmg * 2).toBe(openDmg)
    })

    it('does not halve kinetic or black damage on a closed target', () => {
      const closed = makePlayer({ integ: 500, plate: 0, ice: 0, heroId: null })
      expect(dealDamage(closed, 100, 'kinetic').integ).toBe(400)
      expect(dealDamage(closed, 100, 'black').integ).toBe(400)
    })

    it('should apply hardened reduction', () => {
      const player = makePlayer({
        integ: 500,
        buffs: [{ id: 'hardened', stacks: 1, cyclesRemaining: 5, source: 'test' }],
      })
      const result = dealDamage(player, 100, 'black')
      expect(result.integ).toBe(410)
    })
  })

  describe('healPlayer', () => {
    it('heals up to maxInteg', () => {
      const player = makePlayer({ integ: 300, maxInteg: 500 })
      expect(healPlayer(player, 100).integ).toBe(400)
      expect(healPlayer(player, 1000).integ).toBe(500)
    })

    it('reduces healing by the cache Invalidate antiHeal % (stored in stacks)', () => {
      const player = makePlayer({
        integ: 300,
        maxInteg: 500,
        buffs: [{ id: 'antiHeal', stacks: 50, cyclesRemaining: 3, source: 'cache' }],
      })
      // 100 heal at 50% antiHeal → 50 effective.
      expect(healPlayer(player, 100).integ).toBe(350)
    })
  })

  describe('applyBuff', () => {
    it('should add new buff', () => {
      const player = makePlayer()
      const buff: BuffState = { id: 'test', stacks: 1, cyclesRemaining: 5, source: 'test' }
      const result = applyBuff(player, buff)
      expect(result.buffs).toHaveLength(1)
    })

    it('should refresh existing buff duration', () => {
      const player = makePlayer({
        buffs: [{ id: 'test', stacks: 1, cyclesRemaining: 2, source: 'test' }],
      })
      const buff: BuffState = { id: 'test', stacks: 1, cyclesRemaining: 5, source: 'test' }
      const result = applyBuff(player, buff)
      expect(result.buffs[0]!.cyclesRemaining).toBe(5)
    })

    it('should update existing buff stacks', () => {
      const player = makePlayer({
        buffs: [{ id: 'test', stacks: 1, cyclesRemaining: 5, source: 'test' }],
      })
      const buff: BuffState = { id: 'test', stacks: 3, cyclesRemaining: 5, source: 'test' }
      const result = applyBuff(player, buff)
      expect(result.buffs[0]!.stacks).toBe(3)
    })

    it('should keep max duration when refreshing', () => {
      const player = makePlayer({
        buffs: [{ id: 'test', stacks: 1, cyclesRemaining: 10, source: 'test' }],
      })
      const buff: BuffState = { id: 'test', stacks: 1, cyclesRemaining: 5, source: 'test' }
      const result = applyBuff(player, buff)
      expect(result.buffs[0]!.cyclesRemaining).toBe(10)
    })

    it('fizzles hard control on a closed (non-breached) target', () => {
      const closed = makePlayer({ id: 'victim' })
      for (const id of ['stun', 'silence', 'root', 'taunt', 'feared', 'hex', 'cyclone'] as const) {
        const result = applyBuff(closed, {
          id,
          stacks: 1,
          cyclesRemaining: 2,
          source: 'enemy',
        })
        expect(
          result.buffs.some((b) => b.id === id),
          id,
        ).toBe(false)
      }
    })

    it('lands hard control on a breached target', () => {
      const open = makePlayer({
        id: 'victim',
        buffs: [{ id: 'breached', stacks: 1, cyclesRemaining: 3, source: 'enemy' }],
      })
      const result = applyBuff(open, {
        id: 'stun',
        stacks: 1,
        cyclesRemaining: 2,
        source: 'enemy',
      })
      expect(result.buffs.some((b) => b.id === 'stun')).toBe(true)
    })

    it('lands self-applied hard control even when closed (mutex self-root)', () => {
      const self = makePlayer({ id: 'p1' })
      const result = applyBuff(self, {
        id: 'root',
        stacks: 1,
        cyclesRemaining: 2,
        source: 'p1',
      })
      expect(result.buffs.some((b) => b.id === 'root')).toBe(true)
    })

    it('applying airgap strips breached in the same call', () => {
      const open = makePlayer({
        buffs: [{ id: 'breached', stacks: 1, cyclesRemaining: 3, source: 'enemy' }],
      })
      const result = applyBuff(open, {
        id: 'airgap',
        stacks: 1,
        cyclesRemaining: 4,
        source: 'hardshell',
      })
      expect(result.buffs.some((b) => b.id === 'breached')).toBe(false)
      expect(result.buffs.some((b) => b.id === 'airgap')).toBe(true)
    })

    it('still applies non-control buffs to a closed target', () => {
      const closed = makePlayer()
      const result = applyBuff(closed, {
        id: 'shield',
        stacks: 100,
        cyclesRemaining: 3,
        source: 'self',
      })
      expect(result.buffs.some((b) => b.id === 'shield')).toBe(true)
    })
  })

  describe('cycleBuffs', () => {
    it('should decrement all buff durations', () => {
      const player = makePlayer({
        buffs: [{ id: 'test', stacks: 1, cyclesRemaining: 5, source: 'test' }],
      })
      const result = cycleBuffs(player)
      expect(result.buffs[0]!.cyclesRemaining).toBe(4)
    })

    it('should remove expired buffs', () => {
      const player = makePlayer({
        buffs: [{ id: 'test', stacks: 1, cyclesRemaining: 1, source: 'test' }],
      })
      const result = cycleBuffs(player)
      expect(result.buffs).toHaveLength(0)
    })
  })

  describe('removeBuff', () => {
    it('should remove buff by id', () => {
      const player = makePlayer({
        buffs: [
          { id: 'buff1', stacks: 1, cyclesRemaining: 5, source: 'test' },
          { id: 'buff2', stacks: 1, cyclesRemaining: 5, source: 'test' },
        ],
      })
      const result = removeBuff(player, 'buff1')
      expect(result.buffs).toHaveLength(1)
      expect(result.buffs[0]!.id).toBe('buff2')
    })

    it('should handle missing buff', () => {
      const player = makePlayer()
      const result = removeBuff(player, 'nonexistent')
      expect(result.buffs).toHaveLength(0)
    })
  })

  describe('hasBuff', () => {
    it('should return true when buff exists', () => {
      const player = makePlayer({
        buffs: [{ id: 'test', stacks: 1, cyclesRemaining: 5, source: 'test' }],
      })
      expect(hasBuff(player, 'test')).toBe(true)
    })

    it('should return false when buff does not exist', () => {
      const player = makePlayer()
      expect(hasBuff(player, 'test')).toBe(false)
    })
  })

  describe('getBuffStacks', () => {
    it('should return buff stacks', () => {
      const player = makePlayer({
        buffs: [{ id: 'test', stacks: 5, cyclesRemaining: 5, source: 'test' }],
      })
      expect(getBuffStacks(player, 'test')).toBe(5)
    })

    it('should return 0 when buff does not exist', () => {
      const player = makePlayer()
      expect(getBuffStacks(player, 'test')).toBe(0)
    })
  })

  describe('getAbilityLevel', () => {
    it('should return 0 for Q at level 0', () => {
      expect(getAbilityLevel(0, 'q')).toBe(0)
    })

    it('should return 1 for Q at level 1', () => {
      expect(getAbilityLevel(1, 'q')).toBe(1)
    })

    it('should return 4 for Q at level 7+', () => {
      expect(getAbilityLevel(7, 'q')).toBe(4)
      expect(getAbilityLevel(25, 'q')).toBe(4)
    })

    it('should return 0 for R at level 5', () => {
      expect(getAbilityLevel(5, 'r')).toBe(0)
    })

    it('should return 1 for R at level 6', () => {
      expect(getAbilityLevel(6, 'r')).toBe(1)
    })

    it('should return 3 for R at level 18+', () => {
      expect(getAbilityLevel(18, 'r')).toBe(3)
      expect(getAbilityLevel(25, 'r')).toBe(3)
    })
  })

  describe('scaleValue', () => {
    it('should return 0 for level 0', () => {
      expect(scaleValue([10, 20, 30], 0)).toBe(0)
    })

    it('should return first value for level 1', () => {
      expect(scaleValue([10, 20, 30], 1)).toBe(10)
    })

    it('should return last value for level exceeding array', () => {
      expect(scaleValue([10, 20, 30], 10)).toBe(30)
    })
  })

  describe('getPlayerCombatStats', () => {
    it('should return base stats at level 1', () => {
      const player = makePlayer({ heroId: 'echo', level: 1 })
      const stats = getPlayerCombatStats(player)
      expect(stats.attack).toBeGreaterThan(0)
      expect(stats.plate).toBeGreaterThanOrEqual(0)
    })

    it('should return zero stats for invalid hero', () => {
      const player = makePlayer({ heroId: 'nonexistent' })
      const stats = getPlayerCombatStats(player)
      expect(stats.attack).toBe(0)
      expect(stats.plate).toBe(0)
      expect(stats.ice).toBe(0)
    })
  })

  describe('findTargetPlayer', () => {
    it('should find player by heroId', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ id: 'p1', heroId: 'echo' }) },
      })
      const result = findTargetPlayer(state, { kind: 'hero', name: 'echo' })
      expect(result?.id).toBe('p1')
    })

    it('should find player by name', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ id: 'p1', name: 'TestPlayer' }) },
      })
      const result = findTargetPlayer(state, { kind: 'hero', name: 'TestPlayer' })
      expect(result?.id).toBe('p1')
    })

    it('should return undefined for not found', () => {
      const state = makeGameState()
      const result = findTargetPlayer(state, { kind: 'hero', name: 'nonexistent' })
      expect(result).toBeUndefined()
    })
  })

  describe('getPlayersInZone', () => {
    it('should return players in zone', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', zone: 'mid-river' }),
          p2: makePlayer({ id: 'p2', zone: 'mid-river' }),
          p3: makePlayer({ id: 'p3', zone: 'top-river' }),
        },
      })
      const result = getPlayersInZone(state, 'mid-river')
      expect(result).toHaveLength(2)
    })

    it('should exclude dead players', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', zone: 'mid-river', alive: false }),
          p2: makePlayer({ id: 'p2', zone: 'mid-river' }),
        },
      })
      const result = getPlayersInZone(state, 'mid-river')
      expect(result).toHaveLength(1)
    })
  })

  describe('getEnemiesInZone', () => {
    it('should return enemies in zone', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'chaff', zone: 'mid-river' }),
          p2: makePlayer({ id: 'p2', team: 'audit', zone: 'mid-river' }),
        },
      })
      const result = getEnemiesInZone(state, state.players['p1']!)
      expect(result).toHaveLength(1)
      expect(result[0]!.team).toBe('audit')
    })
  })

  describe('getAlliesInZone', () => {
    it('should return allies in zone excluding self', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'chaff', zone: 'mid-river' }),
          p2: makePlayer({ id: 'p2', team: 'chaff', zone: 'mid-river' }),
          p3: makePlayer({ id: 'p3', team: 'audit', zone: 'mid-river' }),
        },
      })
      const result = getAlliesInZone(state, state.players['p1']!)
      expect(result).toHaveLength(1)
      expect(result[0]!.id).toBe('p2')
    })
  })

  describe('getAllEnemyPlayers', () => {
    it('should return all enemy players', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'chaff' }),
          p2: makePlayer({ id: 'p2', team: 'audit' }),
          p3: makePlayer({ id: 'p3', team: 'audit' }),
        },
      })
      const result = getAllEnemyPlayers(state, state.players['p1']!)
      expect(result).toHaveLength(2)
    })

    it('should exclude dead enemies', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'chaff' }),
          p2: makePlayer({ id: 'p2', team: 'audit', alive: false }),
        },
      })
      const result = getAllEnemyPlayers(state, state.players['p1']!)
      expect(result).toHaveLength(0)
    })
  })

  describe('healPlayer', () => {
    it('should heal player', () => {
      const player = makePlayer({ integ: 400, maxInteg: 500 })
      const result = healPlayer(player, 50)
      expect(result.integ).toBe(450)
    })

    it('should not exceed maxInteg', () => {
      const player = makePlayer({ integ: 480, maxInteg: 500 })
      const result = healPlayer(player, 50)
      expect(result.integ).toBe(500)
    })
  })

  describe('deductBandwidth', () => {
    it('should deduct BW', () => {
      const player = makePlayer({ bw: 200 })
      const result = deductBandwidth(player, 50)
      expect(result.bw).toBe(150)
    })

    it('should not go below 0', () => {
      const player = makePlayer({ bw: 30 })
      const result = deductBandwidth(player, 50)
      expect(result.bw).toBe(0)
    })
  })

  describe('setCooldown', () => {
    it('should set cooldown for ability', () => {
      const player = makePlayer()
      const result = setCooldown(player, 'q', 10)
      expect(result.cooldowns.q).toBe(10)
    })
  })

  describe('resetAllCooldowns', () => {
    it('should reset all cooldowns to 0', () => {
      const player = makePlayer({ cooldowns: { q: 5, w: 3, e: 2, r: 1 } })
      const result = resetAllCooldowns(player)
      expect(result.cooldowns).toEqual({ q: 0, w: 0, e: 0, r: 0 })
    })
  })

  describe('updatePlayer', () => {
    it('should update player in state', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ id: 'p1', integ: 500 }) },
      })
      const updatedPlayer = { ...state.players['p1']!, integ: 400 }
      const result = updatePlayer(state, updatedPlayer)
      expect(result.players['p1']!.integ).toBe(400)
    })
  })

  describe('updatePlayers', () => {
    it('should update multiple players', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', integ: 500 }),
          p2: makePlayer({ id: 'p2', integ: 500 }),
        },
      })
      const updated = [
        { ...state.players['p1']!, integ: 400 },
        { ...state.players['p2']!, integ: 300 },
      ]
      const result = updatePlayers(state, updated)
      expect(result.players['p1']!.integ).toBe(400)
      expect(result.players['p2']!.integ).toBe(300)
    })
  })

  describe('addEvent', () => {
    it('should add event to state', () => {
      const state = makeGameState()
      const event: GameEvent = { cycle: 1, type: 'test', payload: {} }
      const result = addEvent(state, event)
      expect(result.events).toHaveLength(1)
    })
  })

  describe('hero registry', () => {
    it('should register and retrieve hero resolver', () => {
      const mockResolver = vi.fn()
      const mockPassive = vi.fn()

      registerHero(
        'test_hero',
        mockResolver as unknown as HeroAbilityResolver,
        mockPassive as unknown as HeroPassiveResolver,
      )
      const resolver = getHeroResolver('test_hero')

      expect(resolver).toBeDefined()
    })

    it('should return undefined for unregistered hero', () => {
      const resolver = getHeroResolver('nonexistent')
      expect(resolver).toBeUndefined()
    })
  })

  describe('TP channeling completion', () => {
    it('should complete teleport after channeling duration', () => {
      const player = makePlayer({
        zone: 'mid-t1-chaff',
        buffs: [
          { id: 'tp_channeling', stacks: 1, cyclesRemaining: 1, source: 'recall_token' },
          {
            id: 'tp_destination',
            stacks: 1,
            cyclesRemaining: 2,
            source: 'recall_token',
            destination: 'chaff-fountain',
          },
        ],
      })
      const state = makeGameState({ players: { p1: player } })

      const result = cycleAllBuffs(state)

      expect(result.players['p1']!.zone).toBe('chaff-fountain')
      expect(result.players['p1']!.buffs).toHaveLength(0)
      expect(result.events).toHaveLength(1)
      expect(result.events[0]!.type).toBe('teleport_complete')
      expect(result.events[0]!.payload.destination).toBe('chaff-fountain')
    })

    it('should not teleport while channeling is in progress', () => {
      const player = makePlayer({
        zone: 'mid-t1-chaff',
        buffs: [
          { id: 'tp_channeling', stacks: 1, cyclesRemaining: 2, source: 'recall_token' },
          {
            id: 'tp_destination',
            stacks: 1,
            cyclesRemaining: 3,
            source: 'recall_token',
            destination: 'chaff-fountain',
          },
        ],
      })
      const state = makeGameState({ players: { p1: player } })

      const result = cycleAllBuffs(state)

      expect(result.players['p1']!.zone).toBe('mid-t1-chaff')
      expect(result.players['p1']!.buffs).toHaveLength(2)
      expect(result.events).toHaveLength(0)
    })

    it('should teleport to audit fountain for audit player', () => {
      const player = makePlayer({
        team: 'audit',
        zone: 'mid-t1-audit',
        buffs: [
          { id: 'tp_channeling', stacks: 1, cyclesRemaining: 1, source: 'recall_token' },
          {
            id: 'tp_destination',
            stacks: 1,
            cyclesRemaining: 2,
            source: 'recall_token',
            destination: 'audit-fountain',
          },
        ],
      })
      const state = makeGameState({ players: { p1: player } })

      const result = cycleAllBuffs(state)

      expect(result.players['p1']!.zone).toBe('audit-fountain')
      expect(result.players['p1']!.buffs).toHaveLength(0)
    })

    it('should handle missing destination buff gracefully', () => {
      const player = makePlayer({
        zone: 'mid-t1-chaff',
        buffs: [{ id: 'tp_channeling', stacks: 1, cyclesRemaining: 1, source: 'recall_token' }],
      })
      const state = makeGameState({ players: { p1: player } })

      const result = cycleAllBuffs(state)

      expect(result.players['p1']!.zone).toBe('mid-t1-chaff')
      expect(result.players['p1']!.buffs).toHaveLength(0)
    })
  })

  describe('damageEnemyNpcsInZone', () => {
    const wave = (over: Partial<WaveUnitState> = {}): WaveUnitState => ({
      id: 'c1',
      team: 'audit',
      zone: 'mid-t1-chaff',
      integ: 400,
      maxInteg: 400,
      type: 'line',
      ...over,
    })
    const neutral = (over: Partial<SiltDwellerState> = {}): SiltDwellerState => ({
      id: 'n1',
      zone: 'silt-chaff-top',
      integ: 250,
      maxInteg: 250,
      type: 'stub',
      alive: true,
      ...over,
    })

    it('damages enemy waves standing in the caster’s zone', () => {
      const caster = makePlayer({ zone: 'mid-t1-chaff', team: 'chaff' })
      const state = makeGameState({ waves: [wave()] })

      const result = damageEnemyNpcsInZone(state, caster, 150, 'code')

      expect(result.waves[0]!.integ).toBe(250)
    })

    it('spares allied waves and waves in every other zone', () => {
      const caster = makePlayer({ zone: 'mid-t1-chaff', team: 'chaff' })
      const state = makeGameState({
        waves: [wave({ id: 'ally', team: 'chaff' }), wave({ id: 'elsewhere', zone: 'top-river' })],
      })

      const result = damageEnemyNpcsInZone(state, caster, 150, 'code')

      // Nothing was in range, so the same state object comes back untouched —
      // the cast bridge reads that reference equality to skip its kill diff.
      expect(result).toBe(state)
    })

    it('kills a wave to exactly 0 rather than negative INTEG', () => {
      const caster = makePlayer({ zone: 'mid-t1-chaff', team: 'chaff' })
      const state = makeGameState({ waves: [wave({ integ: 30 })] })

      const result = damageEnemyNpcsInZone(state, caster, 900, 'kinetic')

      expect(result.waves[0]!.integ).toBe(0)
    })

    it('leaves a dead wave in the buffer so the caller can credit the kill', () => {
      const caster = makePlayer({ zone: 'mid-t1-chaff', team: 'chaff' })
      const state = makeGameState({ waves: [wave({ integ: 30 })] })

      const result = damageEnemyNpcsInZone(state, caster, 900, 'kinetic')

      expect(result.waves).toHaveLength(1)
      expect(result.waves[0]!.id).toBe('c1')
    })

    it('does not re-damage a wave already at 0 INTEG', () => {
      const caster = makePlayer({ zone: 'mid-t1-chaff', team: 'chaff' })
      const dead = wave({ integ: 0 })
      const state = makeGameState({ waves: [dead] })

      const result = damageEnemyNpcsInZone(state, caster, 150, 'kinetic')

      expect(result).toBe(state)
    })

    it('damages neutrals, which are hostile to both teams, and flips alive on death', () => {
      const caster = makePlayer({ zone: 'silt-chaff-top', team: 'chaff' })
      const state = makeGameState({ neutrals: [neutral({ integ: 100 })] })

      const chipped = damageEnemyNpcsInZone(state, caster, 40, 'code')
      expect(chipped.neutrals[0]!.integ).toBe(60)
      expect(chipped.neutrals[0]!.alive).toBe(true)

      const killed = damageEnemyNpcsInZone(state, caster, 100, 'code')
      expect(killed.neutrals[0]!.integ).toBe(0)
      expect(killed.neutrals[0]!.alive).toBe(false)
    })

    it('applies the caster’s Mystical Staff amp to code damage only', () => {
      const zone = 'mid-t1-chaff'
      const amped = makePlayer({ zone, items: ['amp_stack', null, null, null, null, null] })
      const plain = makePlayer({ zone })
      const state = makeGameState({ waves: [wave()] })

      // 100 code -> 115 with the +15% amp; kinetic is unamplified.
      expect(damageEnemyNpcsInZone(state, amped, 100, 'code').waves[0]!.integ).toBe(285)
      expect(damageEnemyNpcsInZone(state, plain, 100, 'code').waves[0]!.integ).toBe(300)
      expect(damageEnemyNpcsInZone(state, amped, 100, 'kinetic').waves[0]!.integ).toBe(300)
    })

    it('no-ops on a zero-damage cast (cache R with nothing banked)', () => {
      const caster = makePlayer({ zone: 'mid-t1-chaff' })
      const state = makeGameState({ waves: [wave()] })

      expect(damageEnemyNpcsInZone(state, caster, 0, 'black')).toBe(state)
    })

    it('reaches the widened zone list an AOE+ cast passes in', () => {
      const caster = makePlayer({ zone: 'mid-t1-chaff', team: 'chaff' })
      const state = makeGameState({ waves: [wave({ id: 'next-door', zone: 'mid-river' })] })

      expect(damageEnemyNpcsInZone(state, caster, 150, 'code')).toBe(state)
      const widened = damageEnemyNpcsInZone(state, caster, 150, 'code', [
        'mid-t1-chaff',
        'mid-river',
      ])
      expect(widened.waves[0]!.integ).toBe(250)
    })
  })

  describe('zonesInAbilityRange', () => {
    it('returns just the caster’s zone unless the reach is widened', () => {
      expect(zonesInAbilityRange('mid-river', false)).toEqual(['mid-river'])
    })

    it('adds every adjacent zone when widened, with the caster’s zone first', () => {
      const widened = zonesInAbilityRange('mid-river', true)
      expect(widened[0]).toBe('mid-river')
      expect(widened.length).toBeGreaterThan(1)
      expect(new Set(widened).size).toBe(widened.length)
    })
  })
})
