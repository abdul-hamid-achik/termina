import { describe, it, expect } from 'vitest'
import { calculateVision, filterStateForPlayer } from '~~/server/game/engine/VisionCalculator'
import { stampEventZones, toGameEvent, type GameEngineEvent } from '~~/server/game/protocol/events'
import type { GameState, PlayerState } from '~~/shared/types/game'
import { initializeZoneStates, initializeIce } from '~~/server/game/map/zones'

/**
 * The per-viewer event rule (VisionCalculator.eventForViewer): an event reaches
 * a viewer when it is global, team-owned, names one of the viewer's HEROES, or
 * is located (stampEventZones) in a zone the viewer can see — and a location
 * stamp the viewer can't see is redacted. These tests run engine-shaped events
 * through the real stamp → wire → filter path.
 */

function makePlayer(
  id: string,
  team: 'chaff' | 'audit',
  zone: string,
  extra: Partial<PlayerState> = {},
): PlayerState {
  return {
    id,
    name: id,
    team,
    heroId: 'echo',
    zone,
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
    ...extra,
  }
}

// Ground: chaff viewer C1 sits in its own anchor (sees only home ground + own
// ice); audit viewer A0 sits in ITS anchor. Enemies A1/A2 brawl at FOG, an
// audit-side zone no chaff ice or hero lights.
const FOG = 'coldstore-t2-audit'
const CHAFF_SEEN = 'coldstore-t1-chaff'

function makeState(events: GameEngineEvent[], extra: Partial<GameState> = {}): GameState {
  const players: Record<string, PlayerState> = {
    c1: makePlayer('c1', 'chaff', 'rookery-anchor'),
    a0: makePlayer('a0', 'audit', 'landing-anchor'),
    a1: makePlayer('a1', 'audit', FOG),
    a2: makePlayer('a2', 'audit', FOG),
    ...extra.players,
  }
  const base: GameState = {
    cycle: 7,
    phase: 'playing',
    teams: {
      chaff: { id: 'chaff', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
      audit: { id: 'audit', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
    },
    zones: initializeZoneStates(),
    waves: [{ id: 'wave-1', team: 'chaff', zone: FOG, integ: 100, type: 'line' }],
    neutrals: [],
    ice: initializeIce(),
    events: [],
    ...extra,
    players,
  } as GameState
  const located = [...events]
  stampEventZones(located, base)
  return { ...base, events: located.map(toGameEvent) }
}

const typesFor = (state: GameState, viewer: string) =>
  filterStateForPlayer(state, viewer).events.map((e) => e.type)

describe('event visibility — the ten previously-dropped types', () => {
  it('fixture: FOG is dark to chaff and lit for audit', () => {
    const s = makeState([])
    expect(calculateVision(s, 'c1').has(FOG)).toBe(false)
    expect(calculateVision(s, 'c1').has(CHAFF_SEEN)).toBe(true)
    expect(calculateVision(s, 'a0').has(FOG)).toBe(true)
  })

  // Every participant is an audit hero standing in chaff's fog: audit gets the
  // event (its heroes are named), chaff gets nothing.
  const enemyOnly: Array<[string, GameEngineEvent]> = [
    [
      'damage',
      {
        _tag: 'damage',
        cycle: 7,
        sourceId: 'a1',
        targetId: 'wave-1',
        amount: 30,
        damageType: 'kinetic',
      },
    ],
    ['heal', { _tag: 'heal', cycle: 7, sourceId: 'a1', targetId: 'a2', amount: 40 }],
    ['kill', { _tag: 'kill', cycle: 7, killerId: 'a1', victimId: 'a2', assisters: [] }],
    [
      'status_applied',
      {
        _tag: 'status_applied',
        cycle: 7,
        sourceId: 'a1',
        targetId: 'a1',
        status: 'root',
        cyclesRemaining: 2,
      },
    ],
    [
      'spell_blocked',
      {
        _tag: 'spell_blocked',
        cycle: 7,
        casterId: 'a1',
        targetId: 'a2',
        source: 'intercept_shell',
      },
    ],
  ]
  for (const [type, event] of enemyOnly) {
    it(`${type}: enemy-only in fog reaches the enemy crew, never the fogged viewer`, () => {
      const s = makeState([event])
      expect(typesFor(s, 'a0')).toContain(type)
      expect(typesFor(s, 'c1')).not.toContain(type)
    })
  }

  // The same five, now naming a chaff hero: chaff gets them even though the
  // ground is dark (an enemy's damage to my ally is my business).
  const touchesAlly: Array<[string, GameEngineEvent]> = [
    [
      'damage',
      { _tag: 'damage', cycle: 7, sourceId: 'a1', targetId: 'c2', amount: 30, damageType: 'code' },
    ],
    ['heal', { _tag: 'heal', cycle: 7, sourceId: 'c2', targetId: 'c2', amount: 40 }],
    ['kill', { _tag: 'kill', cycle: 7, killerId: 'a1', victimId: 'c2', assisters: ['a2'] }],
    [
      'status_applied',
      {
        _tag: 'status_applied',
        cycle: 7,
        sourceId: 'a1',
        targetId: 'c2',
        status: 'stun',
        cyclesRemaining: 1,
      },
    ],
    [
      'spell_blocked',
      {
        _tag: 'spell_blocked',
        cycle: 7,
        casterId: 'c2',
        targetId: 'a1',
        source: 'mirror_shell',
        reflected: 0,
      },
    ],
  ]
  for (const [type, event] of touchesAlly) {
    it(`${type}: naming my (dead, sightless) ally reaches me through the fog`, () => {
      // c2 is DOWN in the fog — a dead hero lights nothing, so only the
      // participant rule can deliver this.
      const s = makeState([event], {
        players: { c2: makePlayer('c2', 'chaff', FOG, { alive: false, integ: 0 }) },
      })
      expect(calculateVision(s, 'c1').has(FOG)).toBe(false)
      expect(typesFor(s, 'c1')).toContain(type)
      expect(typesFor(s, 'a0')).toContain(type)
    })
  }

  for (const type of ['tenant_killed', 'tenant_respawn', 'night_falls', 'day_breaks'] as const) {
    it(`${type} is global — both crews receive it`, () => {
      const event = (
        type === 'tenant_respawn'
          ? { _tag: type, cycle: 7, integ: 100, maxInteg: 100 }
          : { _tag: type, cycle: 7 }
      ) as GameEngineEvent
      const s = makeState([event])
      expect(typesFor(s, 'c1')).toContain(type)
      expect(typesFor(s, 'a0')).toContain(type)
    })
  }

  it('tenant_damage is located in the Hollow — only a crew that sees the pit gets it', () => {
    const event: GameEngineEvent = {
      _tag: 'tenant_damage',
      cycle: 7,
      damage: 50,
      integ: 950,
      maxInteg: 1000,
    }
    const s = makeState([event], {
      players: { c2: makePlayer('c2', 'chaff', 'hollow') },
    })
    expect(s.events[0]!.payload.zone).toBe('hollow')
    expect(calculateVision(s, 'a0').has('hollow')).toBe(false)
    expect(typesFor(s, 'c1')).toContain('tenant_damage')
    expect(typesFor(s, 'a0')).not.toContain('tenant_damage')
  })
})

describe('event visibility — location, leaks and redaction', () => {
  it('two enemies fighting in fog stay hidden (the chaff wave there lights nothing)', () => {
    const s = makeState([
      {
        _tag: 'damage',
        cycle: 7,
        sourceId: 'a1',
        targetId: 'wave-1',
        amount: 30,
        damageType: 'kinetic',
      },
      {
        _tag: 'damage',
        cycle: 7,
        sourceId: 'wave-1',
        targetId: 'a1',
        amount: 12,
        damageType: 'kinetic',
      },
    ])
    expect(filterStateForPlayer(s, 'c1').events).toEqual([])
  })

  it('hero-vs-NPC damage in a zone I can see is visible', () => {
    const s = makeState(
      [
        {
          _tag: 'damage',
          cycle: 7,
          sourceId: 'a1',
          targetId: 'wave-2',
          amount: 30,
          damageType: 'kinetic',
        },
      ],
      {
        players: { a1: makePlayer('a1', 'audit', CHAFF_SEEN) },
        waves: [{ id: 'wave-2', team: 'chaff', zone: CHAFF_SEEN, integ: 100, type: 'line' }],
      },
    )
    const ev = filterStateForPlayer(s, 'c1').events
    expect(ev.map((e) => e.type)).toEqual(['damage'])
    expect(ev[0]!.payload.zone).toBe(CHAFF_SEEN)
  })

  it('a stealthed enemy hitting a wave in my sight is NOT named — until true sight', () => {
    const stealthed = makePlayer('a1', 'audit', CHAFF_SEEN, {
      buffs: [{ id: 'stealth', stacks: 1, cyclesRemaining: 3, source: 'a1' }],
    })
    const event: GameEngineEvent = {
      _tag: 'damage',
      cycle: 7,
      sourceId: 'a1',
      targetId: 'wave-2',
      amount: 30,
      damageType: 'kinetic',
    }
    const wave = {
      id: 'wave-2',
      team: 'chaff' as const,
      zone: CHAFF_SEEN,
      integ: 100,
      type: 'line' as const,
    }
    const dark = makeState([event], { players: { a1: stealthed }, waves: [wave] })
    expect(typesFor(dark, 'c1')).toEqual([])

    const zones = initializeZoneStates()
    zones[CHAFF_SEEN]!.wards.push({ team: 'chaff', placedTick: 0, expiryTick: 99, type: 'sniffer' })
    const sighted = makeState([event], { players: { a1: stealthed }, waves: [wave], zones })
    expect(typesFor(sighted, 'c1')).toEqual(['damage'])
  })

  it("my DoT on an enemy who walked into fog reaches me WITHOUT the enemy's zone", () => {
    const s = makeState([
      { _tag: 'damage', cycle: 7, sourceId: 'c1', targetId: 'a1', amount: 9, damageType: 'code' },
    ])
    const [ev] = filterStateForPlayer(s, 'c1').events
    expect(ev?.type).toBe('damage')
    expect(ev && 'zone' in ev.payload).toBe(false)
    // The enemy crew, who can see their own hero, keeps the stamp.
    expect(filterStateForPlayer(s, 'a0').events[0]!.payload.zone).toBe(FOG)
  })

  it('participant keys beyond playerId count: a trap owner and a breach target', () => {
    const s = makeState(
      [
        {
          _tag: 'trap_triggered',
          cycle: 7,
          owner: 'a1',
          team: 'audit',
          zone: FOG,
          targetId: 'c2',
          damage: 40,
        },
        { _tag: 'breach_opened', cycle: 7, playerId: 'a1', targetId: 'c2', durationCycles: 3 },
      ],
      {
        players: { c2: makePlayer('c2', 'chaff', FOG, { alive: false, integ: 0 }) },
      },
    )
    expect(typesFor(s, 'c1')).toEqual(['trap_triggered', 'breach_opened'])
  })

  it("game-over and objective events carrying the LOSER's team reach the winners too", () => {
    const s = makeState([
      { _tag: 'ice_kill', cycle: 7, zone: 'seawall-t2-audit', team: 'audit', killerTeam: 'chaff' },
      { _tag: 'surrendered', cycle: 7, team: 'audit', winner: 'chaff' },
      { _tag: 'terminal_destroyed', cycle: 7, team: 'audit', killerTeam: 'chaff' },
    ])
    expect(typesFor(s, 'c1')).toEqual(['ice_kill', 'surrendered', 'terminal_destroyed'])
  })

  it('private enemy bookkeeping stays private even in plain sight', () => {
    const s = makeState(
      [
        { _tag: 'item_purchased', cycle: 7, playerId: 'a1', itemId: 'x', cost: 100 },
        { _tag: 'scrip_change', cycle: 7, playerId: 'a1', amount: 50, reason: 'bounty' },
        { _tag: 'level_up', cycle: 7, playerId: 'a1', newLevel: 4 },
      ],
      { players: { a1: makePlayer('a1', 'audit', CHAFF_SEEN) } },
    )
    expect(typesFor(s, 'c1')).toEqual([])
  })
})

describe('stampEventZones', () => {
  it('locates on the subject, falls back to the actor, never overwrites', () => {
    const s = makeState([])
    const events: GameEngineEvent[] = [
      {
        _tag: 'damage',
        cycle: 7,
        sourceId: 'a1',
        targetId: 'wave-gone',
        amount: 1,
        damageType: 'kinetic',
      },
      {
        _tag: 'damage',
        cycle: 7,
        sourceId: 'ice_coldstore-t1-chaff',
        targetId: 'a2',
        amount: 1,
        damageType: 'kinetic',
      },
      {
        _tag: 'damage',
        cycle: 7,
        sourceId: 'a1',
        targetId: 'terminal_chaff',
        amount: 1,
        damageType: 'kinetic',
      },
      { _tag: 'death', cycle: 7, playerId: 'a2', respawnCycle: 20, zone: 'somewhere' },
      { _tag: 'level_up', cycle: 7, playerId: 'a1', newLevel: 2 },
    ]
    stampEventZones(events, s)
    expect(events.map((e) => ('zone' in e ? e.zone : undefined))).toEqual([
      FOG,
      FOG,
      'rookery-terminal',
      'somewhere',
      undefined,
    ])
  })
})
