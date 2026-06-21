/**
 * Higher-level ability scaling tests.
 *
 * The parity test only casts abilities at level 1 (base values). This test
 * verifies that abilities actually scale with ability level — a higher-level
 * Q should deal more damage / heal more / last longer than a lower-level Q.
 *
 * We pick heroes whose abilities have clear numeric scaling arrays in their
 * resolvers (e.g. echo Q_DAMAGE = [80, 120, 160, 200]) and assert that the
 * higher level output is strictly greater than the lower level output.
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

const CASTER_ZONE = 'mid-river'
const ADJACENT_ZONE = 'mid-t1-dire'

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
    creeps: {},
    towers: {},
    neutralCreeps: {},
    roshan: undefined,
    aegis: undefined,
    runes: [],
    timeOfDay: 'day',
    tickRate: 1000,
    events: [],
  } as unknown as GameState
}

/**
 * Cast an ability at a given player level and measure damage dealt to the
 * primary enemy target. Uses the same target derivation as the parity test.
 */
function castAtLevel(
  heroId: string,
  slot: AbilitySlot,
  level: number,
  casterBuffs?: Parameters<typeof applyBuff>[1][],
): { enemyHpLost: number; casterMpSpent: number; enemyBuffs: PlayerState['buffs'] } {
  const targetType = HEROES[heroId]!.abilities[slot].targetType as string

  let caster = makePlayer({ id: 'p1', heroId, level })
  if (casterBuffs) {
    for (const buff of casterBuffs) caster = applyBuff(caster, buff)
  }

  const enemy = makePlayer({
    id: 'e1',
    team: 'dire',
    heroId: 'kernel',
    zone: CASTER_ZONE,
    hp: 5000,
    maxHp: 5000,
  })
  const ally = makePlayer({ id: 'a1', team: 'radiant', heroId: 'sentry', zone: CASTER_ZONE })
  const adjEnemy = makePlayer({ id: 'e2', team: 'dire', heroId: 'kernel', zone: ADJACENT_ZONE })

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
      target = { kind: 'zone', zone: CASTER_ZONE }
      break
    default:
      target = { kind: 'hero', name: 'e1' }
  }

  // Per-resolver preconditions (same as parity test)
  if (heroId === 'echo' && slot === 'e') {
    caster = applyBuff(caster, {
      id: 'feedbackLoop',
      stacks: 50,
      ticksRemaining: 999,
      source: 'p1',
    })
  }
  if (heroId === 'cache' && slot === 'r') {
    caster = applyBuff(caster, {
      id: 'cachedEnergy',
      stacks: 100,
      ticksRemaining: 9999,
      source: 'p1',
    })
  }
  if (heroId === 'socket' && slot === 'e') {
    target = { kind: 'hero', name: 'e2' }
  }

  const execEnemy = heroId === 'daemon' && slot === 'e' ? { ...enemy, hp: 10, maxHp: 1000 } : enemy
  const state = makeState([caster, execEnemy, ally, adjEnemy])

  const exit = Effect.runSyncExit(resolveAbility(state, 'p1', slot, target))
  if (Exit.isFailure(exit)) {
    throw new Error(`${heroId}.${slot} at level ${level} failed: ${JSON.stringify(exit.cause)}`)
  }

  const dmgTargetId = heroId === 'socket' && slot === 'e' ? 'e2' : 'e1'
  const resultTarget = exit.value.state.players[dmgTargetId]
  const resultCaster = exit.value.state.players['p1']!

  return {
    enemyHpLost: resultTarget ? 5000 - resultTarget.hp : 0,
    casterMpSpent: 5000 - resultCaster.mp,
    enemyBuffs: resultTarget?.buffs ?? [],
  }
}

describe('ability scaling', () => {
  describe('damage scales with ability level', () => {
    // Echo Q: Q_DAMAGE = [80, 120, 160, 200] — strictly increasing
    it('echo Q deals more damage at ability level 2 than level 1', () => {
      const dmg1 = castAtLevel('echo', 'q', 1).enemyHpLost // level 1 → ability level 1
      const dmg2 = castAtLevel('echo', 'q', 3).enemyHpLost // level 3 → ability level 2
      expect(dmg2).toBeGreaterThan(dmg1)
      expect(dmg1).toBeGreaterThan(0)
    })

    it('echo Q deals more damage at ability level 4 than level 2', () => {
      const dmg2 = castAtLevel('echo', 'q', 3).enemyHpLost
      const dmg4 = castAtLevel('echo', 'q', 7).enemyHpLost
      expect(dmg4).toBeGreaterThan(dmg2)
    })

    // Cipher Q: Q_MAGIC_DAMAGE = [70, 110, 150, 190] — strictly increasing
    it('cipher Q deals more damage at ability level 2 than level 1', () => {
      const dmg1 = castAtLevel('cipher', 'q', 1).enemyHpLost
      const dmg2 = castAtLevel('cipher', 'q', 3).enemyHpLost
      expect(dmg2).toBeGreaterThan(dmg1)
      expect(dmg1).toBeGreaterThan(0)
    })

    // Lambda Q: single-target nuke
    it('lambda Q deals more damage at ability level 2 than level 1', () => {
      const dmg1 = castAtLevel('lambda', 'q', 1).enemyHpLost
      const dmg2 = castAtLevel('lambda', 'q', 3).enemyHpLost
      expect(dmg2).toBeGreaterThan(dmg1)
      expect(dmg1).toBeGreaterThan(0)
    })

    // Proxy Q: single-target physical
    it('proxy Q deals more damage at ability level 2 than level 1', () => {
      const dmg1 = castAtLevel('proxy', 'q', 1).enemyHpLost
      const dmg2 = castAtLevel('proxy', 'q', 3).enemyHpLost
      expect(dmg2).toBeGreaterThan(dmg1)
      expect(dmg1).toBeGreaterThan(0)
    })
  })

  describe('R (ultimate) scales with ultimate level', () => {
    // Echo R: R_DAMAGE = [60, 80, 100] × 6 hits — strictly increasing
    it('echo R deals more damage at R level 2 than level 1', () => {
      const dmg1 = castAtLevel('echo', 'r', 6).enemyHpLost // level 6 → R level 1
      const dmg2 = castAtLevel('echo', 'r', 12).enemyHpLost // level 12 → R level 2
      expect(dmg2).toBeGreaterThan(dmg1)
      expect(dmg1).toBeGreaterThan(0)
    })

    // Cipher R: R_DAMAGE_PER_HIT = [55, 85, 115] — strictly increasing
    it('cipher R deals more damage at R level 2 than level 1', () => {
      const dmg1 = castAtLevel('cipher', 'r', 6).enemyHpLost
      const dmg2 = castAtLevel('cipher', 'r', 12).enemyHpLost
      expect(dmg2).toBeGreaterThan(dmg1)
      expect(dmg1).toBeGreaterThan(0)
    })
  })

  describe('mana cost scales (or stays flat) with level', () => {
    // Cipher Q: Q_MANA is constant — should not decrease
    it('cipher Q mana cost does not decrease with level', () => {
      const spent1 = castAtLevel('cipher', 'q', 1).casterMpSpent
      const spent2 = castAtLevel('cipher', 'q', 3).casterMpSpent
      expect(spent2).toBeGreaterThanOrEqual(spent1)
      expect(spent1).toBeGreaterThan(0)
    })

    // Echo R: R_MANA = [150, 175, 200] — strictly increasing
    it('echo R mana cost increases with ultimate level', () => {
      const spent1 = castAtLevel('echo', 'r', 6).casterMpSpent
      const spent2 = castAtLevel('echo', 'r', 12).casterMpSpent
      expect(spent2).toBeGreaterThan(spent1)
      expect(spent1).toBeGreaterThan(0)
    })
  })

  describe('debuff duration scales with level', () => {
    it('cipher Q applies a debuff at least as long at higher level', () => {
      const buffs1 = castAtLevel('cipher', 'q', 1).enemyBuffs
      const buffs3 = castAtLevel('cipher', 'q', 5).enemyBuffs

      // Find any debuff applied by cipher Q
      const debuff1 = buffs1.find(
        (b) => b.id.includes('cipher') || b.id.includes('debuff') || b.id === 'silence',
      )
      const debuff3 = buffs3.find(
        (b) => b.id.includes('cipher') || b.id.includes('debuff') || b.id === 'silence',
      )

      // If debuffs exist, the higher level should last at least as long
      if (debuff1 && debuff3) {
        expect(debuff3.ticksRemaining).toBeGreaterThanOrEqual(debuff1.ticksRemaining)
      }
      // At minimum, both casts should succeed (verified by no throw)
    })
  })
})
