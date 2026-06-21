/**
 * Hero data parity lock.
 *
 * The per-hero RESOLVERS in server/game/heroes/*.ts are the live cast path.
 * shared/constants/heroes.ts drives client tooltips AND BotAI's mana/target
 * decisions, so it must DESCRIBE what the resolver actually does.
 *
 * This test drives every hero ability through the real `resolveAbility`
 * pipeline (so it reads the resolver's *actual* base mana, cooldown, and
 * target requirement) and asserts the shared constants agree. It must FAIL if
 * either side drifts again.
 *
 * Mechanics:
 * - Q/W/E are cast at player level 1 → ability level 1 → the resolver's
 *   level-1 (base) mana / cooldown, which is what the constant declares.
 * - R is cast at player level 6 → R level 1 → base R mana / cooldown.
 * - The target passed in is chosen from the constant's declared `targetType`;
 *   if the constant lies about what the resolver requires, the cast fails and
 *   this test errors — drift detected.
 */
import { describe, it, expect } from 'vitest'
import { Effect, Exit } from 'effect'
import type { GameState, PlayerState } from '../../../shared/types/game'
import type { TargetRef } from '../../../shared/types/commands'
import type { AbilitySlot } from '../../../server/game/heroes/_base'
import { resolveAbility, applyBuff } from '../../../server/game/heroes/_base'
// Importing the barrel runs every registerHero() side effect.
import '../../../server/game/heroes/index'
import { HEROES } from '../../../shared/constants/heroes'

const SLOTS: AbilitySlot[] = ['q', 'w', 'e', 'r']
const CASTER_ZONE = 'mid-river'
const ADJACENT_ZONE = 'mid-t1-dire' // adjacent to mid-river per shared/constants/zones.ts

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'Caster',
    team: 'radiant',
    heroId: 'echo',
    zone: CASTER_ZONE,
    hp: 5000,
    maxHp: 5000,
    mp: 5000,
    maxMp: 5000,
    level: 1,
    xp: 0,
    gold: 0,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnTick: null,
    defense: 0,
    magicResist: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    towerDamageDealt: 0,
    killStreak: 0,
    ...overrides,
  }
}

function makeState(players: PlayerState[]): GameState {
  const playerMap: Record<string, PlayerState> = {}
  for (const p of players) playerMap[p.id] = p
  return {
    tick: 10,
    phase: 'playing',
    teams: {
      radiant: { id: 'radiant', kills: 0, towerKills: 0, gold: 0 },
      dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0 },
    },
    players: playerMap,
    zones: {
      [CASTER_ZONE]: { id: CASTER_ZONE, wards: [], creeps: [] },
      [ADJACENT_ZONE]: { id: ADJACENT_ZONE, wards: [], creeps: [] },
      'top-river': { id: 'top-river', wards: [], creeps: [] },
    },
    creeps: [],
    towers: [],
    events: [],
  } as unknown as GameState
}

/**
 * Build the cast environment for one hero/slot and return the resolved state
 * plus the mana the caster actually spent and the cooldown the resolver set.
 * Throws (failing the test) if the cast does not succeed — which is itself a
 * drift signal, because the constant's declared targetType drove the target.
 */
function castAndMeasure(
  heroId: string,
  slot: AbilitySlot,
): { manaSpent: number; cooldownSet: number; damageDealt: number } {
  const targetType = HEROES[heroId]!.abilities[slot].targetType as string

  // R needs level 6 (R rank 1); Q/W/E use level 1 (ability rank 1 = base values).
  const casterLevel = slot === 'r' ? 6 : 1

  let caster = makePlayer({ id: 'p1', heroId, level: casterLevel })

  // An enemy in the caster's zone (single-target offensive + AoE casts).
  const enemy = makePlayer({
    id: 'e1',
    name: 'Enemy',
    team: 'dire',
    heroId: 'kernel',
    zone: CASTER_ZONE,
  })
  // An ally in the caster's zone (ally-target casts).
  const ally = makePlayer({
    id: 'a1',
    name: 'Ally',
    team: 'radiant',
    heroId: 'sentry',
    zone: CASTER_ZONE,
  })
  // An enemy one zone away (socket E pull).
  const adjEnemy = makePlayer({
    id: 'e2',
    name: 'AdjEnemy',
    team: 'dire',
    heroId: 'kernel',
    zone: ADJACENT_ZONE,
  })

  let target: TargetRef | undefined

  switch (targetType) {
    case 'self':
    case 'none':
      target = undefined
      break
    case 'ally':
      target = { kind: 'hero', name: 'a1' }
      break
    case 'zone':
      target = { kind: 'zone', zone: ADJACENT_ZONE }
      break
    case 'hero':
    case 'unit':
      target = { kind: 'hero', name: 'e1' }
      break
    default:
      throw new Error(`Unhandled targetType '${targetType}' for ${heroId}.${slot}`)
  }

  // ── Per-resolver preconditions so the cast actually fires ──
  // Echo E (Feedback Loop) only fires with stored feedback stacks.
  if (heroId === 'echo' && slot === 'e') {
    caster = applyBuff(caster, {
      id: 'feedbackLoop',
      stacks: 50,
      ticksRemaining: 999,
      source: 'p1',
    })
  }
  // Cache R (Eviction) deals pure damage = stored energy. With 0 energy it
  // applies only the slow, so we seed cachedEnergy to verify the damage path.
  if (heroId === 'cache' && slot === 'r') {
    caster = applyBuff(caster, {
      id: 'cachedEnergy',
      stacks: 100,
      ticksRemaining: 9999,
      source: 'p1',
    })
  }
  // Daemon E (Sudo) only spends mana / sets cooldown when the target is in
  // execute range (below 30% HP); otherwise it refunds and no-ops.
  const executeEnemy =
    heroId === 'daemon' && slot === 'e' ? { ...enemy, hp: 10, maxHp: 1000 } : enemy

  // Socket E pulls an enemy from an adjacent zone — retarget to e2.
  if (heroId === 'socket' && slot === 'e') {
    target = { kind: 'hero', name: 'e2' }
  }

  const state = makeState([caster, executeEnemy, ally, adjEnemy])

  const exit = Effect.runSyncExit(resolveAbility(state, 'p1', slot, target))
  if (Exit.isFailure(exit)) {
    throw new Error(
      `${heroId}.${slot} (targetType '${targetType}') failed to cast: ${JSON.stringify(exit.cause)}`,
    )
  }

  const resultCaster = exit.value.state.players['p1']!

  // Damage verification: if the ability declares any instant damage effects,
  // the primary target's HP must have dropped. This catches bugs like the Echo
  // Q bounce bug (primary damage silently discarded) — the constant says
  // "damage" but the resolver applied zero.
  const dmgTargetId = heroId === 'socket' && slot === 'e' ? 'e2' : 'e1'
  const resultTarget = exit.value.state.players[dmgTargetId]
  const damageDealt = resultTarget ? 5000 - resultTarget.hp : 0

  return {
    manaSpent: caster.mp - resultCaster.mp,
    cooldownSet: resultCaster.cooldowns[slot],
    damageDealt,
  }
}

/**
 * Does this ability's constant declare any instant damage-type effects? DoT-only
 * and delayed-damage abilities are excluded — their damage is applied later
 * (by `processDoTs`, `TrapSystem`, or `tickAllBuffs`), not on the cast tick, so
 * HP won't drop here.
 */
function declaresInstantDamage(heroId: string, slot: AbilitySlot): boolean {
  const ability = HEROES[heroId]!.abilities[slot]
  if (!ability.effects.some((e) => e.type === 'damage' || e.type === 'execute')) return false
  // Delayed-damage abilities: the damage is armed on cast but applied later.
  const delayed = new Set<string>([
    'socket.w', // traps detonate via TrapSystem.processTraps
    'firewall.w', // DMZ explosion on buff expiry via tickAllBuffs
  ])
  if (delayed.has(`${heroId}.${slot}`)) return false
  // Regex R: damage scales with the target's missing mana. The parity test
  // uses a full-mana enemy, so the damage is 0 — not a bug, just a scaling
  // precondition the harness doesn't set up.
  if (heroId === 'regex' && slot === 'r') return false
  return true
}

describe('Hero data parity: resolver vs shared constants', () => {
  for (const heroId of Object.keys(HEROES)) {
    const hero = HEROES[heroId]!
    describe(`${hero.name} (${heroId})`, () => {
      for (const slot of SLOTS) {
        const ability = hero.abilities[slot]

        it(`${slot.toUpperCase()}: ${ability.name} — constant manaCost matches resolver`, () => {
          const { manaSpent } = castAndMeasure(heroId, slot)
          expect(manaSpent).toBe(ability.manaCost)
        })

        it(`${slot.toUpperCase()}: ${ability.name} — constant cooldownTicks matches resolver`, () => {
          const { cooldownSet } = castAndMeasure(heroId, slot)
          expect(cooldownSet).toBe(ability.cooldownTicks)
        })

        it(`${slot.toUpperCase()}: ${ability.name} — targetType is castable by the resolver`, () => {
          // castAndMeasure derives the target solely from the declared
          // targetType. If it resolves successfully, the constant's targetType
          // is consistent with what the resolver requires.
          expect(() => castAndMeasure(heroId, slot)).not.toThrow()
        })

        it(`${slot.toUpperCase()}: ${ability.name} — damage effects actually deal damage`, () => {
          // If the constant declares instant damage/execute effects, the resolver
          // must actually reduce the target's HP. This catches the class of
          // bug where damage is computed but discarded (e.g. Echo Q bounce
          // overwrote the primary target).
          if (!declaresInstantDamage(heroId, slot)) return // DoT-only or non-damage, skip
          const { damageDealt } = castAndMeasure(heroId, slot)
          expect(damageDealt, `${heroId}.${slot} declared damage but dealt 0`).toBeGreaterThan(0)
        })
      }
    })
  }
})

// ── Echo Q bounce: primary AND bounce target both take damage ──────
// The parity damage test above only ever has ONE enemy in the caster's zone
// (the second is one zone away), so Echo Q's same-zone bounce never fires there
// and the test would pass even with the old bug. This dedicated case puts a
// SECOND enemy in the caster's zone and asserts BOTH lose HP — it FAILS on the
// old bug where the bounce target overwrote and discarded the primary's damage.
describe('Echo Q bounce', () => {
  it('damages both the primary and the bounce target in the caster zone', () => {
    const caster = makePlayer({ id: 'p1', heroId: 'echo', level: 1 })
    const primary = makePlayer({
      id: 'e1',
      name: 'Primary',
      team: 'dire',
      heroId: 'kernel',
      zone: CASTER_ZONE,
    })
    const bounce = makePlayer({
      id: 'e2',
      name: 'Bounce',
      team: 'dire',
      heroId: 'kernel',
      zone: CASTER_ZONE,
    })
    const state = makeState([caster, primary, bounce])

    const exit = Effect.runSyncExit(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (!Exit.isSuccess(exit)) return

    const e1 = exit.value.state.players['e1']!
    const e2 = exit.value.state.players['e2']!
    expect(e1.hp, 'primary target took no damage (bounce discarded it)').toBeLessThan(5000)
    expect(e2.hp, 'bounce target took no damage').toBeLessThan(5000)
  })
})
