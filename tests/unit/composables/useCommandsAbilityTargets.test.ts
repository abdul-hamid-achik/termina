/**
 * Client mirrors of the engine's ability-targeting rules: the pre-flight must
 * refuse what `resolveAbility` would refuse (so the cycle is not burned), and
 * quick-cast must aim where the engine will accept.
 */
import { describe, it, expect } from 'vitest'
import {
  useCommands,
  validateCommand,
  pickAbilityTargetString,
  type GameContext,
} from '~~/app/composables/useCommands'
import type { PlayerState, ZoneRuntimeState } from '~~/shared/types/game'
import { HEROES } from '~~/shared/constants/heroes'
import { ZONE_IDS, ZONE_MAP } from '~~/shared/constants/zones'
import { abilityReach, abilityTargetTeam } from '~~/shared/utils/ability'

function zones(): Record<string, ZoneRuntimeState> {
  const out: Record<string, ZoneRuntimeState> = {}
  for (const id of ZONE_IDS) out[id] = { id, wards: [] }
  return out
}

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'Me',
    team: 'chaff',
    heroId: 'echo',
    zone: 'coldstore-cross',
    integ: 500,
    maxInteg: 500,
    bw: 900,
    maxBw: 900,
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
    buybackCost: 0,
    talents: { tier10: null, tier15: null, tier20: null, tier25: null },
    ...overrides,
  } as PlayerState
}

function ctx(players: PlayerState[], me = 'p1'): GameContext {
  const all: Record<string, PlayerState> = {}
  for (const p of players) all[p.id] = p
  return { player: all[me]!, visibleZones: zones(), allPlayers: all }
}

describe('validateCommand: ability target side', () => {
  it('refuses a Purge thrown at an enemy and a Bind thrown at a team-mate', () => {
    const me = makePlayer({ heroId: 'cron' })
    const mate = makePlayer({ id: 'm1', name: 'Mate', heroId: 'kernel' })
    const foe = makePlayer({ id: 'e1', name: 'Foe', team: 'audit', heroId: 'kernel' })
    const c = ctx([me, mate, foe])
    expect(
      validateCommand({ type: 'cast', ability: 'w', target: { kind: 'hero', name: 'e1' } }, c),
    ).toMatch(/targets allies/)
    expect(
      validateCommand({ type: 'cast', ability: 'w', target: { kind: 'hero', name: 'm1' } }, c),
    ).toBeNull()
    expect(validateCommand({ type: 'cast', ability: 'w', target: { kind: 'self' } }, c)).toBeNull()

    const socket = makePlayer({ heroId: 'socket' })
    const c2 = ctx([socket, mate, foe])
    expect(
      validateCommand({ type: 'cast', ability: 'q', target: { kind: 'hero', name: 'm1' } }, c2),
    ).toMatch(/targets enemies/)
    expect(
      validateCommand({ type: 'cast', ability: 'q', target: { kind: 'hero', name: 'e1' } }, c2),
    ).toBeNull()
  })

  it('agrees with the registry for every targeted ability (not just the named ones)', () => {
    for (const [heroId, hero] of Object.entries(HEROES)) {
      for (const slot of ['q', 'w', 'e', 'r'] as const) {
        const def = hero.abilities[slot]
        const side = abilityTargetTeam(def)
        if (!side || side === 'any') continue
        const me = makePlayer({ heroId })
        const mate = makePlayer({ id: 'm1', name: 'Mate' })
        const foe = makePlayer({ id: 'e1', name: 'Foe', team: 'audit' })
        const wrong = side === 'enemy' ? 'm1' : 'e1'
        const right = side === 'enemy' ? 'e1' : 'm1'
        const c = ctx([me, mate, foe])
        expect(
          validateCommand(
            { type: 'cast', ability: slot, target: { kind: 'hero', name: wrong } },
            c,
          ),
          `${heroId} ${slot} wrong side`,
        ).not.toBeNull()
        expect(
          validateCommand(
            { type: 'cast', ability: slot, target: { kind: 'hero', name: right } },
            c,
          ),
          `${heroId} ${slot} right side`,
        ).toBeNull()
      }
    }
  })

  it('Regex Substitution is allowed on either team', () => {
    const me = makePlayer({ heroId: 'regex' })
    const mate = makePlayer({ id: 'm1', name: 'Mate' })
    const foe = makePlayer({ id: 'e1', name: 'Foe', team: 'audit' })
    const c = ctx([me, mate, foe])
    for (const who of ['m1', 'e1']) {
      expect(
        validateCommand({ type: 'cast', ability: 'e', target: { kind: 'hero', name: who } }, c),
      ).toBeNull()
    }
  })

  it('Daemon Fork Bomb needs a zone: a hero handle or nothing is refused up front', () => {
    const me = makePlayer({ heroId: 'daemon' })
    const foe = makePlayer({ id: 'e1', name: 'Foe', team: 'audit', heroId: 'kernel' })
    const c = ctx([me, foe])
    expect(
      validateCommand({ type: 'cast', ability: 'w', target: { kind: 'hero', name: 'e1' } }, c),
    ).toMatch(/zone target/)
    expect(validateCommand({ type: 'cast', ability: 'w' }, c)).toMatch(/zone target/)
    expect(
      validateCommand({ type: 'cast', ability: 'w', target: { kind: 'zone', zone: 'nowhere' } }, c),
    ).toMatch(/not a zone/)
    expect(
      validateCommand(
        { type: 'cast', ability: 'w', target: { kind: 'zone', zone: 'seawall-cross' } },
        c,
      ),
    ).toBeNull()
  })
})

describe('parse: `cast w <zone word>`', () => {
  it('turns a bare zone word into a zone target for zone-aimed casts', () => {
    const { parse } = useCommands()
    const res = parse('cast w seawall-cross', 'chaff')
    expect(res.command).toEqual({
      type: 'cast',
      ability: 'w',
      target: { kind: 'zone', zone: 'seawall-cross' },
    })
    // hero targets are untouched
    expect(parse('cast q hero:echo', 'chaff').command).toMatchObject({
      target: { kind: 'hero', name: 'echo' },
    })
    // an unknown word stays targetless (the engine/pre-flight say why)
    expect(parse('cast w banana', 'chaff').command).toMatchObject({ target: undefined })
  })
})

describe('quick-cast aims where the engine will accept', () => {
  const adjacentZone = ZONE_MAP['coldstore-cross']!.adjacentTo[0]!

  it('Socket Accept targets a NEIGHBOURING enemy (same-zone is refused by the resolver)', () => {
    const me = makePlayer({ heroId: 'socket' })
    const here = makePlayer({ id: 'e0', name: 'Here', team: 'audit' })
    const next = makePlayer({ id: 'e1', name: 'Next', team: 'audit', zone: adjacentZone })
    expect(abilityReach(HEROES['socket']!.abilities.e)).toBe('adjacent')
    const picked = pickAbilityTargetString(HEROES['socket']!.abilities.e, me, {
      p1: me,
      e0: here,
      e1: next,
    })
    expect(picked).toEqual({ target: 'hero:e1' })
    expect(
      pickAbilityTargetString(HEROES['socket']!.abilities.e, me, { p1: me, e0: here }),
    ).toHaveProperty('error')
  })

  it('Malloc dash and Ping ICMP prefer the same zone, fall back to next door', () => {
    for (const [heroId, slot] of [
      ['malloc', 'e'],
      ['ping', 'q'],
    ] as const) {
      const def = HEROES[heroId]!.abilities[slot]
      expect(abilityReach(def)).toBe('near')
      const me = makePlayer({ heroId })
      const here = makePlayer({ id: 'e0', name: 'Here', team: 'audit' })
      const next = makePlayer({
        id: 'e1',
        name: 'Next',
        team: 'audit',
        zone: adjacentZone,
        integ: 1,
      })
      expect(pickAbilityTargetString(def, me, { p1: me, e0: here, e1: next })).toEqual({
        target: 'hero:e0',
      })
      expect(pickAbilityTargetString(def, me, { p1: me, e1: next })).toEqual({
        target: 'hero:e1',
      })
    }
  })

  it('an ordinary offensive cast still only considers the caster zone', () => {
    const def = HEROES['kernel']!.abilities.q
    expect(abilityReach(def)).toBe('zone')
    const me = makePlayer({ heroId: 'kernel' })
    const next = makePlayer({ id: 'e1', name: 'Next', team: 'audit', zone: adjacentZone })
    expect(pickAbilityTargetString(def, me, { p1: me, e1: next })).toHaveProperty('error')
  })
})

/**
 * Mirror of the engine's auto-breach (ActionResolver.convertClosedControlCast):
 * single-target hard control at a CLOSED enemy is converted into a breach when
 * the caster can breach — so the pre-flight must let it through even if the
 * ability's own BW is short — and refused with the engine's blocker text when
 * the caster cannot.
 */
describe('validateCommand: control cast at a CLOSED hero (auto-breach mirror)', () => {
  const q = {
    type: 'cast' as const,
    ability: 'q' as const,
    target: { kind: 'hero' as const, name: 'e1' },
  }
  const foe = (o: Partial<PlayerState> = {}) =>
    makePlayer({ id: 'e1', name: 'Foe', team: 'audit', heroId: 'echo', ...o })

  it('lets the cast through when it will become a breach, even short of Q BW', () => {
    const me = makePlayer({ heroId: 'kernel', level: 7, bw: 60 })
    expect(validateCommand(q, ctx([me, foe()]))).toBeNull()
  })
  it('names the BW blocker', () => {
    const me = makePlayer({ heroId: 'kernel', level: 7, bw: 30 })
    expect(validateCommand(q, ctx([me, foe()]))).toBe(
      'Foe is CLOSED — need 50 BW to breach Foe (have 30)',
    )
  })
  it('names the breach cooldown', () => {
    const me = makePlayer({
      heroId: 'kernel',
      level: 7,
      buffs: [{ id: 'item_cd_breach', stacks: 1, cyclesRemaining: 3, source: 'p1' }],
    })
    expect(validateCommand(q, ctx([me, foe()]))).toBe('Foe is CLOSED — breach ready in 3 cycles')
  })
  it('a CLOSED hero next door is left to the engine: a reach/dash lands, the control fizzles', () => {
    // malloc E reaches the adjacent zone: no "breach needs X in your zone" refusal.
    const me = makePlayer({ heroId: 'malloc', level: 7, bw: 30 })
    const e = { ...q, ability: 'e' as const }
    const next = ZONE_MAP[me.zone]!.adjacentTo[0]!
    const r = validateCommand(e, ctx([me, foe({ zone: next })]))
    expect(r ?? '').not.toMatch(/CLOSED/)
  })
  it('a fogged hero (no zone) is never read as CLOSED', () => {
    const me = makePlayer({ heroId: 'kernel', level: 7, bw: 30 })
    const fogged = foe({ zone: undefined as unknown as string })
    expect(validateCommand(q, ctx([me, fogged])) ?? '').not.toMatch(/CLOSED/)
  })
  it('a breached or airgapped target is not CLOSED for this rule', () => {
    const me = makePlayer({ heroId: 'kernel', level: 7, bw: 30 })
    const open = foe({ buffs: [{ id: 'breached', stacks: 1, cyclesRemaining: 2, source: 'p1' }] })
    expect(validateCommand(q, ctx([me, open]))).toMatch(/Not enough BW/)
  })
})

/** Same rule as the engine (shared/utils/ability.ts): these need ANOTHER ally. */
describe('validateCommand: ally abilities that refuse the caster', () => {
  for (const [hero, slot, name] of [
    ['proxy', 'r', 'Reverse Proxy'],
    ['cron', 'q', 'Uptime'],
  ] as const) {
    it(`${hero} ${slot.toUpperCase()} on yourself is refused (self ref and own handle)`, () => {
      const me = makePlayer({ heroId: hero, level: 8, bw: 400 })
      const msg = `${name} needs another allied hero — not yourself`
      for (const target of [{ kind: 'self' as const }, { kind: 'hero' as const, name: 'p1' }]) {
        expect(validateCommand({ type: 'cast', ability: slot, target }, ctx([me]))).toBe(msg)
      }
    })
  }
  it('a shield that says "or yourself" (proxy W) still accepts the caster', () => {
    const me = makePlayer({ heroId: 'proxy', level: 8, bw: 400 })
    expect(
      validateCommand({ type: 'cast', ability: 'w', target: { kind: 'self' } }, ctx([me])),
    ).toBeNull()
  })
})

describe('copy: self as the wrong side, and an ally buff with nobody to buff', () => {
  it('an enemy-only cast at yourself reads "You are on your own team"', () => {
    const me = makePlayer({ heroId: 'kernel', level: 7, bw: 300 })
    const msg = validateCommand({ type: 'cast', ability: 'q', target: { kind: 'self' } }, ctx([me]))
    expect(msg).toBe('You are on your own team — Interrupt targets enemies')
    expect(
      validateCommand(
        { type: 'cast', ability: 'q', target: { kind: 'hero', name: 'p1' } },
        ctx([me]),
      ),
    ).toBe('You are on your own team — Interrupt targets enemies')
  })

  it("Cron's quick `cast q` alone says why and names a slot that fires on yourself", () => {
    const me = makePlayer({ heroId: 'cron', level: 3 })
    const r = pickAbilityTargetString(HEROES['cron']!.abilities.q, me, { p1: me })
    expect(r).toEqual({
      error: 'No ally in your zone for Uptime — it needs a team-mate, not you. Try `cast w`',
    })
    // …and that suggestion really does pick a target.
    expect(pickAbilityTargetString(HEROES['cron']!.abilities.w, me, { p1: me })).toEqual({
      target: 'hero:p1',
    })
  })
})
