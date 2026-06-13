/**
 * Ability census — the acceptance test for the unified ability system.
 *
 * Casts EVERY hero's q/w/e/r at max level through the live engine resolver
 * (`resolveAbility` from server/game/heroes) against dummy targets and asserts
 * each ability produces an observable effect (HP / MP / buff / position /
 * vision/ward change, or a meaningful event) beyond the caster's own
 * mana+cooldown bookkeeping.
 *
 * Every ability is tried against several target shapes (same-zone enemy,
 * low-HP enemy, adjacent-zone enemy, ally, zone, self, no-target) and the
 * caster is pre-seeded with the resource stacks some abilities consume
 * (echo feedbackLoop, cache cachedEnergy). An ability is "inert" only if NO
 * target shape yields any delta — which would mean its effect array is being
 * silently dropped (the original bug this overhaul fixed).
 */
import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import type { GameState, PlayerState } from '../../../shared/types/game'
import type { TargetRef } from '../../../shared/types/commands'
import { resolveAbility } from '../../../server/game/heroes'
import { HEROES } from '../../../shared/constants/heroes'

const ZONE = 'mid-river'
const ADJ = 'mid-t1-rad'

function mkPlayer(id: string, team: 'radiant' | 'dire', over: Partial<PlayerState> = {}): PlayerState {
  return {
    id,
    name: id,
    team,
    heroId: 'echo',
    zone: ZONE,
    hp: 2000,
    maxHp: 2000,
    mp: 5000,
    maxMp: 5000,
    level: 18,
    xp: 0,
    gold: 600,
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
    buybackCost: 100,
    talents: { tier10: null, tier15: null, tier20: null, tier25: null },
    ...over,
  }
}

function baseState(heroId: string): GameState {
  const caster = mkPlayer('caster', 'radiant', {
    heroId,
    buffs: [
      { id: 'feedbackLoop', stacks: 50, ticksRemaining: 999, source: 'caster' },
      { id: 'cachedEnergy', stacks: 100, ticksRemaining: 999, source: 'caster' },
    ],
  })
  const efull = mkPlayer('efull', 'dire', { heroId: 'kernel' })
  const elow = mkPlayer('elow', 'dire', { heroId: 'kernel', hp: 50 })
  const eadj = mkPlayer('eadj', 'dire', { heroId: 'kernel', zone: ADJ })
  const ally = mkPlayer('ally', 'radiant', { heroId: 'socket', hp: 1000 })
  const players: Record<string, PlayerState> = {}
  for (const p of [caster, efull, elow, eadj, ally]) players[p.id] = p
  const zones: GameState['zones'] = {}
  for (const z of [ZONE, ADJ, 'mid-t1-dire', 'top-river', 'bot-river']) {
    zones[z] = { id: z, wards: [], creeps: [] }
  }
  return {
    tick: 100,
    phase: 'playing',
    teams: {
      radiant: { id: 'radiant', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
      dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
    },
    players,
    zones,
    creeps: [],
    neutrals: [],
    towers: [],
    ancients: {
      radiant: { team: 'radiant', hp: 6000, maxHp: 6000, alive: true, vulnerable: false },
      dire: { team: 'dire', hp: 6000, maxHp: 6000, alive: true, vulnerable: false },
    },
    runes: [],
    roshan: { alive: false, hp: 0, maxHp: 0, deathTick: null },
    aegis: null,
    events: [],
    surrenderVotes: { radiant: new Set(), dire: new Set() },
    lastSeen: {},
    timeOfDay: 'day',
    dayNightTick: 0,
  }
}

/** True if `post` differs from `pre` in anything beyond caster mp/cooldown. */
function hasObservableEffect(
  pre: GameState,
  post: GameState,
  events: Array<{ type?: string }>,
): boolean {
  for (const [pid, postP] of Object.entries(post.players)) {
    const preP = pre.players[pid]
    if (!preP) continue
    if (postP.hp !== preP.hp) return true
    if (postP.zone !== preP.zone) return true
    const preBuffs = preP.buffs.map((b) => `${b.id}:${b.stacks}`).sort().join(',')
    const postBuffs = postP.buffs.map((b) => `${b.id}:${b.stacks}`).sort().join(',')
    if (preBuffs !== postBuffs) return true
    if (pid !== 'caster' && postP.mp !== preP.mp) return true
  }
  for (const [zid, postZ] of Object.entries(post.zones)) {
    const preZ = pre.zones[zid]
    if (preZ && postZ.wards.length !== preZ.wards.length) return true
  }
  return events.some(
    (e) =>
      e.type &&
      e.type !== 'ability_cast' &&
      e.type !== 'ability_used' &&
      e.type !== 'cooldown_used',
  )
}

const TARGETS: Array<TargetRef | undefined> = [
  { kind: 'hero', name: 'efull' },
  { kind: 'hero', name: 'elow' },
  { kind: 'hero', name: 'eadj' },
  { kind: 'hero', name: 'ally' },
  { kind: 'zone', zone: ADJ },
  { kind: 'self' },
  undefined,
]

const slots = ['q', 'w', 'e', 'r'] as const

describe('Ability census — every hero ability produces an observable effect', () => {
  for (const heroId of Object.keys(HEROES)) {
    for (const slot of slots) {
      const abilityName = HEROES[heroId]!.abilities[slot].name
      it(`${heroId}.${slot} (${abilityName})`, () => {
        let observed = false
        for (const target of TARGETS) {
          const state = baseState(heroId)
          const res = Effect.runSync(Effect.either(resolveAbility(state, 'caster', slot, target)))
          if (res._tag === 'Left') continue
          if (hasObservableEffect(state, res.right.state, res.right.events)) {
            observed = true
            break
          }
        }
        expect(observed, `${heroId}.${slot} produced no observable effect for any target`).toBe(true)
      })
    }
  }
})
