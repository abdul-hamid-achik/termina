import { describe, it, expect } from 'vitest'
import type { GameState, PlayerState, TrapState } from '../../../shared/types/game'
import { processTraps } from '../../../server/game/engine/TrapSystem'

// ── Test Helpers ──────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'Test',
    team: 'radiant',
    heroId: 'socket',
    zone: 'mid-river',
    hp: 650,
    maxHp: 650,
    mp: 300,
    maxMp: 300,
    level: 7,
    xp: 0,
    gold: 600,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnTick: null,
    defense: 5,
    magicResist: 18,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    towerDamageDealt: 0,
    killStreak: 0,
    ...overrides,
  }
}

const TRAP: TrapState = {
  owner: 'p1',
  team: 'radiant',
  damage: 160,
  revealDuration: 2,
  expiryTick: 40,
}

function makeState(players: PlayerState[], traps: TrapState[], overrides: Partial<GameState> = {}) {
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
      'mid-river': { id: 'mid-river', wards: [], creeps: [], traps },
      'top-river': { id: 'top-river', wards: [], creeps: [] },
    },
    creeps: [],
    towers: [],
    events: [],
    ...overrides,
  } as unknown as GameState
}

// ── Tests ─────────────────────────────────────────────────────────

describe('TrapSystem.processTraps', () => {
  it('detonates on the first enemy hero in the trapped zone', () => {
    const owner = makePlayer({ id: 'p1', team: 'radiant', zone: 'top-river' })
    const enemy = makePlayer({ id: 'e1', team: 'dire', heroId: 'echo', zone: 'mid-river' })
    const state = makeState([owner, enemy], [TRAP])

    const { state: next, events } = processTraps(state)

    // Victim took damage and was revealed by the trap owner.
    const victim = next.players['e1']!
    expect(victim.hp).toBeLessThan(enemy.hp)
    expect(victim.buffs.some((b) => b.id === 'revealed' && b.source === 'p1')).toBe(true)

    // Trap consumed.
    expect(next.zones['mid-river']!.traps).toHaveLength(0)

    // Emits a damage event (kill credit) and a trap_triggered event.
    const dmg = events.find((e) => e._tag === 'damage')
    expect(dmg).toBeDefined()
    expect(dmg!._tag === 'damage' && dmg.sourceId).toBe('p1')
    expect(dmg!._tag === 'damage' && dmg.amount).toBeGreaterThan(0)
    const trig = events.find((e) => e._tag === 'trap_triggered')
    expect(trig).toBeDefined()
    expect(trig!._tag === 'trap_triggered' && trig.targetId).toBe('e1')
  })

  it('leaves the trap armed when no enemy is present', () => {
    const owner = makePlayer({ id: 'p1', team: 'radiant', zone: 'top-river' })
    const state = makeState([owner], [TRAP])

    const { state: next, events } = processTraps(state)

    expect(next.zones['mid-river']!.traps).toHaveLength(1)
    expect(events).toHaveLength(0)
  })

  it('does not trigger on an allied hero', () => {
    const owner = makePlayer({ id: 'p1', team: 'radiant', zone: 'top-river' })
    const ally = makePlayer({ id: 'a1', team: 'radiant', heroId: 'echo', zone: 'mid-river' })
    const state = makeState([owner, ally], [TRAP])

    const { state: next, events } = processTraps(state)

    expect(next.players['a1']!.hp).toBe(ally.hp)
    expect(next.zones['mid-river']!.traps).toHaveLength(1)
    expect(events).toHaveLength(0)
  })

  it('disarms an expired trap without triggering, even with an enemy present', () => {
    const enemy = makePlayer({ id: 'e1', team: 'dire', heroId: 'echo', zone: 'mid-river' })
    const expired: TrapState = { ...TRAP, expiryTick: 10 } // tick === expiryTick → expired
    const state = makeState([enemy], [expired], { tick: 10 })

    const { state: next, events } = processTraps(state)

    expect(next.players['e1']!.hp).toBe(enemy.hp)
    expect(next.zones['mid-river']!.traps).toHaveLength(0)
    expect(events).toHaveLength(0)
  })
})
