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
} from '~~/server/game/engine/ActionResolver'
import { processTick, submitAction } from '~~/server/game/engine/GameLoop'
import { processDoTs, resolveAbility, getBuffStacks } from '~~/server/game/heroes'
import {
  getEffectiveAttack,
  getEffectiveDefense,
  getTalentStatBonus,
  hasTalentCastEffect,
} from '~~/server/game/engine/EffectiveStats'
import { filterStateForPlayer } from '~~/server/game/engine/VisionCalculator'
import type { CreepState, GameState, PlayerState } from '~~/shared/types/game'
import { HEROES } from '~~/shared/constants/heroes'
import { initializeZoneStates, initializeTowers } from '~~/server/game/map/zones'
import { initializeRoshan } from '~~/server/game/map/spawner'
import { initializeAncients } from '~~/server/game/engine/AncientSystem'

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
    team: 'chaff',
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
      chaff: { id: 'chaff', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
      audit: { id: 'audit', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
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
    surrenderVotes: { chaff: new Set(), audit: new Set() },
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
        p1: makeHero('mutex', { id: 'p1', team: 'chaff' }),
        p2: makeHero('echo', { id: 'p2', name: 'Enemy', team: 'audit' }),
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

  it('the cast is emitted BEFORE the damage it causes (cause, then effect)', () => {
    // The feed orders a tick by salience and falls back to emission order, so
    // appending ability_used last printed "you took 106" above "Mutex cast
    // Priority Inversion on you". The push is spliced back to the cast's start.
    const state = makeGameState({
      players: {
        p1: makeHero('mutex', { id: 'p1', team: 'chaff' }),
        p2: makeHero('echo', { id: 'p2', name: 'Enemy', team: 'audit' }),
      },
    })

    const result = run(state, [
      {
        playerId: 'p1',
        command: { type: 'cast', ability: 'q', target: { kind: 'hero', name: 'p2' } },
      },
    ])

    const castIdx = result.events.findIndex((e) => e._tag === 'ability_used')
    const dmgIdx = result.events.findIndex((e) => e._tag === 'damage')
    expect(castIdx).toBeGreaterThanOrEqual(0)
    expect(dmgIdx).toBeGreaterThanOrEqual(0)
    expect(castIdx).toBeLessThan(dmgIdx)
  })

  it('a disable rider emits status_applied with the engine’s real duration', () => {
    // Hero resolvers return rich effect payloads that the bridge discards
    // verbatim, so crowd control — the core of a teamfight — was completely
    // un-narrated. Recovered by diffing the target's buffs across the cast.
    const state = makeGameState({
      players: {
        p1: makeHero('mutex', { id: 'p1', team: 'chaff' }),
        p2: makeHero('echo', { id: 'p2', name: 'Enemy', team: 'audit' }),
      },
    })

    const result = run(state, [
      {
        playerId: 'p1',
        command: { type: 'cast', ability: 'q', target: { kind: 'hero', name: 'p2' } },
      },
    ])

    const root = result.state.players['p2']!.buffs.find((b) => b.id === 'root')!
    const status = result.events.filter((e) => e._tag === 'status_applied')
    expect(status).toHaveLength(1)
    expect(status[0]).toMatchObject({
      sourceId: 'p1',
      targetId: 'p2',
      status: 'root',
      // The advertised duration is not the applied one — report what the engine
      // actually wrote, so "(2t)" in the log is a number the player can trust.
      ticksRemaining: root.ticksRemaining,
    })
  })

  it('does not re-announce a disable the target already had', () => {
    const state = makeGameState({
      players: {
        p1: makeHero('mutex', { id: 'p1', team: 'chaff' }),
        p2: makeHero('echo', {
          id: 'p2',
          name: 'Enemy',
          team: 'audit',
          buffs: [{ id: 'root', stacks: 1, ticksRemaining: 3, source: 'someone' }],
        }),
      },
    })

    const result = run(state, [
      {
        playerId: 'p1',
        command: { type: 'cast', ability: 'q', target: { kind: 'hero', name: 'p2' } },
      },
    ])

    expect(result.events.filter((e) => e._tag === 'status_applied')).toHaveLength(0)
  })

  describe('tier-25 exotic: double cast', () => {
    it('hasTalentCastEffect detects the talent and respects the ability slot', () => {
      const talented = makeHero('echo', {
        talents: { tier10: null, tier15: null, tier20: null, tier25: 'echo_25_left' },
      })
      const untalented = makeHero('echo')
      expect(hasTalentCastEffect(talented, 'double_cast', 'q')).toBe(true)
      // echo_25_left is bound to Q — it must not apply to other slots.
      expect(hasTalentCastEffect(talented, 'double_cast', 'w')).toBe(false)
      expect(hasTalentCastEffect(untalented, 'double_cast', 'q')).toBe(false)
    })

    it('procs a second cast (more damage) when the chance hits', () => {
      const caster = () =>
        makeHero('echo', {
          id: 'p1',
          team: 'chaff',
          level: 5,
          mp: 2000,
          maxMp: 2000,
          talents: { tier10: null, tier15: null, tier20: null, tier25: 'echo_25_left' },
        })
      const target = () => makeHero('mutex', { id: 'p2', name: 'Enemy', team: 'audit' })
      const castQ: PlayerAction[] = [
        {
          playerId: 'p1',
          command: { type: 'cast', ability: 'q', target: { kind: 'hero', name: 'p2' } },
        },
      ]
      const damageTo = (events: { _tag: string; targetId?: string; amount?: number }[]) =>
        events
          .filter((e) => e._tag === 'damage' && e.targetId === 'p2')
          .reduce((s, e) => s + (e.amount ?? 0), 0)

      // Chance misses (0.99 > 0.25) → single cast.
      vi.spyOn(Math, 'random').mockReturnValue(0.99)
      const single = run(makeGameState({ players: { p1: caster(), p2: target() } }), castQ)
      const singleTotal = damageTo(single.events)

      // Chance hits (0 < 0.25) → the ability fires twice.
      vi.spyOn(Math, 'random').mockReturnValue(0)
      const double = run(makeGameState({ players: { p1: caster(), p2: target() } }), castQ)
      const doubleTotal = damageTo(double.events)

      expect(singleTotal).toBeGreaterThan(0)
      expect(doubleTotal).toBeGreaterThan(singleTotal)
    })
  })

  describe('tier-25 exotic: spell lifesteal', () => {
    // Daemon's E (Sudo) is an execute that only lands below 30% HP, so the
    // target starts low. We compare the caster's HP with vs without the talent
    // (rather than an absolute value) so the assertion is robust to any other
    // HP changes in the tick.
    const target = () =>
      makeHero('mutex', { id: 'p2', name: 'Enemy', team: 'audit', hp: 100, maxHp: 1000 })
    const castE: PlayerAction[] = [
      {
        playerId: 'p1',
        command: { type: 'cast', ability: 'e', target: { kind: 'hero', name: 'p2' } },
      },
    ]
    const daemon = (talent25: string | null) =>
      makeHero('daemon', {
        id: 'p1',
        team: 'chaff',
        level: 5,
        hp: 200,
        maxHp: 1000,
        mp: 2000,
        maxMp: 2000,
        talents: { tier10: null, tier15: null, tier20: null, tier25: talent25 },
      })

    it('heals the caster for a fraction of ability damage dealt to enemy heroes', () => {
      const result = run(
        makeGameState({ players: { p1: daemon('daemon_25_right'), p2: target() } }),
        castE,
      )
      const heal = result.events.find((e) => e._tag === 'heal' && e.targetId === 'p1')
      expect(heal).toBeDefined()
      expect((heal as { amount?: number }).amount).toBeGreaterThan(0)
    })

    it('ends with more HP than an identical cast without the talent', () => {
      const withTalent = run(
        makeGameState({ players: { p1: daemon('daemon_25_right'), p2: target() } }),
        castE,
      )
      const without = run(makeGameState({ players: { p1: daemon(null), p2: target() } }), castE)
      expect(withTalent.state.players['p1']!.hp).toBeGreaterThan(without.state.players['p1']!.hp)
    })
  })

  describe('tier-25 exotic: global ultimate', () => {
    // regex's R (Catastrophic Backtracking) is a single-target ability with a
    // same-zone check — a clean target for the global_ultimate exotic.
    const regexCaster = (talent25: string | null) =>
      makeHero('regex', {
        id: 'p1',
        team: 'chaff',
        level: 6,
        zone: 'mid-river',
        mp: 2000,
        maxMp: 2000,
        talents: { tier10: null, tier15: null, tier20: null, tier25: talent25 },
      })
    // Target in a DIFFERENT zone than the caster.
    const distantTarget = () =>
      makeHero('mutex', {
        id: 'p2',
        name: 'Enemy',
        team: 'audit',
        zone: 'top-river',
        mp: 100,
        maxMp: 500,
      })
    const castR: PlayerAction[] = [
      {
        playerId: 'p1',
        command: { type: 'cast', ability: 'r', target: { kind: 'hero', name: 'p2' } },
      },
    ]

    it('lets the talented R hit a hero in another zone', () => {
      const result = run(
        makeGameState({ players: { p1: regexCaster('regex_25_right'), p2: distantTarget() } }),
        castR,
      )
      expect(result.rejected).toHaveLength(0)
    })

    it('still rejects an out-of-zone R without the talent', () => {
      const result = run(
        makeGameState({ players: { p1: regexCaster(null), p2: distantTarget() } }),
        castR,
      )
      expect(result.rejected.length).toBeGreaterThan(0)
      expect(result.rejected[0]!.reason).toMatch(/zone/i)
    })

    it('does not move the caster (zone restored after the global cast)', () => {
      const result = run(
        makeGameState({ players: { p1: regexCaster('regex_25_right'), p2: distantTarget() } }),
        castR,
      )
      expect(result.state.players['p1']!.zone).toBe('mid-river')
    })
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
          p2: makeHero('echo', { id: 'p2', name: 'Enemy', team: 'audit' }),
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
        p2: makeHero('echo', { id: 'p2', name: 'Enemy', team: 'audit' }),
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
        p2: makeHero('echo', { id: 'p2', name: 'Enemy', team: 'audit' }),
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
        command: { type: 'cast', ability: 'r', target: { kind: 'zone', zone: 'audit-base' } },
      },
    ])
    expect(result.rejected).toHaveLength(0)
    expect(result.state.players['p1']!.zone).toBe('audit-base')
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
          team: 'audit',
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
          team: 'audit',
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

/**
 * Abilities reaching lane creeps and neutrals. Before this the bridge returned
 * only `{ players, zones }`, so a resolver could damage a creep all it liked and
 * the result was thrown away on the way out — in lane with a wave in front of
 * you and no enemy hero present, every AoE was dead weight.
 */
describe('cast bridge: abilities vs creeps and neutrals', () => {
  const LANE = 'mid-t1-chaff'

  function creep(over: Partial<CreepState> = {}): CreepState {
    return { id: 'c1', team: 'audit', zone: LANE, hp: 400, maxHp: 400, type: 'melee', ...over }
  }

  it('a zone AoE cast damages enemy creeps standing in the zone', () => {
    // mutex E (Spinlock) at rank 1: three 40-damage hits.
    const state = makeGameState({
      players: { p1: makeHero('mutex', { id: 'p1', zone: LANE }) },
      creeps: [creep()],
    })

    const result = run(state, [{ playerId: 'p1', command: { type: 'cast', ability: 'e' } }])

    expect(result.rejected).toHaveLength(0)
    expect(result.state.creeps[0]!.hp).toBe(280)
    expect(result.events).toContainEqual(
      expect.objectContaining({ _tag: 'damage', sourceId: 'p1', targetId: 'c1', amount: 120 }),
    )
  })

  it('spares your own creeps and the wave one zone over', () => {
    const state = makeGameState({
      players: { p1: makeHero('mutex', { id: 'p1', zone: LANE }) },
      creeps: [
        creep({ id: 'mine', team: 'chaff' }),
        creep({ id: 'theirs-elsewhere', zone: 'mid-river' }),
      ],
    })

    const result = run(state, [{ playerId: 'p1', command: { type: 'cast', ability: 'e' } }])

    expect(result.state.creeps.map((c) => c.hp)).toEqual([400, 400])
    expect(result.events.some((e) => e._tag === 'damage')).toBe(false)
  })

  it('an ability last hit pays the creep bounty through the same path a right-click does', () => {
    const state = makeGameState({
      players: { p1: makeHero('mutex', { id: 'p1', zone: LANE }) },
      creeps: [creep({ hp: 30 })],
    })
    const goldBefore = state.players['p1']!.gold

    const result = run(state, [{ playerId: 'p1', command: { type: 'cast', ability: 'e' } }])

    expect(result.state.creeps[0]!.hp).toBe(0)
    const lastHit = result.events.find((e) => e._tag === 'creep_lasthit')
    expect(lastHit).toMatchObject({ playerId: 'p1', creepId: 'c1', creepType: 'melee' })
    expect(result.state.players['p1']!.gold).toBeGreaterThan(goldBefore)
    expect(result.state.players['p1']!.xp).toBeGreaterThan(0)
  })

  it('shares the lane XP on an ability kill, exactly as a last-hit does', () => {
    const state = makeGameState({
      players: {
        p1: makeHero('mutex', { id: 'p1', zone: LANE }),
        p2: makeHero('kernel', { id: 'p2', name: 'Mate', zone: LANE }),
      },
      creeps: [creep({ hp: 30 })],
    })

    const result = run(state, [{ playerId: 'p1', command: { type: 'cast', ability: 'e' } }])

    const mine = result.state.players['p1']!.xp
    const mates = result.state.players['p2']!.xp
    expect(mates).toBeGreaterThan(0)
    // The caster still keeps strictly more, or securing the kill stops mattering.
    expect(mates).toBeLessThan(mine)
  })

  it('scales with the ability rank: the rank-1 ult chips the wave, the rank-3 ult clears it', () => {
    // null_ref R (Dereference) is 240 / 360 / 480 at ranks 1-3, unlocked at
    // levels 6 / 12 / 18. Every other fixture in this file sits at level 1 or 6,
    // where a flat-damage implementation is indistinguishable from a scaled one.
    const wave = () => [creep({ hp: 300 })]
    const atRank1 = makeGameState({
      players: { p1: makeHero('null_ref', { id: 'p1', zone: LANE }, 6) },
      creeps: wave(),
    })
    const atRank3 = makeGameState({
      players: { p1: makeHero('null_ref', { id: 'p1', zone: LANE }, 18) },
      creeps: wave(),
    })
    const cast = { type: 'cast', ability: 'r' } as const

    const chipped = run(atRank1, [{ playerId: 'p1', command: cast }])
    expect(chipped.rejected).toHaveLength(0)
    expect(chipped.state.creeps[0]!.hp).toBe(60)
    expect(chipped.events.some((e) => e._tag === 'creep_lasthit')).toBe(false)

    const cleared = run(atRank3, [{ playerId: 'p1', command: cast }])
    expect(cleared.state.creeps[0]!.hp).toBe(0)
    expect(cleared.events.some((e) => e._tag === 'creep_lasthit')).toBe(true)
  })

  it('clears a jungle camp and pays the neutral bounty', () => {
    const camp = 'silt-chaff-top'
    const state = makeGameState({
      players: { p1: makeHero('mutex', { id: 'p1', zone: camp }) },
      neutrals: [{ id: 'n1', zone: camp, hp: 100, maxHp: 250, type: 'kobold', alive: true }],
    })
    const goldBefore = state.players['p1']!.gold

    const result = run(state, [{ playerId: 'p1', command: { type: 'cast', ability: 'e' } }])

    expect(result.events).toContainEqual(
      expect.objectContaining({ _tag: 'neutral_killed', playerId: 'p1', neutralId: 'n1' }),
    )
    expect(result.state.players['p1']!.gold).toBeGreaterThan(goldBefore)
    // The dead neutral is swept out of the board by the award pass.
    expect(result.state.neutrals).toHaveLength(0)
  })

  it('casts against the LIVE neutral buffer, not a stale copy from the tick start', () => {
    // REGRESSION: the bridge built its temp state from `state.neutrals`, so a
    // cast resolving after the attack phase handed the resolver a pre-attack
    // jungle — and the array it returned silently reverted every neutral the
    // attack phase had just damaged.
    const camp = 'silt-chaff-top'
    const state = makeGameState({
      players: {
        p1: makeHero('echo', { id: 'p1', name: 'Hitter', zone: camp }),
        p2: makeHero('mutex', { id: 'p2', name: 'Caster', zone: camp }),
      },
      neutrals: [
        { id: 'untouched', zone: camp, hp: 250, maxHp: 250, type: 'kobold', alive: true },
        { id: 'attacked', zone: camp, hp: 250, maxHp: 250, type: 'kobold', alive: true },
      ],
    })

    const result = run(state, [
      { playerId: 'p1', command: { type: 'attack', target: { kind: 'neutral', index: 1 } } },
      { playerId: 'p2', command: { type: 'cast', ability: 'e' } },
    ])

    expect(result.rejected).toHaveLength(0)
    const untouched = result.state.neutrals.find((n) => n.id === 'untouched')!
    const attacked = result.state.neutrals.find((n) => n.id === 'attacked')!
    // Only the cast reached the first camp member: 250 - (40 x 3).
    expect(untouched.hp).toBe(130)
    // The second took the cast AND the basic attack — the attack is not undone.
    expect(attacked.hp).toBeLessThan(untouched.hp)
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
          team: 'audit',
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
          team: 'audit',
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
      validateAction(feared, { playerId: 'p1', command: { type: 'move', zone: 'mid-t1-chaff' } }),
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
      validateAction(taunted, { playerId: 'p1', command: { type: 'move', zone: 'mid-t1-chaff' } }),
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

describe('slow mechanic (deterministic move-fail)', () => {
  it('cancels a move on a tick where the deterministic slow pattern blocks', () => {
    // Slow blocks when (tick * stacks) % 100 < stacks. At tick 4 with 30% slow:
    // (4*30)%100 = 20 < 30 → blocked. No RNG involved.
    const state = makeGameState({
      tick: 4,
      players: {
        p1: makeHero('echo', {
          id: 'p1',
          zone: 'mid-river',
          buffs: [{ id: 'slow', stacks: 30, ticksRemaining: 2, source: 'e1' }],
        }),
      },
    })
    const result = run(state, [{ playerId: 'p1', command: { type: 'move', zone: 'mid-t1-chaff' } }])
    expect(result.state.players['p1']!.zone).toBe('mid-river')
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0]!.reason).toMatch(/slow/i)
  })

  it('lets the move through on a tick where the pattern misses', () => {
    // At tick 1 with 30% slow: (1*30)%100 = 30, not < 30 → passes.
    const state = makeGameState({
      tick: 1,
      players: {
        p1: makeHero('echo', {
          id: 'p1',
          zone: 'mid-river',
          buffs: [{ id: 'slow', stacks: 30, ticksRemaining: 2, source: 'e1' }],
        }),
      },
    })
    const result = run(state, [{ playerId: 'p1', command: { type: 'move', zone: 'mid-t1-chaff' } }])
    expect(result.state.players['p1']!.zone).toBe('mid-t1-chaff')
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
          team: 'audit',
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
          team: 'audit',
          zone: 'audit-base', // not normally visible from mid-river
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
    expect(view.visibleZones).toContain('audit-base')
  })

  it("an enemy-sourced 'revealed' buff does not reveal to this viewer", () => {
    const state = makeGameState({
      players: {
        viewer: makeHero('echo', { id: 'viewer', zone: 'mid-river' }),
        ally2: makeHero('cron', {
          id: 'ally2',
          name: 'AuditAlly',
          team: 'audit',
          zone: 'top-river',
        }),
        enemy: makeHero('daemon', {
          id: 'enemy',
          name: 'Sneak',
          team: 'audit',
          zone: 'audit-base',
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
    submitAction(gameId, 'p1', { type: 'move', zone: 'mid-t1-chaff' })
    state = Effect.runSync(processTick(gameId, state)).state
    expect(state.players['p1']!.zone).toBe('mid-t1-chaff')
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
    // Percentage-preserving: the per-tick recalc scales current HP to the same %
    // of the new max for ANY max change. This hero was at full HP, so it stays
    // full when the talent raises the ceiling — the same rule that scales current
    // HP when an HP item is bought/sold (see game-flow.test.ts).
    expect(result.state.players['p1']!.hp).toBe(echo.maxHp + 200)
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
          p2: makeHero('echo', { id: 'p2', name: 'Enemy', team: 'audit' }),
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
