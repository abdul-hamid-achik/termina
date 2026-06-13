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
): { manaSpent: number; cooldownSet: number } {
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
  return {
    manaSpent: caster.mp - resultCaster.mp,
    cooldownSet: resultCaster.cooldowns[slot],
  }
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
      }
    })
  }
})
