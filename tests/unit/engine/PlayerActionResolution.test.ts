import { describe, it, expect, beforeEach } from 'vitest'
import { Effect } from 'effect'
import { processTick, submitAction } from '../../../server/game/engine/GameLoop'
import type { GameState, PlayerState } from '../../../shared/types/game'
import { initializeZoneStates, initializeTowers } from '../../../server/game/map/zones'
import { resetCreepIdCounter, initializeRoshan } from '../../../server/game/map/spawner'
import { initializeAncients } from '../../../server/game/engine/AncientSystem'
import { STARTING_GOLD, PASSIVE_GOLD_PER_TICK } from '../../../shared/constants/balance'

/**
 * End-to-end coverage of a HUMAN action changing engine state across a tick —
 * the path the e2e suite couldn't reach reliably (the manual-tick canAct/buffer
 * race). Each test queues a real Command via submitAction and runs the full
 * processTick pipeline, then asserts the resolved state: buying, casting a
 * self-buff, casting an offensive ability, and landing a basic attack.
 *
 * This is the engine-truth counterpart to the /api/test/action + advance e2e
 * flows: it proves abilities / attacking / buying actually resolve, without a
 * browser or a running server.
 */

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'human',
    name: 'Human',
    team: 'radiant',
    heroId: 'echo',
    zone: 'radiant-fountain',
    hp: 550,
    maxHp: 550,
    mp: 280,
    maxMp: 280,
    level: 6,
    xp: 0,
    gold: STARTING_GOLD,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnTick: null,
    defense: 3,
    magicResist: 15,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    towerDamageDealt: 0,
    killStreak: 0,
    buybackCost: 0,
    talents: { tier10: null, tier15: null, tier20: null, tier25: null },
    ...overrides,
  }
}

function makeGameState(players: Record<string, PlayerState>): GameState {
  return {
    tick: 10,
    phase: 'playing',
    teams: {
      radiant: { id: 'radiant', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
      dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
    },
    players,
    zones: initializeZoneStates(),
    creeps: [],
    neutrals: [],
    towers: initializeTowers(),
    ancients: initializeAncients(),
    runes: [],
    roshan: initializeRoshan(),
    aegis: null,
    events: [],
    surrenderVotes: { radiant: new Set(), dire: new Set() },
    lastSeen: {},
    timeOfDay: 'day',
    dayNightTick: 0,
  }
}

describe('player action resolution (engine truth)', () => {
  beforeEach(() => {
    resetCreepIdCounter()
  })

  it('buying an item deducts gold and adds it to the inventory', () => {
    const human = makePlayer({ zone: 'radiant-fountain', gold: STARTING_GOLD })
    const state = makeGameState({ human })

    submitAction('act-buy', 'human', { type: 'buy', item: 'iron_branch' })
    const result = Effect.runSync(processTick('act-buy', state))

    const p = result.state.players.human!
    expect(p.items).toContain('iron_branch')
    // iron_branch costs 50; one tick of passive gold (+4) also lands.
    expect(p.gold).toBe(STARTING_GOLD - 50 + PASSIVE_GOLD_PER_TICK)
  })

  it('casting a self-buff resolves: cooldown set and a buff granted', () => {
    // firewall W is self-target and unconditionally grants a multi-tick shield —
    // so the buff survives the tick and is observable. (echo W was used here
    // before, but its only lasting buff was a dead moveSpeed one; its real
    // phaseShift is a 1-tick dodge reaped in the cast tick, so nothing persisted.)
    const human = makePlayer({ level: 6, heroId: 'firewall' })
    const state = makeGameState({ human })

    // (Raw mp/maxMp can't be asserted exactly — the engine recomputes maxMp from
    // hero + level and applies regen each tick — so we assert the authoritative
    // resolution signals: the cooldown, the buff, and the ability_used event.)
    submitAction('act-cast-w', 'human', { type: 'cast', ability: 'w' })
    const result = Effect.runSync(processTick('act-cast-w', state))

    const p = result.state.players.human!
    expect(p.cooldowns.w).toBeGreaterThan(0)
    expect(p.buffs.length).toBeGreaterThan(0)
    expect(result.events.some((e) => e._tag === 'ability_used' && e.playerId === 'human')).toBe(
      true,
    )
    expect(result.rejectedActions.some((r) => r.playerId === 'human')).toBe(false)
  })

  it('casting an offensive ability resolves and damages the target', () => {
    const human = makePlayer({ zone: 'mid-river', level: 6 })
    const enemy = makePlayer({
      id: 'enemy1',
      name: 'Enemy',
      team: 'dire',
      heroId: 'daemon',
      zone: 'mid-river',
      hp: 600,
      maxHp: 600,
    })
    const state = makeGameState({ human, enemy1: enemy })

    // echo Q (Resonance): hero-target physical nuke, 40 mana, 6-tick cooldown.
    submitAction('act-cast-q', 'human', {
      type: 'cast',
      ability: 'q',
      target: { kind: 'hero', name: 'enemy1' },
    })
    const result = Effect.runSync(processTick('act-cast-q', state))

    expect(result.state.players.human!.cooldowns.q).toBeGreaterThan(0)
    expect(result.events.some((e) => e._tag === 'ability_used' && e.playerId === 'human')).toBe(
      true,
    )
    expect(result.events.some((e) => e._tag === 'damage' && e.targetId === 'enemy1')).toBe(true)
  })

  it('a basic attack on a co-located enemy lands damage', () => {
    const human = makePlayer({ zone: 'mid-river' })
    const enemy = makePlayer({
      id: 'enemy1',
      name: 'Enemy',
      team: 'dire',
      heroId: 'daemon',
      zone: 'mid-river',
      hp: 600,
      maxHp: 600,
    })
    const state = makeGameState({ human, enemy1: enemy })

    submitAction('act-atk', 'human', {
      type: 'attack',
      target: { kind: 'hero', name: 'enemy1' },
    })
    const result = Effect.runSync(processTick('act-atk', state))

    // Raw HP is confounded by per-tick regen + maxHp recompute; the damage event
    // is the authoritative "attack landed" signal.
    expect(
      result.events.some(
        (e) => e._tag === 'damage' && e.sourceId === 'human' && e.targetId === 'enemy1',
      ),
    ).toBe(true)
  })
})
