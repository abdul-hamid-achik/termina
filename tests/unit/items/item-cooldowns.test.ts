import { describe, it, expect } from 'vitest'
import { Effect, Exit } from 'effect'
import { useItem, itemCooldownId } from '~~/server/game/items/shop'
import { validateAction } from '~~/server/game/engine/ActionResolver'
import { ITEMS } from '~~/shared/constants/items'
import type { GameState, PlayerState, ZoneRuntimeState } from '~~/shared/types/game'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'P1',
    team: 'chaff',
    heroId: 'echo',
    zone: 'coldstore-cross',
    integ: 500,
    maxInteg: 500,
    bw: 300,
    maxBw: 300,
    level: 1,
    xp: 0,
    scrip: 0,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnCycle: null,
    plate: 5,
    ice: 5,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    iceDamageDealt: 0,
    killStreak: 0,
    ...overrides,
  } as PlayerState
}

const zone = (id: string): ZoneRuntimeState => ({ id, wards: [] })

function makeState(players: Record<string, PlayerState>, cycle = 40): GameState {
  return {
    cycle,
    phase: 'playing',
    teams: {
      chaff: { id: 'chaff', kills: 0, iceKills: 0, scrip: 0 },
      audit: { id: 'audit', kills: 0, iceKills: 0, scrip: 0 },
    },
    players,
    zones: {
      'rookery-anchor': zone('rookery-anchor'),
      'rookery-terminal': zone('rookery-terminal'),
      'coldstore-t1-chaff': zone('coldstore-t1-chaff'),
      'coldstore-cross': zone('coldstore-cross'),
      'coldstore-t1-audit': zone('coldstore-t1-audit'),
    },
    waves: [],
    ice: [],
    events: [],
  } as unknown as GameState
}

// Every cooldown-bearing active, with the target shape it needs.
const ENEMY = { kind: 'hero' as const, name: 'enemy_1' }
const ALLY = { kind: 'hero' as const, name: 'ally_1' }
const CASES: Array<[string, unknown]> = [
  ['jump_shunt', 'coldstore-t1-chaff'],
  ['shove_splice', ALLY],
  ['kickback_splice', ENEMY],
  ['ghostwire_edge', undefined],
  ['burnout', ENEMY],
  ['phase_shim', ENEMY],
  ['ablative_shell', undefined],
  ['hardshell', undefined],
  ['spite_plate', undefined],
  ['phase_shunt', undefined],
  ['mirror_shell', ALLY],
  ['stack_overflow', undefined],
  ['redline_splice', undefined],
  ['stasis_shunt', ALLY],
  ['lockout_shunt', ENEMY],
  ['discord_routine', undefined],
  ['cryo_routine', undefined],
]

function setup(itemId: string): GameState {
  return makeState({
    p1: makePlayer({ id: 'p1', items: [itemId, null, null, null, null, null] }),
    ally_1: makePlayer({ id: 'ally_1', name: 'ally_1' }),
    enemy_1: makePlayer({ id: 'enemy_1', name: 'enemy_1', team: 'audit' }),
  })
}

describe('item active cooldowns are keyed by the real item id', () => {
  it('itemCooldownId is item_cd_<id>', () => {
    expect(itemCooldownId('hardshell')).toBe('item_cd_hardshell')
  })

  it.each(CASES)('%s writes item_cd_<itemId> on the caster and re-use is refused', (itemId, t) => {
    expect(ITEMS[itemId]?.active).toBeDefined()
    const state = setup(itemId)
    const exit = Effect.runSyncExit(useItem(state, 'p1', itemId, t as never))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (!Exit.isSuccess(exit)) return
    const next = exit.value
    const cds = next.players['p1']!.buffs.filter((b) => b.id.startsWith('item_cd_'))
    expect(cds.map((b) => b.id)).toEqual([`item_cd_${itemId}`])
    expect(cds[0]!.cyclesRemaining).toBeGreaterThan(0)

    // validateAction (what GameLoop uses) and useItem both refuse the second use.
    // (Movement items may have moved the caster, which is fine for validation of cooldown.)
    expect(
      validateAction(next, { playerId: 'p1', command: { type: 'use', item: itemId } as never }),
    ).toBe('Item on cooldown')
    const again = Effect.runSyncExit(useItem(next, 'p1', itemId, t as never))
    expect(Exit.isFailure(again)).toBe(true)
  })
})
