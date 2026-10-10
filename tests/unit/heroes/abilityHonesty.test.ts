/**
 * "What an ability says must be what it does" — target side, zone targets, and
 * honest reporting of hard control that fizzles on a CLOSED target.
 *
 * Everything is driven off the HEROES registry (targetType, effects), not
 * copied strings, so a new ability inherits the checks.
 */
import { describe, it, expect } from 'vitest'
import { Effect, Exit, Cause } from 'effect'
import type { GameState, PlayerState } from '~~/shared/types/game'
import type { TargetRef } from '~~/shared/types/commands'
import {
  resolveAbility,
  cycleAllBuffs,
  CONTROL_RESISTED_REASON,
  isHardControlBuffId,
  type AbilitySlot,
} from '~~/server/game/heroes/_base'
import '../../../server/game/heroes/index'
import { HEROES, HERO_IDS } from '~~/shared/constants/heroes'
import { abilityTargetTeam } from '~~/shared/utils/ability'

const SLOTS: AbilitySlot[] = ['q', 'w', 'e', 'r']
const ZONE = 'coldstore-cross'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
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
    ...overrides,
  } as PlayerState
}

const breached = { id: 'breached', stacks: 1, cyclesRemaining: 99, source: 'test' }

function makeState(players: PlayerState[]): GameState {
  const map: Record<string, PlayerState> = {}
  for (const p of players) map[p.id] = p
  return {
    cycle: 10,
    phase: 'playing',
    teams: {
      chaff: { id: 'chaff', kills: 0, iceKills: 0, scrip: 0 },
      audit: { id: 'audit', kills: 0, iceKills: 0, scrip: 0 },
    },
    players: map,
    zones: {
      [ZONE]: { id: ZONE, wards: [] },
      'seawall-cross': { id: 'seawall-cross', wards: [] },
    },
    waves: [],
    ice: [],
    events: [],
  } as unknown as GameState
}

function run(state: GameState, slot: AbilitySlot, target?: TargetRef) {
  return Effect.runSyncExit(resolveAbility(state, 'p1', slot, target))
}

function failureReason(exit: ReturnType<typeof run>): string | undefined {
  if (!Exit.isFailure(exit)) return undefined
  const err = Cause.failureOption(exit.cause)
  return err._tag === 'Some' ? (err.value as { reason?: string }).reason : undefined
}

describe('target side is enforced before anything is spent', () => {
  for (const heroId of HERO_IDS) {
    for (const slot of SLOTS) {
      const def = HEROES[heroId]!.abilities[slot]
      const side = abilityTargetTeam(def)
      if (side === null || side === 'any') continue

      it(`${heroId} ${slot} (${def.name}) refuses a ${side === 'enemy' ? 'team-mate' : 'enemy'}`, () => {
        const caster = makePlayer({ heroId })
        const mate = makePlayer({ id: 'm1', name: 'Mate', team: 'chaff', heroId: 'kernel' })
        const foe = makePlayer({
          id: 'e1',
          name: 'Foe',
          team: 'audit',
          heroId: 'kernel',
          buffs: [breached],
        })
        const state = makeState([caster, mate, foe])
        const wrongSide = side === 'enemy' ? mate : foe
        const exit = run(state, slot, { kind: 'hero', name: wrongSide.id })
        expect(Exit.isFailure(exit)).toBe(true)
        expect(failureReason(exit)).toBeTruthy()
      })
    }
  }

  it('Regex E (Substitution) is deliberately team-agnostic', () => {
    expect(abilityTargetTeam(HEROES['regex']!.abilities.e)).toBe('any')
    const caster = makePlayer({ heroId: 'regex' })
    const mate = makePlayer({ id: 'm1', name: 'Mate', heroId: 'kernel', zone: 'seawall-cross' })
    const exit = run(makeState([caster, mate]), 'e', { kind: 'hero', name: 'm1' })
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it('names the problem for the named audit cases', () => {
    const foe = makePlayer({ id: 'e1', name: 'Foe', team: 'audit', buffs: [breached] })
    const mate = makePlayer({ id: 'm1', name: 'Mate' })
    const cases: [string, AbilitySlot, string][] = [
      ['proxy', 'w', 'e1'],
      ['cron', 'w', 'e1'],
      ['socket', 'q', 'm1'],
      ['socket', 'e', 'm1'],
    ]
    for (const [heroId, slot, who] of cases) {
      const caster = makePlayer({ heroId })
      const exit = run(makeState([caster, mate, foe]), slot, { kind: 'hero', name: who })
      expect(Exit.isFailure(exit), `${heroId} ${slot}`).toBe(true)
      expect(failureReason(exit)).toMatch(/targets (allies|enemies)/)
    }
  })

  it('self-casts of an ally ability still work (Proxy W / Cron W on yourself)', () => {
    for (const heroId of ['proxy', 'cron']) {
      const exit = run(makeState([makePlayer({ heroId })]), 'w', { kind: 'self' })
      expect(Exit.isSuccess(exit), heroId).toBe(true)
    }
  })

  it('a refused cast spends no BW and sets no cooldown (it is a failure, not a resolved cast)', () => {
    const caster = makePlayer({ heroId: 'proxy' })
    const foe = makePlayer({ id: 'e1', team: 'audit', buffs: [breached] })
    const exit = run(makeState([caster, foe]), 'w', { kind: 'hero', name: 'e1' })
    expect(Exit.isFailure(exit)).toBe(true) // a failure carries no new state at all
  })
})

describe('zone-typed abilities need a real zone', () => {
  const zoneAbilities: [string, AbilitySlot][] = []
  for (const heroId of HERO_IDS) {
    for (const slot of SLOTS) {
      if (HEROES[heroId]!.abilities[slot].targetType === 'zone') zoneAbilities.push([heroId, slot])
    }
  }

  it('the registry has zone abilities to guard (daemon W and R)', () => {
    expect(zoneAbilities).toContainEqual(['daemon', 'w'])
    expect(zoneAbilities).toContainEqual(['daemon', 'r'])
  })

  for (const [heroId, slot] of zoneAbilities) {
    it(`${heroId} ${slot} rejects a hero handle, a missing target and an unknown zone`, () => {
      const state = makeState([
        makePlayer({ heroId }),
        makePlayer({ id: 'e1', name: 'e1', team: 'audit' }),
      ])
      expect(Exit.isFailure(run(state, slot, { kind: 'hero', name: 'seawall-cross' }))).toBe(true)
      expect(Exit.isFailure(run(state, slot, { kind: 'hero', name: 'e1' }))).toBe(true)
      expect(Exit.isFailure(run(state, slot))).toBe(true)
      expect(Exit.isFailure(run(state, slot, { kind: 'zone', zone: 'nowhere' }))).toBe(true)
      expect(Exit.isSuccess(run(state, slot, { kind: 'zone', zone: 'seawall-cross' }))).toBe(true)
    })
  }
})

describe('hard control that fizzles on a CLOSED target is reported, not silent', () => {
  function successEvents(exit: ReturnType<typeof run>) {
    if (!Exit.isSuccess(exit)) throw new Error('expected the cast to resolve')
    return exit.value
  }

  it('Kernel Q on a closed target: no stun, a control_resisted event, and the cast payload says so', () => {
    const caster = makePlayer({ heroId: 'kernel' })
    const foe = makePlayer({ id: 'e1', name: 'Foe', team: 'audit' }) // NOT breached
    const out = successEvents(run(makeState([caster, foe]), 'q', { kind: 'hero', name: 'e1' }))

    expect(out.state.players['e1']!.buffs.some((b) => b.id === 'stun')).toBe(false)
    const ev = out.events.find((e) => e.type === 'control_resisted')
    expect(ev).toBeDefined()
    expect(ev!.payload).toMatchObject({
      playerId: 'p1',
      ability: 'q',
      targetId: 'e1',
      status: 'stun',
      reason: CONTROL_RESISTED_REASON,
    })
    expect(CONTROL_RESISTED_REASON).toMatch(/breach/i)
    const cast = out.events.find((e) => e.type === 'ability_cast')!
    expect(cast.payload['resisted']).toEqual([{ targetId: 'e1', status: 'stun' }])
  })

  it('a breached target is stunned and nothing is reported as resisted', () => {
    const caster = makePlayer({ heroId: 'kernel' })
    const foe = makePlayer({ id: 'e1', name: 'Foe', team: 'audit', buffs: [breached] })
    const out = successEvents(run(makeState([caster, foe]), 'q', { kind: 'hero', name: 'e1' }))
    expect(out.state.players['e1']!.buffs.some((b) => b.id === 'stun')).toBe(true)
    expect(out.events.some((e) => e.type === 'control_resisted')).toBe(false)
    expect(out.events.find((e) => e.type === 'ability_cast')!.payload['resisted']).toBeUndefined()
  })

  it('AoE control reports per target: Firewall E taunts the breached, reports the closed', () => {
    const caster = makePlayer({ heroId: 'firewall' })
    const open = makePlayer({ id: 'e1', name: 'Open', team: 'audit', buffs: [breached] })
    const closed = makePlayer({ id: 'e2', name: 'Closed', team: 'audit' })
    const out = successEvents(run(makeState([caster, open, closed]), 'e'))
    const resisted = out.events.filter((e) => e.type === 'control_resisted')
    expect(resisted.map((e) => e.payload['targetId'])).toEqual(['e2'])
    expect(resisted[0]!.payload['status']).toBe('taunt')
  })

  it('self-applied control (Mutex W self-root) is never "resisted"', () => {
    const caster = makePlayer({ heroId: 'mutex' })
    const out = successEvents(run(makeState([caster]), 'w'))
    expect(out.state.players['p1']!.buffs.some((b) => b.id === 'root')).toBe(true)
    expect(out.events.some((e) => e.type === 'control_resisted')).toBe(false)
  })

  it('every hard-control id the engine knows is traceable (guards the id list)', () => {
    for (const id of ['stun', 'silence', 'root', 'taunt', 'feared', 'hex', 'cyclone']) {
      expect(isHardControlBuffId(id)).toBe(true)
    }
  })

  it('the trace does not leak between casts', () => {
    const caster = makePlayer({ heroId: 'kernel' })
    const closed = makePlayer({ id: 'e1', name: 'Foe', team: 'audit' })
    const first = successEvents(run(makeState([caster, closed]), 'q', { kind: 'hero', name: 'e1' }))
    expect(first.events.filter((e) => e.type === 'control_resisted')).toHaveLength(1)
    // A cast that applies no control afterwards must carry none of the old trace.
    const shield = successEvents(run(makeState([makePlayer({ heroId: 'kernel' })]), 'w'))
    expect(shield.events.some((e) => e.type === 'control_resisted')).toBe(false)
  })
})

describe('Firewall DMZ explodes when the shield breaks, not only when it expires', () => {
  function armed(shield: number): { state: GameState } {
    const caster = makePlayer({ heroId: 'firewall' })
    const foe = makePlayer({ id: 'e1', name: 'Foe', team: 'audit', integ: 1000, maxInteg: 1000 })
    const exit = run(makeState([caster, foe]), 'w')
    if (!Exit.isSuccess(exit)) throw new Error('DMZ failed to cast')
    const state = exit.value.state
    const me = state.players['p1']!
    const buffs = me.buffs.map((b) => (b.id === 'shield' ? { ...b, stacks: shield } : b))
    return { state: { ...state, players: { ...state.players, p1: { ...me, buffs } } } }
  }

  it('shield intact and time left: no explosion yet', () => {
    const { state } = armed(50)
    const next = cycleAllBuffs(state)
    expect(next.players['e1']!.integ).toBe(1000)
    expect(next.players['p1']!.buffs.some((b) => b.id === 'dmz')).toBe(true)
  })

  it('shield spent with time still on the marker: explodes now, once, and the marker is gone', () => {
    const { state } = armed(50)
    const me = state.players['p1']!
    const broken = {
      ...state,
      players: {
        ...state.players,
        p1: { ...me, buffs: me.buffs.filter((b) => b.id !== 'shield') },
      },
    }
    const next = cycleAllBuffs(broken)
    expect(next.players['e1']!.integ).toBeLessThan(1000)
    expect(next.players['p1']!.buffs.some((b) => b.id === 'dmz')).toBe(false)
    const ev = next.events.find(
      (e) => e.type === 'ability_used' && e.payload['effect'] === 'dmz_explosion',
    )
    expect(ev?.payload['trigger']).toBe('broken')
    // and it does not go off a second time when the (now removed) marker would have expired
    const again = cycleAllBuffs(next)
    expect(again.players['e1']!.integ).toBe(next.players['e1']!.integ)
  })

  it('still explodes on expiry (trigger: expired)', () => {
    const { state } = armed(50)
    const me = state.players['p1']!
    const expiring = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...me,
          buffs: me.buffs.map((b) => (b.id === 'dmz' ? { ...b, cyclesRemaining: 1 } : b)),
        },
      },
    }
    const next = cycleAllBuffs(expiring)
    expect(next.players['e1']!.integ).toBeLessThan(1000)
    const ev = next.events.find(
      (e) => e.type === 'ability_used' && e.payload['effect'] === 'dmz_explosion',
    )
    expect(ev?.payload['trigger']).toBe('expired')
  })
})

describe('advertised control duration is the number of actions it really gates', () => {
  // A cast-applied control is reaped at the END of the cast cycle, so a buff
  // with cyclesRemaining N gates N-1 future actions (see applyBuff). The player
  // reads "stun 1 cycle" as "loses one cycle" — the registry must say N-1.
  const TYPE_TO_BUFF: Record<string, string> = {
    stun: 'stun',
    silence: 'silence',
    root: 'root',
    taunt: 'taunt',
    fear: 'feared',
  }

  for (const heroId of HERO_IDS) {
    for (const slot of SLOTS) {
      const def = HEROES[heroId]!.abilities[slot]
      const controls = def.effects.filter((e) => e.type in TYPE_TO_BUFF)
      if (controls.length === 0) continue

      it(`${heroId} ${slot} (${def.name}) advertises the gated cycles it applies`, () => {
        const caster = makePlayer({
          heroId,
          buffs: [{ id: 'closureActive', stacks: 1, cyclesRemaining: 9, source: 'p1' }],
        })
        const foe = makePlayer({
          id: 'e1',
          name: 'Foe',
          team: 'audit',
          heroId: 'kernel',
          buffs: [breached],
        })
        const exit = run(makeState([caster, foe]), slot, {
          kind: 'hero',
          name: def.targetType === 'ally' ? 'p1' : 'e1',
        })
        if (!Exit.isSuccess(exit)) throw new Error(`${heroId} ${slot} did not resolve`)
        const after = exit.value.state.players
        for (const effect of controls) {
          const id = TYPE_TO_BUFF[effect.type]!
          const applied = Object.values(after)
            .flatMap((p) => p.buffs)
            .filter((b) => b.id === id && b.source === 'p1')
          expect(applied.length, `${def.name} applied no ${id}`).toBeGreaterThan(0)
          const gated = Math.max(...applied.map((b) => b.cyclesRemaining)) - 1
          expect(effect.duration, `${def.name} ${effect.type} duration`).toBe(gated)
        }
      })
    }
  }
})
