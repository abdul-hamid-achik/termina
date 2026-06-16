import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import { validateAction, type PlayerAction } from '~~/server/game/engine/ActionResolver'
import { resolveAbility } from '~~/server/game/heroes/_base'
import type { GameState, PlayerState, Buff } from '~~/shared/types/game'
import { initializeZoneStates, initializeTowers } from '~~/server/game/map/zones'
import { initializeRoshan } from '~~/server/game/map/spawner'
import { initializeAncients } from '~~/server/game/engine/AncientSystem'
// Register regex so its Q resolver runs for the talent mana-refund test.
import '~~/server/game/heroes/regex'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'Player1',
    team: 'radiant',
    heroId: 'regex',
    zone: 'mid-t1-rad',
    hp: 500,
    maxHp: 500,
    mp: 400,
    maxMp: 400,
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
    damageDealt: 0,
    towerDamageDealt: 0,
    killStreak: 0,
    buybackCost: 100,
    talents: { tier10: null, tier15: null, tier20: null, tier25: null },
    ...overrides,
  }
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    tick: 1,
    phase: 'playing',
    teams: {
      radiant: { id: 'radiant', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
      dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
    },
    players: {},
    zones: initializeZoneStates(),
    creeps: [],
    neutrals: [],
    towers: initializeTowers(),
    ancients: initializeAncients(),
    runes: [],
    roshan: initializeRoshan(),
    aegis: null,
    events: [],
    surrenderVotes: { radiant: new Set(), dire: new Set() },
    lastSeen: {},
    timeOfDay: 'day',
    dayNightTick: 0,
    ...overrides,
  }
}

function debuff(id: string): Buff {
  return { id, stacks: 1, ticksRemaining: 2, source: 'enemy' }
}

// A second hero in the same zone, so attack/cast have a legal hero target.
const enemyTarget = makePlayer({
  id: 'e1',
  name: 'Enemy',
  team: 'dire',
  heroId: 'echo',
  zone: 'mid-t1-rad',
})

const moveAction: PlayerAction = {
  playerId: 'p1',
  command: { type: 'move', zone: 'mid-t2-rad' },
}
const attackAction: PlayerAction = {
  playerId: 'p1',
  command: { type: 'attack', target: { kind: 'hero', name: 'e1' } },
}
const castAction: PlayerAction = {
  playerId: 'p1',
  command: { type: 'cast', ability: 'q', target: { kind: 'hero', name: 'e1' } },
}

describe('Disable enforcement (validateAction)', () => {
  describe('TAUNT — blocks move + cast, but NOT attack', () => {
    it('rejects move while taunted', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ buffs: [debuff('taunt')] }), e1: enemyTarget },
      })
      expect(validateAction(state, moveAction)).toBe('Cannot move while taunted')
    })

    it('rejects cast while taunted', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ buffs: [debuff('taunt')] }), e1: enemyTarget },
      })
      expect(validateAction(state, castAction)).toBe('Cannot cast while taunted')
    })

    it('ALLOWS attack while taunted (taunt forces attacking)', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ buffs: [debuff('taunt')] }), e1: enemyTarget },
      })
      expect(validateAction(state, attackAction)).toBeNull()
    })
  })

  describe('FEARED — blocks attack + cast, but NOT move', () => {
    it('rejects attack while feared', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ buffs: [debuff('feared')] }), e1: enemyTarget },
      })
      expect(validateAction(state, attackAction)).toBe('Cannot attack while feared')
    })

    it('rejects cast while feared', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ buffs: [debuff('feared')] }), e1: enemyTarget },
      })
      expect(validateAction(state, castAction)).toBe('Cannot cast while feared')
    })

    it('ALLOWS move while feared (fear makes you flee, not freeze)', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ buffs: [debuff('feared')] }), e1: enemyTarget },
      })
      expect(validateAction(state, moveAction)).toBeNull()
    })
  })

  describe('ROOT — blocks move only; attack + cast still allowed', () => {
    it('rejects move while rooted', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ buffs: [debuff('root')] }), e1: enemyTarget },
      })
      expect(validateAction(state, moveAction)).toBe('Cannot move while rooted or stunned')
    })

    it('ALLOWS attack while rooted', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ buffs: [debuff('root')] }), e1: enemyTarget },
      })
      expect(validateAction(state, attackAction)).toBeNull()
    })

    it('ALLOWS cast while rooted (socket Q point — root != silence)', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ buffs: [debuff('root')] }), e1: enemyTarget },
      })
      expect(validateAction(state, castAction)).toBeNull()
    })
  })
})

describe('Talent: manaCostReduction refunds mana on the boosted ability', () => {
  // regex_15_right: abilityId 'q', manaCostReduction 15.
  // Q costs 60 mana → resolver deducts 60 → talent refunds round(60*15/100)=9.
  // Net mp delta = -60 + 9 = -51.
  const Q_MANA = 60
  const REFUND = Math.round((Q_MANA * 15) / 100) // 9

  it('refunds exactly 15% of the mana spent on regex Q', () => {
    const startMp = 400
    const caster = makePlayer({
      mp: startMp,
      talents: { tier10: null, tier15: 'regex_15_right', tier20: null, tier25: null },
    })
    const enemy = makePlayer({
      id: 'e1',
      name: 'Enemy',
      team: 'dire',
      heroId: 'echo',
      zone: 'mid-t1-rad',
    })
    const state = makeGameState({ players: { p1: caster, e1: enemy } })

    const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

    expect(result.state.players['p1']!.mp).toBe(startMp - Q_MANA + REFUND)
  })

  it('does NOT refund when the talent is not selected (baseline)', () => {
    const startMp = 400
    const caster = makePlayer({ mp: startMp })
    const enemy = makePlayer({
      id: 'e1',
      name: 'Enemy',
      team: 'dire',
      heroId: 'echo',
      zone: 'mid-t1-rad',
    })
    const state = makeGameState({ players: { p1: caster, e1: enemy } })

    const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

    expect(result.state.players['p1']!.mp).toBe(startMp - Q_MANA)
  })

  it('refund nets exactly REFUND mana above the un-talented cast', () => {
    const startMp = 400
    const enemy = makePlayer({
      id: 'e1',
      name: 'Enemy',
      team: 'dire',
      heroId: 'echo',
      zone: 'mid-t1-rad',
    })

    const withTalent = makePlayer({
      mp: startMp,
      talents: { tier10: null, tier15: 'regex_15_right', tier20: null, tier25: null },
    })
    const without = makePlayer({ mp: startMp })

    const r1 = Effect.runSync(
      resolveAbility(makeGameState({ players: { p1: withTalent, e1: enemy } }), 'p1', 'q', {
        kind: 'hero',
        name: 'e1',
      }),
    )
    const r2 = Effect.runSync(
      resolveAbility(makeGameState({ players: { p1: without, e1: { ...enemy } } }), 'p1', 'q', {
        kind: 'hero',
        name: 'e1',
      }),
    )

    expect(r1.state.players['p1']!.mp - r2.state.players['p1']!.mp).toBe(REFUND)
  })
})

describe('Arcane rune refunds mana on cast (buff was applied but consumed nowhere)', () => {
  const Q_MANA = 60
  const ARCANE_REFUND = Math.round(Q_MANA * 0.4) // 24

  const cast = (casterOverrides = {}) => {
    const caster = makePlayer({ mp: 400, ...casterOverrides })
    const enemy = makePlayer({
      id: 'e1',
      name: 'Enemy',
      team: 'dire',
      heroId: 'echo',
      zone: 'mid-t1-rad',
    })
    const state = makeGameState({ players: { p1: caster, e1: enemy } })
    return Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))
  }

  it('refunds 40% of the mana spent on a cast', () => {
    const result = cast({
      buffs: [{ id: 'arcane', stacks: 1, ticksRemaining: 9999, source: 'rune_arcane' }],
    })
    expect(result.state.players['p1']!.mp).toBe(400 - Q_MANA + ARCANE_REFUND)
  })

  it('no refund without the arcane buff (baseline)', () => {
    expect(cast().state.players['p1']!.mp).toBe(400 - Q_MANA)
  })
})
