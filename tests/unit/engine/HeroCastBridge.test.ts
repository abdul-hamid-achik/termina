/**
 * Tests for the live hero-ability path: the ActionResolver cast bridge
 * (resolveHeroCast -> _base.resolveAbility -> per-hero resolvers), the
 * passive hook (GameLoop.runHeroPassives), effective stats, talents, and
 * the engine-consumed buff/debuff mechanics (shield, slow, dot, teleport,
 * execute, reveal, taunt/fear, ability-level scaling, R gating).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Effect } from 'effect'
import {
  resolveActions,
  validateAction,
  type PlayerAction,
} from '../../../server/game/engine/ActionResolver'
import { processTick, submitAction } from '../../../server/game/engine/GameLoop'
import { processDoTs, resolveAbility, getBuffStacks } from '../../../server/game/heroes'
import {
  getEffectiveAttack,
  getEffectiveDefense,
  getTalentStatBonus,
} from '../../../server/game/engine/EffectiveStats'
import { filterStateForPlayer } from '../../../server/game/engine/VisionCalculator'
import type { GameState, PlayerState } from '../../../shared/types/game'
import { HEROES } from '../../../shared/constants/heroes'
import { initializeZoneStates, initializeTowers } from '../../../server/game/map/zones'
import { initializeRoshan } from '../../../server/game/map/spawner'
import { initializeAncients } from '../../../server/game/engine/AncientSystem'

function statsAtLevel(heroId: string, level: number) {
  const hero = HEROES[heroId]!
  const lvl = level - 1
  return {
    maxHp: hero.baseStats.hp + (hero.growthPerLevel.hp ?? 0) * lvl,
    maxMp: hero.baseStats.mp + (hero.growthPerLevel.mp ?? 0) * lvl,
    defense: hero.baseStats.defense + (hero.growthPerLevel.defense ?? 0) * lvl,
    magicResist: hero.baseStats.magicResist + (hero.growthPerLevel.magicResist ?? 0) * lvl,
  }
}

/** Player whose hp/mp pools match the hero's stats so the per-tick
 * maxHp/maxMp recalculation doesn't shift values mid-test. */
function makeHero(heroId: string, overrides: Partial<PlayerState> = {}, level = 1): PlayerState {
  const s = statsAtLevel(heroId, level)
  return {
    id: 'p1',
    name: 'Player1',
    team: 'radiant',
    heroId,
    zone: 'mid-river',
    hp: s.maxHp,
    maxHp: s.maxHp,
    mp: s.maxMp,
    maxMp: s.maxMp,
    level,
    xp: 0,
    gold: 600,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnTick: null,
    defense: s.defense,
    magicResist: s.magicResist,
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
    timeOfDay: 'day',
    dayNightTick: 0,
    ...overrides,
  }
}

function run(state: GameState, actions: PlayerAction[]) {
  return Effect.runSync(resolveActions(state, actions))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('hero cast bridge (resolveActions -> registry resolvers)', () => {
  it('cast q emits a legacy-shape damage event and reduces target hp', () => {
    const state = makeGameState({
      players: {
        p1: makeHero('mutex', { id: 'p1', team: 'radiant' }),
        p2: makeHero('echo', { id: 'p2', name: 'Enemy', team: 'dire' }),
      },
    })
    const preHp = state.players['p2']!.hp

    const result = run(state, [
      {
        playerId: 'p1',
        command: { type: 'cast', ability: 'q', target: { kind: 'hero', name: 'p2' } },
      },
    ])

    expect(result.rejected).toHaveLength(0)
    const postHp = result.state.players['p2']!.hp
    expect(postHp).toBeLessThan(preHp)

    const dmg = result.events.filter((e) => e._tag === 'damage')
    expect(dmg).toHaveLength(1)
    expect(dmg[0]).toMatchObject({
      _tag: 'damage',
      sourceId: 'p1',
      targetId: 'p2',
      amount: preHp - postHp,
      damageType: 'physical',
    })
    // Root rider landed alongside the damage
    expect(result.state.players['p2']!.buffs.some((b) => b.id === 'root')).toBe(true)
    // heroAttackers feeds tower aggro
    expect(result.heroAttackers.get('p1')).toBe('p2')
    // Resolver-set cooldown carried on the events (not shared-constants value)
    const used = result.events.find((e) => e._tag === 'ability_used')
    expect(used).toMatchObject({ playerId: 'p1', abilityId: 'mutex-q', targetId: 'p2' })
    const cd = result.events.find((e) => e._tag === 'cooldown_used')
    expect(cd).toMatchObject({ abilityId: 'q', cooldownTicks: 8 })
  })

  it('buff honors the resolver effect value (mutex W shield stacks = 180 at rank 1)', () => {
    const state = makeGameState({
      players: { p1: makeHero('mutex', { id: 'p1' }) },
    })
    const result = run(state, [{ playerId: 'p1', command: { type: 'cast', ability: 'w' } }])

    expect(result.rejected).toHaveLength(0)
    const p1 = result.state.players['p1']!
    const shield = p1.buffs.find((b) => b.id === 'shield')
    expect(shield?.stacks).toBe(180) // not the generic loop's hardcoded 1
    expect(p1.buffs.find((b) => b.id === 'criticalSectionDefense')?.stacks).toBe(10)
    expect(p1.buffs.some((b) => b.id === 'root')).toBe(true)
  })

  it('ability values scale with player level (rank derived at cast time)', () => {
    const cast = (level: number) => {
      const state = makeGameState({
        players: {
          p1: makeHero('mutex', { id: 'p1' }, level),
          p2: makeHero('echo', { id: 'p2', name: 'Enemy', team: 'dire' }),
        },
      })
      const pre = state.players['p2']!.hp
      const result = run(state, [
        {
          playerId: 'p1',
          command: { type: 'cast', ability: 'q', target: { kind: 'hero', name: 'p2' } },
        },
      ])
      return pre - result.state.players['p2']!.hp
    }

    const rank1 = cast(1)
    const rank4 = cast(7)
    expect(rank1).toBeGreaterThan(0)
    expect(rank4).toBeGreaterThan(rank1)
  })

  it('rejects R below level 6 with feedback and resolves it at level 6', () => {
    const atLevel5 = makeGameState({
      players: { p1: makeHero('mutex', { id: 'p1' }, 5) },
    })
    expect(
      validateAction(atLevel5, { playerId: 'p1', command: { type: 'cast', ability: 'r' } }),
    ).toBe('Ultimate unlocks at level 6')

    const atLevel1 = makeGameState({
      players: { p1: makeHero('mutex', { id: 'p1' }, 1) },
    })
    expect(
      validateAction(atLevel1, { playerId: 'p1', command: { type: 'cast', ability: 'w' } }),
    ).toBeNull()

    const atLevel6 = makeGameState({
      players: {
        p1: makeHero('mutex', { id: 'p1' }, 6),
        p2: makeHero('echo', { id: 'p2', name: 'Enemy', team: 'dire' }),
      },
    })
    expect(
      validateAction(atLevel6, { playerId: 'p1', command: { type: 'cast', ability: 'r' } }),
    ).toBeNull()
    const preHp = atLevel6.players['p2']!.hp
    const result = run(atLevel6, [{ playerId: 'p1', command: { type: 'cast', ability: 'r' } }])
    expect(result.rejected).toHaveLength(0)
    expect(result.state.players['p2']!.hp).toBeLessThan(preHp)
    // Fear rider applied — and fear blocks attack/cast via validateAction
    expect(result.state.players['p2']!.buffs.some((b) => b.id === 'feared')).toBe(true)
  })

  it('surfaces resolver target errors through the rejected channel', () => {
    const state = makeGameState({
      players: { p1: makeHero('mutex', { id: 'p1' }) },
    })
    // mutex q requires a hero target
    const result = run(state, [{ playerId: 'p1', command: { type: 'cast', ability: 'q' } }])
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0]!.reason).toMatch(/hero target/i)
    // Nothing was spent
    expect(result.state.players['p1']!.mp).toBe(state.players['p1']!.mp)
    expect(result.state.players['p1']!.cooldowns.q).toBe(0)
  })

  it('applies a DoT that ticks via processDoTs with kill-credit damage events', () => {
    const state = makeGameState({
      players: {
        p1: makeHero('daemon', { id: 'p1' }),
        p2: makeHero('echo', { id: 'p2', name: 'Enemy', team: 'dire' }),
      },
    })
    const result = run(state, [
      {
        playerId: 'p1',
        command: { type: 'cast', ability: 'q', target: { kind: 'hero', name: 'p2' } },
      },
    ])
    expect(result.rejected).toHaveLength(0)
    const dot = result.state.players['p2']!.buffs.find((b) => b.id === 'inject_dot')
    expect(dot).toBeDefined()
    expect(dot!.stacks).toBeGreaterThan(0)
    expect(dot!.source).toBe('p1')
    // Cast tick itself deals no direct damage
    const preHp = result.state.players['p2']!.hp

    const ticked = processDoTs(result.state)
    expect(ticked.state.players['p2']!.hp).toBeLessThan(preHp)
    const dmg = ticked.events.filter((e) => e._tag === 'damage')
    expect(dmg).toHaveLength(1)
    expect(dmg[0]).toMatchObject({ sourceId: 'p1', targetId: 'p2', damageType: 'magical' })
  })

  it('teleports the caster directly on a zone-target ultimate (daemon R)', () => {
    const state = makeGameState({
      players: { p1: makeHero('daemon', { id: 'p1', zone: 'mid-river' }, 6) },
    })
    const result = run(state, [
      {
        playerId: 'p1',
        command: { type: 'cast', ability: 'r', target: { kind: 'zone', zone: 'dire-base' } },
      },
    ])
    expect(result.rejected).toHaveLength(0)
    expect(result.state.players['p1']!.zone).toBe('dire-base')
  })

  it('execute (daemon E) kills below the HP threshold and refuses above it', () => {
    const daemon = statsAtLevel('daemon', 1)
    const echo = statsAtLevel('echo', 1)

    const lowHp = makeGameState({
      players: {
        p1: makeHero('daemon', { id: 'p1' }),
        p2: makeHero('echo', {
          id: 'p2',
          name: 'Enemy',
          team: 'dire',
          hp: Math.floor(echo.maxHp * 0.2),
        }),
      },
    })
    const killed = run(lowHp, [
      {
        playerId: 'p1',
        command: { type: 'cast', ability: 'e', target: { kind: 'hero', name: 'p2' } },
      },
    ])
    expect(killed.state.players['p2']!.hp).toBe(0)
    expect(killed.state.players['p2']!.alive).toBe(false)
    // Mana was spent on the successful execute
    expect(killed.state.players['p1']!.mp).toBeLessThan(daemon.maxMp)

    const highHp = makeGameState({
      players: {
        p1: makeHero('daemon', { id: 'p1' }),
        p2: makeHero('echo', {
          id: 'p2',
          name: 'Enemy',
          team: 'dire',
          hp: Math.floor(echo.maxHp * 0.9),
        }),
      },
    })
    const refused = run(highHp, [
      {
        playerId: 'p1',
        command: { type: 'cast', ability: 'e', target: { kind: 'hero', name: 'p2' } },
      },
    ])
    expect(refused.state.players['p2']!.alive).toBe(true)
    expect(refused.state.players['p2']!.hp).toBe(Math.floor(echo.maxHp * 0.9))
    // Above threshold: mana refunded, no cooldown
    expect(refused.state.players['p1']!.mp).toBe(daemon.maxMp)
    expect(refused.state.players['p1']!.cooldowns.e).toBe(0)
  })
})

describe('basic-attack path: shield, phase shift, fear', () => {
  it('shield buff stacks absorb basic-attack HP loss', () => {
    const echo = statsAtLevel('echo', 1)
    const state = makeGameState({
      players: {
        p1: makeHero('echo', { id: 'p1' }),
        p2: makeHero('echo', {
          id: 'p2',
          name: 'Enemy',
          team: 'dire',
          buffs: [{ id: 'shield', stacks: 500, ticksRemaining: 3, source: 'ally' }],
        }),
      },
    })
    const result = run(state, [
      { playerId: 'p1', command: { type: 'attack', target: { kind: 'hero', name: 'Enemy' } } },
    ])
    const p2 = result.state.players['p2']!
    expect(p2.hp).toBe(echo.maxHp) // fully absorbed
    const shield = p2.buffs.find((b) => b.id === 'shield')
    expect(shield).toBeDefined()
    expect(shield!.stacks).toBeLessThan(500)
    // Damage event keeps the pre-shield amount so absorbed hits still grant
    // assist credit
    const dmg = result.events.find(
      (e) => e._tag === 'damage' && e.targetId === 'p2' && e.damageType === 'physical',
    )
    expect(dmg).toBeDefined()
    expect(dmg!._tag === 'damage' && dmg!.amount).toBeGreaterThan(0)
    expect(500 - shield!.stacks).toBeGreaterThan(0)
  })

  it('phaseShift dodges one basic attack and is consumed', () => {
    const echo = statsAtLevel('echo', 1)
    const state = makeGameState({
      players: {
        p1: makeHero('echo', { id: 'p1' }),
        p2: makeHero('echo', {
          id: 'p2',
          name: 'Enemy',
          team: 'dire',
          buffs: [{ id: 'phaseShift', stacks: 1, ticksRemaining: 2, source: 'p2' }],
        }),
      },
    })
    const result = run(state, [
      { playerId: 'p1', command: { type: 'attack', target: { kind: 'hero', name: 'Enemy' } } },
    ])
    const p2 = result.state.players['p2']!
    expect(p2.hp).toBe(echo.maxHp)
    expect(p2.buffs.some((b) => b.id === 'phaseShift')).toBe(false)
  })

  it('fear blocks attack and cast; taunt blocks move and cast', () => {
    const feared = makeGameState({
      players: {
        p1: makeHero('echo', {
          id: 'p1',
          zone: 'mid-river',
          buffs: [{ id: 'feared', stacks: 1, ticksRemaining: 2, source: 'e1' }],
        }),
      },
    })
    expect(
      validateAction(feared, {
        playerId: 'p1',
        command: { type: 'attack', target: { kind: 'hero', name: 'x' } },
      }),
    ).toBe('Cannot attack while feared')
    expect(
      validateAction(feared, { playerId: 'p1', command: { type: 'cast', ability: 'q' } }),
    ).toBe('Cannot cast while feared')
    // Fear allows fleeing
    expect(
      validateAction(feared, { playerId: 'p1', command: { type: 'move', zone: 'mid-t1-rad' } }),
    ).toBeNull()

    const taunted = makeGameState({
      players: {
        p1: makeHero('echo', {
          id: 'p1',
          zone: 'mid-river',
          buffs: [{ id: 'taunt', stacks: 1, ticksRemaining: 2, source: 'e1' }],
        }),
      },
    })
    expect(
      validateAction(taunted, { playerId: 'p1', command: { type: 'move', zone: 'mid-t1-rad' } }),
    ).toBe('Cannot move while taunted')
    expect(
      validateAction(taunted, { playerId: 'p1', command: { type: 'cast', ability: 'q' } }),
    ).toBe('Cannot cast while taunted')
    // Taunt still allows attacking
    expect(
      validateAction(taunted, {
        playerId: 'p1',
        command: { type: 'attack', target: { kind: 'hero', name: 'x' } },
      }),
    ).toBeNull()
  })
})

describe('slow mechanic (move-fail chance)', () => {
  it('cancels a move when the slow roll hits, with player feedback', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const state = makeGameState({
      players: {
        p1: makeHero('echo', {
          id: 'p1',
          zone: 'mid-river',
          buffs: [{ id: 'slow', stacks: 30, ticksRemaining: 2, source: 'e1' }],
        }),
      },
    })
    const result = run(state, [{ playerId: 'p1', command: { type: 'move', zone: 'mid-t1-rad' } }])
    expect(result.state.players['p1']!.zone).toBe('mid-river')
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0]!.reason).toMatch(/slow/i)
  })

  it('lets the move through when the slow roll misses', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const state = makeGameState({
      players: {
        p1: makeHero('echo', {
          id: 'p1',
          zone: 'mid-river',
          buffs: [{ id: 'slow', stacks: 30, ticksRemaining: 2, source: 'e1' }],
        }),
      },
    })
    const result = run(state, [{ playerId: 'p1', command: { type: 'move', zone: 'mid-t1-rad' } }])
    expect(result.state.players['p1']!.zone).toBe('mid-t1-rad')
    expect(result.rejected).toHaveLength(0)
  })
})

describe('reveal and stealth vision wiring', () => {
  it('stealth hides an enemy from view (fogged) without true sight', () => {
    const state = makeGameState({
      players: {
        viewer: makeHero('echo', { id: 'viewer', zone: 'mid-river' }),
        enemy: makeHero('daemon', {
          id: 'enemy',
          name: 'Sneak',
          team: 'dire',
          zone: 'mid-river',
          buffs: [{ id: 'stealth', stacks: 1, ticksRemaining: 5, source: 'enemy' }],
        }),
      },
    })
    const view = filterStateForPlayer(state, 'viewer')
    const seen = view.players['enemy']!
    expect('fogged' in seen && seen.fogged).toBe(true)
  })

  it("a 'revealed' buff from the viewer's team pierces stealth and fog", () => {
    const state = makeGameState({
      players: {
        viewer: makeHero('echo', { id: 'viewer', zone: 'mid-river' }),
        enemy: makeHero('daemon', {
          id: 'enemy',
          name: 'Sneak',
          team: 'dire',
          zone: 'dire-base', // not normally visible from mid-river
          buffs: [
            { id: 'stealth', stacks: 1, ticksRemaining: 5, source: 'enemy' },
            { id: 'revealed', stacks: 1, ticksRemaining: 3, source: 'viewer' },
          ],
        }),
      },
    })
    const view = filterStateForPlayer(state, 'viewer')
    const seen = view.players['enemy']!
    expect('fogged' in seen).toBe(false)
    expect(view.visibleZones).toContain('dire-base')
  })

  it("an enemy-sourced 'revealed' buff does not reveal to this viewer", () => {
    const state = makeGameState({
      players: {
        viewer: makeHero('echo', { id: 'viewer', zone: 'mid-river' }),
        ally2: makeHero('cron', { id: 'ally2', name: 'DireAlly', team: 'dire', zone: 'top-river' }),
        enemy: makeHero('daemon', {
          id: 'enemy',
          name: 'Sneak',
          team: 'dire',
          zone: 'dire-base',
          buffs: [{ id: 'revealed', stacks: 1, ticksRemaining: 3, source: 'ally2' }],
        }),
      },
    })
    const view = filterStateForPlayer(state, 'viewer')
    const seen = view.players['enemy']!
    expect('fogged' in seen && seen.fogged).toBe(true)
  })
})

describe('passive hook (processTick step 11.5)', () => {
  it('mutex deadlock stacks accrue across ticks while standing still', () => {
    const gameId = `passive_test_${Math.random().toString(36).slice(2, 8)}`
    let state = makeGameState({
      players: { p1: makeHero('mutex', { id: 'p1', zone: 'mid-river' }) },
    })

    // Tick 1: tick_end sets the zone tracker
    state = Effect.runSync(processTick(gameId, state)).state
    // Tick 2: still in the same zone — first deadlock stack
    state = Effect.runSync(processTick(gameId, state)).state
    const stacksAfter2 = getBuffStacks(state.players['p1']!, 'deadlock')
    expect(stacksAfter2).toBe(1)

    // Tick 3: second stack
    state = Effect.runSync(processTick(gameId, state)).state
    expect(getBuffStacks(state.players['p1']!, 'deadlock')).toBe(2)

    // Moving resets the stacks (move event from the zone diff)
    submitAction(gameId, 'p1', { type: 'move', zone: 'mid-t1-rad' })
    state = Effect.runSync(processTick(gameId, state)).state
    expect(state.players['p1']!.zone).toBe('mid-t1-rad')
    expect(getBuffStacks(state.players['p1']!, 'deadlock')).toBe(0)
  })

  it('deadlock stacks raise effective attack and defense', () => {
    const plain = makeHero('mutex', { id: 'p1' })
    const stacked = makeHero('mutex', {
      id: 'p1',
      buffs: [{ id: 'deadlock', stacks: 3, ticksRemaining: 9999, source: 'p1' }],
    })
    expect(getEffectiveAttack(stacked)).toBe(getEffectiveAttack(plain) + 9) // +3 per stack
    expect(getEffectiveDefense(stacked)).toBe(getEffectiveDefense(plain) + 3) // +1 per stack
  })
})

describe('talents', () => {
  it('a selected +attack stat talent raises effective attack', () => {
    const plain = makeHero('echo', { id: 'p1' })
    const talented = makeHero('echo', {
      id: 'p1',
      talents: { tier10: 'echo_10_left', tier15: null, tier20: null, tier25: null },
    })
    expect(getTalentStatBonus(talented, 'attack')).toBe(15)
    expect(getEffectiveAttack(talented)).toBe(getEffectiveAttack(plain) + 15)
  })

  it('a selected +HP talent raises maxHp through the per-tick recalc', () => {
    const echo = statsAtLevel('echo', 1)
    const state = makeGameState({
      players: {
        p1: makeHero('echo', {
          id: 'p1',
          talents: { tier10: 'echo_10_right', tier15: null, tier20: null, tier25: null },
        }),
      },
    })
    const result = run(state, [])
    expect(result.state.players['p1']!.maxHp).toBe(echo.maxHp + 200)
    // Current-HP-preserving: the talent grants +200 maxHp but does NOT heal —
    // the player stays at the HP they had (echo.maxHp), now 200 below the new
    // ceiling. Matches DotA (an HP talent doesn't refill the bar).
    expect(result.state.players['p1']!.hp).toBe(echo.maxHp)
  })

  it('a cooldownReduction ability talent shortens the resolver-set cooldown', () => {
    const state = makeGameState({
      players: {
        p1: makeHero('echo', {
          id: 'p1',
          talents: { tier10: null, tier15: 'echo_15_right', tier20: null, tier25: null },
        }),
      },
    })
    // echo W rank 1 cooldown is 12 ticks; talent removes 2
    const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))
    expect(result.state.players['p1']!.cooldowns.w).toBe(10)
  })

  it('a damageBoost ability talent amplifies the cast damage', () => {
    const castQ = (talents: PlayerState['talents']) => {
      const state = makeGameState({
        players: {
          p1: makeHero('mutex', { id: 'p1', talents }),
          p2: makeHero('echo', { id: 'p2', name: 'Enemy', team: 'dire' }),
        },
      })
      const pre = state.players['p2']!.hp
      const result = run(state, [
        {
          playerId: 'p1',
          command: { type: 'cast', ability: 'q', target: { kind: 'hero', name: 'p2' } },
        },
      ])
      return pre - result.state.players['p2']!.hp
    }

    const noTalent = castQ({ tier10: null, tier15: null, tier20: null, tier25: null })
    // mutex_15_left: +30% Lock (Q) damage (mutex's tailored tree)
    const boosted = castQ({ tier10: null, tier15: 'mutex_15_left', tier20: null, tier25: null })
    expect(boosted).toBe(noTalent + Math.round(noTalent * 0.3))
  })
})
