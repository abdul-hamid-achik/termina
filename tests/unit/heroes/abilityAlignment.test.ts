/**
 * Description <-> code alignment for individual abilities. Numbers are read from
 * the HEROES registry / balance constants, not copied strings.
 */
import { describe, it, expect } from 'vitest'
import { Effect, Exit } from 'effect'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { GameState, PlayerState } from '~~/shared/types/game'
import type { TargetRef } from '~~/shared/types/commands'
import {
  resolveAbility,
  resolvePassive,
  cycleAllBuffs,
  cycleBuffs,
  type AbilitySlot,
} from '~~/server/game/heroes/_base'
import '../../../server/game/heroes/index'
import { HEROES, HERO_IDS } from '~~/shared/constants/heroes'
import { ZONE_MAP } from '~~/shared/constants/zones'
import { abilityReach, abilityTargetTeam } from '~~/shared/utils/ability'
import { PURGEABLE_DEBUFF_IDS, PURGE_EXEMPT_DEBUFF_IDS } from '~~/server/game/heroes/cron'

const ZONE = 'coldstore-cross'
const NEXT = ZONE_MAP[ZONE]!.adjacentTo[0]!
const FAR = 'seawall-cross'
const breached = { id: 'breached', stacks: 1, cyclesRemaining: 99, source: 'test' }

function P(o: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'Caster',
    team: 'chaff',
    heroId: 'echo',
    zone: ZONE,
    integ: 5000,
    maxInteg: 5000,
    bw: 5000,
    maxBw: 5000,
    level: 18,
    xp: 0,
    scrip: 0,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnCycle: null,
    plate: 0,
    ice: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    iceDamageDealt: 0,
    killStreak: 0,
    ...o,
  } as PlayerState
}
const foe = (o: Partial<PlayerState> = {}) =>
  P({ id: 'e1', name: 'Foe', team: 'audit', heroId: 'kernel', buffs: [breached], ...o })

function S(players: PlayerState[]): GameState {
  const map: Record<string, PlayerState> = {}
  for (const p of players) map[p.id] = p
  const zones: GameState['zones'] = {}
  for (const z of [ZONE, NEXT, FAR]) zones[z] = { id: z, wards: [] } as never
  return {
    cycle: 10,
    phase: 'playing',
    teams: {
      chaff: { id: 'chaff', kills: 0, iceKills: 0, scrip: 0 },
      audit: { id: 'audit', kills: 0, iceKills: 0, scrip: 0 },
    },
    players: map,
    zones,
    waves: [],
    ice: [],
    events: [],
  } as unknown as GameState
}

function cast(state: GameState, slot: AbilitySlot, target?: TargetRef) {
  const exit = Effect.runSyncExit(resolveAbility(state, 'p1', slot, target))
  if (!Exit.isSuccess(exit)) throw new Error(`cast ${slot} failed`)
  return exit.value
}
const castOk = (state: GameState, slot: AbilitySlot, target?: TargetRef) =>
  Exit.isSuccess(Effect.runSyncExit(resolveAbility(state, 'p1', slot, target)))

describe('reach: the shared table matches what each resolver accepts', () => {
  for (const heroId of HERO_IDS) {
    for (const slot of ['q', 'w', 'e', 'r'] as const) {
      const def = HEROES[heroId]!.abilities[slot]
      if (abilityTargetTeam(def) !== 'enemy') continue
      const reach = abilityReach(def)
      it(`${heroId} ${slot} (${def.name}) reach=${reach}`, () => {
        // prerequisites a few abilities need before they will fire at all
        const prep = (zone: string) =>
          S([
            P({
              heroId,
              buffs: [{ id: 'feedbackLoop', stacks: 20, cyclesRemaining: 99, source: 'p1' }],
            }),
            foe({ zone, integ: 50, maxInteg: 1000 }),
          ])
        const same = castOk(prep(ZONE), slot, { kind: 'hero', name: 'e1' })
        const next = castOk(prep(NEXT), slot, { kind: 'hero', name: 'e1' })
        expect(same, 'same zone').toBe(reach !== 'adjacent')
        expect(next, 'adjacent zone').toBe(reach !== 'zone')
      })
    }
  }
})

describe('Sentry Scan Pulse reveals as well as slows', () => {
  it("every enemy hero in the zone is revealed to Sentry's team and slowed", () => {
    const out = cast(S([P({ heroId: 'sentry' }), foe(), foe({ id: 'e2' })]), 'e')
    for (const id of ['e1', 'e2']) {
      const buffs = out.state.players[id]!.buffs
      expect(buffs.find((b) => b.id === 'revealed')?.source).toBe('p1')
      expect(buffs.some((b) => b.id === 'slow')).toBe(true)
    }
    const reveal = HEROES['sentry']!.abilities.e.effects.find((e) => e.type === 'reveal')!
    expect(out.state.players['e1']!.buffs.find((b) => b.id === 'revealed')!.cyclesRemaining).toBe(
      reveal.duration,
    )
  })
})

describe('Cipher Encrypt: attacking or taking damage breaks stealth', () => {
  const stealthy = () =>
    S([
      P({
        heroId: 'cipher',
        buffs: [{ id: 'stealth', stacks: 1, cyclesRemaining: 2, source: 'p1' }],
      }),
      foe(),
    ])
  const hasStealth = (s: GameState) => s.players['p1']!.buffs.some((b) => b.id === 'stealth')

  it('a basic attack breaks it', () => {
    const next = resolvePassive(stealthy(), 'p1', {
      cycle: 10,
      type: 'attack',
      payload: { attackerId: 'p1', targetId: 'e1' },
    })
    expect(hasStealth(next)).toBe(false)
  })
  it('taking damage breaks it', () => {
    const next = resolvePassive(stealthy(), 'p1', {
      cycle: 10,
      type: 'damage_taken',
      payload: { targetId: 'p1', attackerId: 'e1', damage: 10 },
    })
    expect(hasStealth(next)).toBe(false)
  })
  it('does not cancel itself on its own Encrypt cast, or on someone else acting', () => {
    const own = resolvePassive(stealthy(), 'p1', {
      cycle: 10,
      type: 'ability_cast',
      payload: { playerId: 'p1', ability: 'w' },
    })
    expect(hasStealth(own)).toBe(true)
    const other = resolvePassive(stealthy(), 'p1', {
      cycle: 10,
      type: 'attack',
      payload: { attackerId: 'e1', targetId: 'e1' },
    })
    expect(hasStealth(other)).toBe(true)
  })
})

describe('Kernel Panic: displaced AND feared for the advertised cycle', () => {
  it('the fear survives the cast cycle (it used to be reaped the same cycle it landed)', () => {
    const out = cast(S([P({ heroId: 'kernel' }), foe()]), 'r')
    const e1 = out.state.players['e1']!
    expect(e1.zone).not.toBe(ZONE) // displaced this cycle, not "next cycle"
    const fear = e1.buffs.find((b) => b.id === 'feared')!
    expect(cycleBuffs(e1).buffs.some((b) => b.id === 'feared')).toBe(true) // still gates next action
    const advertised = HEROES['kernel']!.abilities.r.effects.find((e) => e.type === 'fear')!
    expect(fear.cyclesRemaining - 1).toBe(advertised.duration)
  })
})

describe('Malloc Pointer Dereference is a dash', () => {
  it("from next door it carries Malloc into the target's zone", () => {
    const out = cast(S([P({ heroId: 'malloc' }), foe({ zone: NEXT })]), 'e', {
      kind: 'hero',
      name: 'e1',
    })
    expect(out.state.players['p1']!.zone).toBe(NEXT)
    expect(out.state.players['e1']!.buffs.some((b) => b.id === 'stun')).toBe(true)
  })
  it('in the same zone Malloc stays put; two zones away is refused', () => {
    const same = cast(S([P({ heroId: 'malloc' }), foe()]), 'e', { kind: 'hero', name: 'e1' })
    expect(same.state.players['p1']!.zone).toBe(ZONE)
    expect(
      castOk(S([P({ heroId: 'malloc' }), foe({ zone: FAR })]), 'e', { kind: 'hero', name: 'e1' }),
    ).toBe(false)
  })
})

describe('Traceroute Full Trace boosts Probe, not just basic attacks', () => {
  const lost = (buffs: PlayerState['buffs']) => {
    const out = cast(S([P({ heroId: 'traceroute', buffs }), foe()]), 'q', {
      kind: 'hero',
      name: 'e1',
    })
    return 5000 - out.state.players['e1']!.integ
  }
  it('Probe deals the advertised +50% while the buff is up', () => {
    const percent = HEROES['traceroute']!.abilities.r.effects.find((e) => e.type === 'buff')!.value
    const base = lost([])
    const buffed = lost([{ id: 'fullTraceDmg', stacks: percent, cyclesRemaining: 2, source: 'p1' }])
    expect(base).toBeGreaterThan(0)
    expect(buffed / base).toBeCloseTo(1 + percent / 100, 1)
  })
})

describe('Regex Pattern Cache counts every damaging ability', () => {
  const castEvent = (ability: string) => ({
    cycle: 10,
    type: 'ability_cast' as const,
    payload: { playerId: 'p1', ability, targetId: 'e1' },
  })
  it('Capture Group (damage over time, no instant hit) gets the repeat-target bonus', () => {
    let s = S([P({ heroId: 'regex' }), foe()])
    s = resolvePassive(s, 'p1', castEvent('w'))
    expect(s.players['e1']!.integ).toBe(5000) // first cast on a target: no bonus yet
    s = resolvePassive(s, 'p1', castEvent('w'))
    expect(s.players['e1']!.integ).toBeLessThan(5000)
  })
  it('Substitution (no damage) deals no bonus', () => {
    let s = S([P({ heroId: 'regex' }), foe()])
    s = resolvePassive(s, 'p1', castEvent('e'))
    s = resolvePassive(s, 'p1', castEvent('e'))
    expect(s.players['e1']!.integ).toBe(5000)
  })
})

describe('Cron Purge cleanses every debuff the HUD calls a debuff', () => {
  it("strips each purgeable id and leaves allies' buffs, BREACHED and Revealed alone", () => {
    const debuffs = [...PURGEABLE_DEBUFF_IDS].map((id) => ({
      id,
      stacks: 5,
      cyclesRemaining: 3,
      source: 'e1',
    }))
    const keep = [
      { id: 'uptimeAtk', stacks: 15, cyclesRemaining: 3, source: 'p1' },
      { id: 'breached', stacks: 1, cyclesRemaining: 3, source: 'e1' },
      { id: 'revealed', stacks: 1, cyclesRemaining: 3, source: 'e1' },
    ]
    const out = cast(
      S([
        P({ heroId: 'cron' }),
        P({ id: 'm1', name: 'Mate', heroId: 'kernel', buffs: [...debuffs, ...keep] }),
      ]),
      'w',
      { kind: 'hero', name: 'm1' },
    )
    const ids = out.state.players['m1']!.buffs.map((b) => b.id)
    for (const id of PURGEABLE_DEBUFF_IDS) expect(ids, id).not.toContain(id)
    for (const id of ['uptimeAtk', 'breached', 'revealed', 'shield']) expect(ids).toContain(id)
  })

  it('covers every id the HUD marks `negative` (so a new debuff cannot be missed silently)', () => {
    const src = readFileSync(resolve(__dirname, '../../../app/utils/buffs.ts'), 'utf8')
    const negatives = [...src.matchAll(/^\s+(\w+): \{ label: '[^']*', kind: 'negative'/gm)].map(
      (m) => m[1]!,
    )
    expect(negatives.length).toBeGreaterThan(15)
    for (const id of negatives) {
      expect(
        PURGEABLE_DEBUFF_IDS.has(id) || PURGE_EXEMPT_DEBUFF_IDS.includes(id),
        `${id} is a debuff Purge neither cleanses nor explicitly exempts`,
      ).toBe(true)
    }
  })
})

describe('rank-scaled numbers shown in descriptions match the resolvers', () => {
  const series = (text: string) => {
    const m = text.match(/(\d+)(?: \/ (\d+))+/)
    return m ? m[0].split('/').map((n) => Number(n.trim())) : []
  }
  // player level at which each ability rank unlocks (BASIC 1/3/5/7, ULT 6/12/18)
  const BASIC_LEVELS = [1, 3, 5, 7]
  const ULT_LEVELS = [6, 12, 18]

  it('Malloc Free() damage per rank', () => {
    const nums = series(HEROES['malloc']!.abilities.w.description)
    expect(nums).toHaveLength(4)
    nums.forEach((n, i) => {
      const out = cast(S([P({ heroId: 'malloc', level: BASIC_LEVELS[i]! }), foe()]), 'w', {
        kind: 'hero',
        name: 'e1',
      })
      const dmg = out.events.find((e) => e.type === 'ability_cast')!.payload['damage']
      expect(dmg).toBe(n)
    })
  })

  it('Regex Capture Group DoT total per rank', () => {
    const nums = series(HEROES['regex']!.abilities.w.description)
    expect(nums).toHaveLength(4)
    nums.forEach((n, i) => {
      const out = cast(S([P({ heroId: 'regex', level: BASIC_LEVELS[i]! }), foe()]), 'w', {
        kind: 'hero',
        name: 'e1',
      })
      const payload = out.events.find((e) => e.type === 'ability_cast')!.payload
      expect((payload['dotDamage'] as number) * (payload['dotDuration'] as number)).toBe(n)
    })
  })

  it('Regex Catastrophic Backtracking damage per 100 missing BW, per rank', () => {
    const nums = series(HEROES['regex']!.abilities.r.description)
    expect(nums).toHaveLength(3)
    nums.forEach((n, i) => {
      const out = cast(
        S([P({ heroId: 'regex', level: ULT_LEVELS[i]! }), foe({ bw: 0, maxBw: 100 })]),
        'r',
        { kind: 'hero', name: 'e1' },
      )
      expect(out.events.find((e) => e.type === 'ability_cast')!.payload['damage']).toBe(n)
    })
  })

  it('Echo Feedback Loop stores the advertised feedback per attack, per rank', () => {
    const text = HEROES['echo']!.abilities.e.description
    const m = text.match(/stores (\d+) feedback \((\d+) \/ (\d+) \/ (\d+)/)!
    const nums = m.slice(1).map(Number)
    nums.forEach((n, i) => {
      const s = S([P({ heroId: 'echo', level: BASIC_LEVELS[i]! }), foe()])
      const next = resolvePassive(s, 'p1', {
        cycle: 10,
        type: 'attack',
        payload: { attackerId: 'p1', targetId: 'e1' },
      })
      expect(next.players['p1']!.buffs.find((b) => b.id === 'feedbackLoop')!.stacks).toBe(n)
    })
  })

  it('Socket Broadcast slow per rank (the registry shows rank 1, not rank 2)', () => {
    const def = HEROES['socket']!.abilities.r
    const ranks = [...def.description.matchAll(/(\d+)%/g)].map((m) => Number(m[1])).slice(0, 3)
    expect(ranks).toHaveLength(3)
    expect(def.effects.find((e) => e.type === 'slow')!.value).toBe(ranks[0])
    ULT_LEVELS.forEach((lvl, i) => {
      const out = cast(S([P({ heroId: 'socket', level: lvl }), foe()]), 'r')
      expect(out.state.players['e1']!.buffs.find((b) => b.id === 'broadcast_slow')!.stacks).toBe(
        ranks[i],
      )
    })
  })
})

describe('Next Hop snaps Traceroute home when the shadow expires', () => {
  it('one cycle of action away, then back to the marked zone', () => {
    const out = cast(S([P({ heroId: 'traceroute' })]), 'e')
    // moved away during the next cycle
    let state = {
      ...out.state,
      players: { ...out.state.players, p1: { ...out.state.players['p1']!, zone: NEXT } },
    }
    state = cycleAllBuffs(state) // end of the CAST cycle
    expect(state.players['p1']!.zone).toBe(NEXT)
    state = cycleAllBuffs(state) // end of the next cycle
    expect(state.players['p1']!.zone).toBe(ZONE)
  })
})
