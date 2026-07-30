import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import type { GameState, PlayerState } from '~~/shared/types/game'
import {
  dealDamage,
  dealAbilityDamage,
  getMagicAmp,
  resolveAbility,
} from '~~/server/game/heroes/_base'
// Register a code-damage hero for the end-to-end check.
import '../../../server/game/heroes/ping'

/**
 * Amp Stack (Arcane Power) — "+15% to all code damage dealt" — was a
 * dead item passive: dealDamage never knew the caster, so the staff did nothing.
 * dealAbilityDamage now applies the CASTER's magic amp before mitigation. These
 * tests pin the amp to the caster (not the target) — a target/caster swap at any
 * call site would flip the end-to-end assertions.
 */

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'Test',
    team: 'chaff',
    heroId: 'ping',
    zone: 'mid-river',
    hp: 2000,
    maxHp: 2000,
    mp: 600,
    maxMp: 600,
    level: 7,
    xp: 0,
    gold: 600,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnTick: null,
    plate: 0,
    ice: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    iceDamageDealt: 0,
    killStreak: 0,
    ...overrides,
  }
}

const STAFF = ['amp_stack', null, null, null, null, null]

function makeState(players: PlayerState[]): GameState {
  const playerMap: Record<string, PlayerState> = {}
  for (const p of players) playerMap[p.id] = p
  return {
    tick: 10,
    phase: 'playing',
    teams: {
      chaff: { id: 'chaff', kills: 0, iceKills: 0, gold: 0 },
      audit: { id: 'audit', kills: 0, iceKills: 0, gold: 0 },
    },
    players: playerMap,
    zones: { 'mid-river': { id: 'mid-river', wards: [], waves: [] } },
    waves: [],
    ice: [],
    events: [],
  } as unknown as GameState
}

describe('getMagicAmp', () => {
  it('is 1.15 with Amp Stack equipped, 1.0 without', () => {
    expect(getMagicAmp(makePlayer({ items: STAFF }))).toBeCloseTo(1.15)
    expect(getMagicAmp(makePlayer())).toBe(1)
  })
})

describe('dealAbilityDamage', () => {
  const target = () => makePlayer({ id: 't', heroId: null, ice: 0, plate: 0 })

  it('amplifies code damage by the caster Amp Stack (+15%)', () => {
    const plain = dealDamage(target(), 100, 'code')
    const amped = dealAbilityDamage(makePlayer({ items: STAFF }), target(), 100, 'code')
    const plainLost = target().hp - plain.hp
    const ampedLost = target().hp - amped.hp
    expect(ampedLost).toBeGreaterThan(plainLost)
    expect(ampedLost / plainLost).toBeCloseTo(1.15, 1)
  })

  it('does NOT amplify kinetic or black damage', () => {
    const caster = makePlayer({ items: STAFF })
    for (const type of ['kinetic', 'black'] as const) {
      const viaDeal = dealDamage(target(), 100, type)
      const viaAbility = dealAbilityDamage(caster, target(), 100, type)
      expect(viaAbility.hp).toBe(viaDeal.hp)
    }
  })

  it('does not amplify when the caster lacks the staff (amp is caster-gated)', () => {
    // A staff-less caster routes through unchanged — proves the amp depends on
    // the CASTER's items, not the target's. (A target/caster swap at a call site
    // would instead make the caster-with-staff case below stop amplifying.)
    const viaDeal = dealDamage(target(), 100, 'code')
    const viaAbility = dealAbilityDamage(makePlayer(), target(), 100, 'code')
    expect(viaAbility.hp).toBe(viaDeal.hp)
  })
})

describe('end-to-end: Ping ICMP Echo (code Q)', () => {
  function damageDealtTo(casterItems: (string | null)[], targetItems: (string | null)[]): number {
    const caster = makePlayer({ id: 'c', team: 'chaff', heroId: 'ping', items: casterItems })
    const victim = makePlayer({ id: 'v', team: 'audit', heroId: 'echo', items: targetItems })
    const state = makeState([caster, victim])
    const result = Effect.runSync(resolveAbility(state, 'c', 'q', { kind: 'hero', name: 'v' }))
    return victim.hp - result.state.players['v']!.hp
  }

  it('caster Amp Stack increases the spell damage dealt (~+15%)', () => {
    const empty = [null, null, null, null, null, null]
    const base = damageDealtTo(empty, empty)
    const withStaff = damageDealtTo(STAFF, empty)
    // If a call site had swapped caster/target, the caster's staff would be
    // ignored and this would not increase.
    expect(withStaff).toBeGreaterThan(base)
    expect(withStaff / base).toBeCloseTo(1.15, 1)
  })
})

describe('dealDamage: target-side magic vulnerability', () => {
  // No-MR target so the code mitigation is identity and the amp ratio is exact.
  const vulnTarget = (id: string, stacks: number) =>
    makePlayer({
      id: 't',
      heroId: null,
      ice: 0,
      buffs: [{ id, stacks, ticksRemaining: 4, source: 'x' }],
    })
  const plainTarget = () => makePlayer({ id: 't', heroId: null, ice: 0 })

  it('amplifies incoming CODE damage by the target vuln debuff (Veil +25%)', () => {
    const plainLost = plainTarget().hp - dealDamage(plainTarget(), 100, 'code').hp
    const veil = vulnTarget('veil_discord', 25)
    const ampedLost = veil.hp - dealDamage(veil, 100, 'code').hp
    expect(ampedLost).toBeGreaterThan(plainLost)
    expect(ampedLost / plainLost).toBeCloseTo(1.25, 1)
  })

  it('stacks regex magicVulnerability with Veil additively (+15% +25% = +40%)', () => {
    const t = makePlayer({
      id: 't',
      heroId: null,
      ice: 0,
      buffs: [
        { id: 'magicVulnerability', stacks: 15, ticksRemaining: 3, source: 'x' },
        { id: 'veil_discord', stacks: 25, ticksRemaining: 4, source: 'x' },
      ],
    })
    const plainLost = plainTarget().hp - dealDamage(plainTarget(), 100, 'code').hp
    const ampedLost = t.hp - dealDamage(t, 100, 'code').hp
    expect(ampedLost / plainLost).toBeCloseTo(1.4, 1)
  })

  it('does NOT amplify kinetic or black damage', () => {
    for (const type of ['kinetic', 'black'] as const) {
      const plainLost = plainTarget().hp - dealDamage(plainTarget(), 100, type).hp
      const veil = vulnTarget('veil_discord', 25)
      const lost = veil.hp - dealDamage(veil, 100, type).hp
      expect(lost).toBe(plainLost)
    }
  })

  it('thread Yield amplifies ALL damage types (+25%)', () => {
    for (const type of ['kinetic', 'code', 'black'] as const) {
      const plainLost = plainTarget().hp - dealDamage(plainTarget(), 100, type).hp
      const yielded = vulnTarget('yield', 25)
      const lost = yielded.hp - dealDamage(yielded, 100, type).hp
      expect(lost / plainLost).toBeCloseTo(1.25, 1)
    }
  })
})

describe('dealDamage: immunity', () => {
  const immune = (id: string) =>
    makePlayer({
      id: 't',
      heroId: null,
      ice: 0,
      plate: 0,
      buffs: [{ id, stacks: 1, ticksRemaining: 2, source: 'x' }],
    })

  it('invulnerable takes no damage of any type and keeps the buff', () => {
    for (const type of ['kinetic', 'code', 'black'] as const) {
      const t = immune('invulnerable')
      const after = dealDamage(t, 500, type)
      expect(after.hp).toBe(t.hp) // no HP lost
      expect(after.buffs.some((b) => b.id === 'invulnerable')).toBe(true) // not consumed
    }
  })

  it('magic_immune (BKB) blocks code but not kinetic', () => {
    const t1 = immune('magic_immune')
    expect(dealDamage(t1, 200, 'code').hp).toBe(t1.hp)
    const t2 = immune('magic_immune')
    expect(dealDamage(t2, 200, 'kinetic').hp).toBeLessThan(t2.hp)
  })

  it('ethereal / ghost_form block kinetic ability damage but not code', () => {
    for (const id of ['ethereal', 'ghost_form']) {
      const t1 = immune(id)
      expect(dealDamage(t1, 200, 'kinetic').hp).toBe(t1.hp)
      const t2 = immune(id)
      expect(dealDamage(t2, 200, 'code').hp).toBeLessThan(t2.hp)
    }
  })
})
