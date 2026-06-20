import { describe, it, expect } from 'vitest'
import type { GameState, PlayerState, RoshanState } from '../../../shared/types/game'
import { initializeZoneStates, initializeTowers } from '../../../server/game/map/zones'
import { initializeRoshan } from '../../../server/game/map/spawner'
import {
  buyback,
  calculateBuybackCost,
  canBuyback,
} from '../../../server/game/engine/BuybackSystem'
import { processSpecialActions, type PlayerAction } from '../../../server/game/engine/GameLoop'
import { getEffectiveAttack, getTalentStatBonus } from '../../../server/game/engine/EffectiveStats'
import { TALENT_TREES } from '../../../shared/constants/talents'
import { pickupAegis, processRoshanDamage } from '../../../server/game/engine/RoshanAI'
import {
  calculateVision,
  filterStateForPlayer,
  type FoggedPlayer,
} from '../../../server/game/engine/VisionCalculator'
import {
  BUYBACK_BASE_COST,
  BUYBACK_COST_PER_LEVEL,
  BUYBACK_COOLDOWN_TICKS,
  ROSHAN_AEGIS_TICKS,
  ROSHAN_RESPAWN_TICKS,
  NIGHT_VISION_PENALTY,
} from '../../../shared/constants/balance'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'Player1',
    team: 'radiant',
    heroId: 'echo',
    zone: 'mid-t1-rad',
    hp: 500,
    maxHp: 500,
    mp: 200,
    maxMp: 200,
    level: 1,
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
    damageDealt: 0,
    towerDamageDealt: 0,
    killStreak: 0,
    ...overrides,
  }
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    tick: 1,
    phase: 'playing',
    teams: {
      radiant: { id: 'radiant', kills: 0, towerKills: 0, gold: 0 },
      dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0 },
    },
    players: {},
    zones: initializeZoneStates(),
    creeps: [],
    neutrals: [],
    towers: initializeTowers(),
    runes: [],
    roshan: initializeRoshan(),
    aegis: null,
    events: [],
    ...overrides,
  }
}

describe('systems-gaps: BUYBACK success', () => {
  it('calculateBuybackCost = base + level*perLevel + deaths*10', () => {
    const player = makePlayer({ level: 7, deaths: 3 })
    const expected = BUYBACK_BASE_COST + 7 * BUYBACK_COST_PER_LEVEL + 3 * 10
    expect(calculateBuybackCost(player)).toBe(expected)
    // sanity: 100 + 175 + 30 = 305
    expect(expected).toBe(305)
  })

  it('a dead player with enough gold buys back: gold deducted, full HP/MP, fountain, cooldown', () => {
    const player = makePlayer({
      level: 5,
      deaths: 2,
      alive: false,
      respawnTick: 200,
      hp: 0,
      mp: 0,
      gold: 2000,
      zone: 'dire-base',
    })
    const cost = calculateBuybackCost(player) // 100 + 125 + 20 = 245
    expect(cost).toBe(245)

    const state = makeGameState({ tick: 50, players: { p1: player } })
    const result = buyback(state, 'p1')

    expect(result.success).toBe(true)
    const after = result.newState!.players['p1']!
    expect(after.gold).toBe(2000 - cost)
    expect(after.alive).toBe(true)
    expect(after.hp).toBe(after.maxHp)
    expect(after.mp).toBe(after.maxMp)
    expect(after.respawnTick).toBeNull()
    expect(after.zone).toBe('radiant-fountain')
    expect(after.buybackCooldown).toBe(50 + BUYBACK_COOLDOWN_TICKS)
  })

  it('canBuyback rejects when on cooldown and when too poor', () => {
    const onCd = makePlayer({ alive: false, gold: 5000, buybackCooldown: 100 })
    const cdState = makeGameState({ tick: 50, players: { p1: onCd } })
    expect(canBuyback(cdState, 'p1').can).toBe(false)

    const poor = makePlayer({ alive: false, gold: 0, level: 1 })
    const poorState = makeGameState({ tick: 50, players: { p1: poor } })
    expect(canBuyback(poorState, 'p1').can).toBe(false)
  })

  it('GameLoop processSpecialActions wires buyback: deducts gold + emits heal/power_spike', () => {
    const player = makePlayer({
      level: 5,
      deaths: 2,
      alive: false,
      respawnTick: 200,
      hp: 0,
      mp: 0,
      gold: 2000,
    })
    const cost = calculateBuybackCost(player)
    const state = makeGameState({ tick: 50, players: { p1: player } })

    const actions: PlayerAction[] = [{ playerId: 'p1', command: { type: 'buyback' } }]
    const { state: after, events, rejectedActions } = processSpecialActions(state, actions)

    expect(rejectedActions).toHaveLength(0)
    const ap = after.players['p1']!
    expect(ap.alive).toBe(true)
    expect(ap.gold).toBe(2000 - cost)
    expect(ap.hp).toBe(ap.maxHp)

    const heal = events.find(
      (e) => e._tag === 'heal' && (e as { sourceId?: string }).sourceId === 'buyback',
    )
    expect(heal).toBeDefined()
    expect((heal as { amount: number }).amount).toBe(ap.maxHp)
    const spike = events.find(
      (e) => e._tag === 'power_spike' && (e as { itemId?: string }).itemId === 'buyback',
    )
    expect(spike).toBeDefined()
  })
})

describe('systems-gaps: TALENT stat-bonus effect', () => {
  it('echo_10_left (+15 attack) raises getEffectiveAttack by exactly 15', () => {
    const base = makePlayer({
      heroId: 'echo',
      talents: { tier10: null, tier15: null, tier20: null, tier25: null },
    })
    const withTalent = makePlayer({
      heroId: 'echo',
      talents: { tier10: 'echo_10_left', tier15: null, tier20: null, tier25: null },
    })
    expect(getTalentStatBonus(withTalent, 'attack')).toBe(15)
    expect(getEffectiveAttack(withTalent) - getEffectiveAttack(base)).toBe(15)
  })

  it('echo_10_right (+200 hp) is reported by getTalentStatBonus (consumed by maxHp recompute)', () => {
    const withTalent = makePlayer({
      heroId: 'echo',
      talents: { tier10: 'echo_10_right', tier15: null, tier20: null, tier25: null },
    })
    // ActionResolver recomputes maxHp as baseMaxHp + itemHp + getTalentStatBonus(player, 'hp')
    expect(getTalentStatBonus(withTalent, 'hp')).toBe(200)
    // and that selecting the hp talent does NOT spill into attack
    expect(getTalentStatBonus(withTalent, 'attack')).toBe(0)
  })
})

describe('systems-gaps: AEGIS ground pickup', () => {
  it('pickupAegis in roshan-pit applies aegis buff, clears the ground aegis, emits aegis_picked', () => {
    const state = makeGameState({
      tick: 120,
      aegis: { zone: 'roshan-pit', tick: 100, holderId: null },
      players: { p1: makePlayer({ id: 'p1', zone: 'roshan-pit' }) },
    })

    const { state: after, event } = pickupAegis(state, 'p1')

    const buff = after.players['p1']!.buffs.find((b) => b.id === 'aegis')!
    expect(buff).toBeDefined()
    expect(buff.stacks).toBe(ROSHAN_AEGIS_TICKS)
    expect(buff.ticksRemaining).toBe(ROSHAN_AEGIS_TICKS)
    expect(after.aegis).toBeNull()
    expect(event).not.toBeNull()
    expect(event!._tag).toBe('aegis_picked')
    expect((event as { playerId?: string }).playerId).toBe('p1')
  })

  it('pickupAegis is a no-op when the player is outside roshan-pit (in-pit guard)', () => {
    const state = makeGameState({
      aegis: { zone: 'roshan-pit', tick: 100, holderId: null },
      players: { p1: makePlayer({ id: 'p1', zone: 'mid-river' }) },
    })
    const { state: after, event } = pickupAegis(state, 'p1')
    expect(after.players['p1']!.buffs.find((b) => b.id === 'aegis')).toBeUndefined()
    expect(after.aegis).not.toBeNull()
    expect(event).toBeNull()
  })
})

describe('systems-gaps: ROSHAN respawn path', () => {
  it('processRoshanDamage revives a dead Roshan once ROSHAN_RESPAWN_TICKS have elapsed', () => {
    const deathTick = 100
    const state = makeGameState({
      tick: deathTick + ROSHAN_RESPAWN_TICKS,
      roshan: { alive: false, hp: 0, maxHp: 5000, deathTick } as RoshanState,
    })
    const result = processRoshanDamage(state, new Map())

    expect(result.state.roshan.alive).toBe(true)
    expect(result.state.roshan.hp).toBeGreaterThan(0)
    expect(result.state.roshan.deathTick).toBeNull()
    const respawnEvt = result.events.find((e) => e._tag === 'roshan_respawn')
    expect(respawnEvt).toBeDefined()
  })

  it('processRoshanDamage does NOT revive before the respawn timer', () => {
    const deathTick = 100
    const state = makeGameState({
      tick: deathTick + ROSHAN_RESPAWN_TICKS - 1,
      roshan: { alive: false, hp: 0, maxHp: 5000, deathTick } as RoshanState,
    })
    const result = processRoshanDamage(state, new Map())
    expect(result.state.roshan.alive).toBe(false)
  })
})

describe('systems-gaps: VISION gaps', () => {
  it('night-vision shrinks the adjacency set but KEEPS the own zone', () => {
    // No towers (their zone reveals would swamp the dropped zones) and DISTINCT
    // player ids (calculateVision caches per playerId; reusing one id across the
    // two calls would serve a stale entry).
    const dayState = makeGameState({
      timeOfDay: 'day',
      towers: [],
      players: { pDay: makePlayer({ id: 'pDay', zone: 'mid-river' }) },
    })
    const nightState = makeGameState({
      timeOfDay: 'night',
      towers: [],
      players: { pNight: makePlayer({ id: 'pNight', zone: 'mid-river' }) },
    })

    const dayVision = calculateVision(dayState, 'pDay')
    const nightVision = calculateVision(nightState, 'pNight')

    expect(NIGHT_VISION_PENALTY).toBeGreaterThanOrEqual(1)
    // Night sees STRICTLY FEWER zones (the penalty trims adjacency)...
    expect(nightVision.size).toBeLessThan(dayVision.size)
    // ...but a hero ALWAYS sees its own zone, even at night (regression guard
    // for the bug where the night slice lopped the own zone off).
    expect(nightVision.has('mid-river')).toBe(true)
    // every night-visible zone is also day-visible (strict shrink, no new zones)
    for (const z of nightVision) expect(dayVision.has(z)).toBe(true)
  })

  it("'revealed' buff pierces fog: an enemy in an unseen zone is shown unfogged", () => {
    // enemy sits in dire-base (not in radiant viewer's vision), carries a
    // 'revealed' buff sourced from a radiant teammate.
    const state = makeGameState({
      timeOfDay: 'day',
      players: {
        p1: makePlayer({ id: 'p1', team: 'radiant', zone: 'mid-t1-rad' }),
        e1: makePlayer({
          id: 'e1',
          team: 'dire',
          zone: 'dire-base',
          name: 'RevealedEnemy',
          hp: 321,
          buffs: [{ id: 'revealed', stacks: 1, ticksRemaining: 5, source: 'p1' }],
        }),
      },
    })

    const filtered = filterStateForPlayer(state, 'p1')
    const enemy = filtered.players['e1']!
    expect('fogged' in enemy).toBe(false)
    expect((enemy as PlayerState).hp).toBe(321)
    expect(filtered.visibleZones).toContain('dire-base')
  })

  it('without the revealed buff the same far enemy stays fogged', () => {
    const state = makeGameState({
      timeOfDay: 'day',
      players: {
        p1: makePlayer({ id: 'p1', team: 'radiant', zone: 'mid-t1-rad' }),
        e1: makePlayer({ id: 'e1', team: 'dire', zone: 'dire-base', name: 'HiddenEnemy', hp: 321 }),
      },
    })
    const filtered = filterStateForPlayer(state, 'p1')
    const enemy = filtered.players['e1'] as FoggedPlayer
    expect(enemy.fogged).toBe(true)
  })

  it('sentry true-sight reveals invisible enemies in an ADJACENT zone (radius >= 1)', () => {
    // sentry placed in mid-river; invisible enemy stands in an ADJACENT zone.
    const zones = initializeZoneStates()
    const adjacentZone = zones['mid-river']!.id
    // pick a real neighbor of mid-river
    const neighbor = 'mid-t1-dire'
    zones[adjacentZone]!.wards.push({
      team: 'radiant',
      placedTick: 0,
      expiryTick: 100,
      type: 'sentry',
    })

    const state = makeGameState({
      zones,
      players: {
        // viewer adjacent so the enemy zone is in the visible set (true-sight only
        // strips the invis fog; it does not by itself add the zone to vision)
        p1: makePlayer({ id: 'p1', team: 'radiant', zone: 'mid-river' }),
        e1: makePlayer({
          id: 'e1',
          team: 'dire',
          zone: neighbor,
          name: 'InvisAdj',
          hp: 277,
          buffs: [{ id: 'invisible', stacks: 1, ticksRemaining: 5, source: 'e1' }],
        }),
      },
    })

    const filtered = filterStateForPlayer(state, 'p1')
    const enemy = filtered.players['e1']!
    // neighbor is adjacent to mid-river (sentry radius 1) AND to the viewer => unfogged
    expect('fogged' in enemy).toBe(false)
    expect((enemy as PlayerState).hp).toBe(277)
  })
})

describe('systems-gaps: echo talents — dead specialEffect no-ops swapped for working effects', () => {
  it('echo_25_right now grants +250 HP (was the dead "Double Echo" specialEffect)', () => {
    const player = makePlayer({
      heroId: 'echo',
      talents: { tier10: null, tier15: null, tier20: null, tier25: 'echo_25_right' },
    })
    expect(getTalentStatBonus(player, 'hp')).toBe(250)
  })

  it('no echo talent is a dead specialEffect no-op anymore', () => {
    for (const t of Object.values(TALENT_TREES.echo.tiers).flat()) {
      expect(t.type).not.toBe('special')
      expect((t as { specialEffect?: string }).specialEffect).toBeUndefined()
    }
  })
})
