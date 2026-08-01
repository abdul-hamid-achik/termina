/**
 * Vision gating for broadcast events (server/plugins/game-server.ts).
 * isEventVisibleToPlayer is the per-player filter onEvents runs before sending
 * the combat feed. Teleports must NOT leak an enemy's destination/rotation to
 * the other team — they were `default: return true` (visible to everyone) before.
 *
 * game-server.ts calls defineNitroPlugin at module eval, so stub it before import.
 */
import { describe, it, expect, vi } from 'vitest'
import type { GameState } from '~~/shared/types/game'
import type { GameEngineEvent } from '~~/server/game/protocol/events'

vi.stubGlobal('defineNitroPlugin', (fn: unknown) => fn)

const { isEventVisibleToPlayer } = await import('~~/server/plugins/game-server')

const state = {
  players: {
    me: { id: 'me', team: 'chaff', zone: 'coldstore-cross' },
    ally: { id: 'ally', team: 'chaff', zone: 'seawall-cross' },
    enemy: { id: 'enemy', team: 'audit', zone: 'shallows-cross' },
    enemy2: { id: 'enemy2', team: 'audit', zone: 'shallows-cross' },
  },
} as unknown as GameState

const tpComplete = (playerId: string, destination: string): GameEngineEvent =>
  ({ _tag: 'teleport_complete', cycle: 1, playerId, destination }) as GameEngineEvent
const tpCancelled = (playerId: string): GameEngineEvent =>
  ({ _tag: 'teleport_cancelled', cycle: 1, playerId, reason: 'damage' }) as GameEngineEvent

describe('isEventVisibleToPlayer — teleport vision gating', () => {
  it('always shows your own and your allies teleports', () => {
    expect(
      isEventVisibleToPlayer(tpComplete('me', 'rookery-anchor'), 'me', 'chaff', new Set(), state),
    ).toBe(true)
    expect(
      isEventVisibleToPlayer(
        tpComplete('ally', 'landing-terminal'),
        'me',
        'chaff',
        new Set(),
        state,
      ),
    ).toBe(true)
  })

  it('hides an enemy teleport whose destination you cannot see (no rotation leak)', () => {
    const ev = tpComplete('enemy', 'landing-terminal')
    expect(isEventVisibleToPlayer(ev, 'me', 'chaff', new Set(['coldstore-cross']), state)).toBe(
      false,
    )
  })

  it('reveals an enemy teleport when you can see where they arrive', () => {
    const ev = tpComplete('enemy', 'coldstore-cross')
    expect(isEventVisibleToPlayer(ev, 'me', 'chaff', new Set(['coldstore-cross']), state)).toBe(
      true,
    )
  })

  it('hides an enemy teleport_cancelled unless you can see them', () => {
    const ev = tpCancelled('enemy') // enemy is at shallows-cross
    expect(isEventVisibleToPlayer(ev, 'me', 'chaff', new Set(['coldstore-cross']), state)).toBe(
      false,
    )
    expect(isEventVisibleToPlayer(ev, 'me', 'chaff', new Set(['shallows-cross']), state)).toBe(true)
  })

  it('still always shows your own teleport_cancelled', () => {
    expect(isEventVisibleToPlayer(tpCancelled('me'), 'me', 'chaff', new Set(), state)).toBe(true)
  })
})

const neutralKilled = (playerId: string, zone: string): GameEngineEvent =>
  ({
    _tag: 'neutral_killed',
    cycle: 1,
    playerId,
    neutralId: 'n0',
    neutralType: 'stub',
    zone,
  }) as GameEngineEvent
const talentSelected = (playerId: string): GameEngineEvent =>
  ({
    _tag: 'talent_selected',
    cycle: 1,
    playerId,
    talentId: 't',
    tier: 10,
    talentName: '+15 Attack',
  }) as GameEngineEvent

describe('isEventVisibleToPlayer — enemy-info leaks', () => {
  it('hides an enemy jungle kill unless you can see the camp', () => {
    const ev = neutralKilled('enemy', 'silt-audit-lower')
    expect(isEventVisibleToPlayer(ev, 'me', 'chaff', new Set(['coldstore-cross']), state)).toBe(
      false,
    )
    expect(isEventVisibleToPlayer(ev, 'me', 'chaff', new Set(['silt-audit-lower']), state)).toBe(
      true,
    )
  })

  it('always shows your own / allied jungle kills (own scrip/xp + shared vision)', () => {
    expect(
      isEventVisibleToPlayer(
        neutralKilled('me', 'silt-chaff-upper'),
        'me',
        'chaff',
        new Set(),
        state,
      ),
    ).toBe(true)
    expect(
      isEventVisibleToPlayer(
        neutralKilled('ally', 'silt-chaff-lower'),
        'me',
        'chaff',
        new Set(),
        state,
      ),
    ).toBe(true)
  })

  it('hides enemy talent picks (build is private), shows your own and allies', () => {
    expect(isEventVisibleToPlayer(talentSelected('enemy'), 'me', 'chaff', new Set(), state)).toBe(
      false,
    )
    expect(isEventVisibleToPlayer(talentSelected('me'), 'me', 'chaff', new Set(), state)).toBe(true)
    expect(isEventVisibleToPlayer(talentSelected('ally'), 'me', 'chaff', new Set(), state)).toBe(
      true,
    )
  })

  it('hides enemy power spikes (decision A: team-private), shows your own and allies', () => {
    const spike = (playerId: string): GameEngineEvent =>
      ({
        _tag: 'power_spike',
        cycle: 1,
        playerId,
        spikeType: 'level_6',
        message: 'spike',
      }) as GameEngineEvent
    // Even with vision of the enemy's zone — a spike is build/level info, not a
    // sighting; it leaks only through scouting, never a broadcast.
    expect(
      isEventVisibleToPlayer(spike('enemy'), 'me', 'chaff', new Set(['shallows-cross']), state),
    ).toBe(false)
    expect(isEventVisibleToPlayer(spike('me'), 'me', 'chaff', new Set(), state)).toBe(true)
    expect(isEventVisibleToPlayer(spike('ally'), 'me', 'chaff', new Set(), state)).toBe(true)
  })
})

// ── Lock the PRE-EXISTING gating too (was a private fn before — untested) ──

const ev = (tag: string, extra: Record<string, unknown>): GameEngineEvent =>
  ({ _tag: tag, cycle: 1, ...extra }) as GameEngineEvent
const vis = (e: GameEngineEvent, zones: string[] = []) =>
  isEventVisibleToPlayer(e, 'me', 'chaff', new Set(zones), state)

describe('isEventVisibleToPlayer — global events', () => {
  it('always shows map-wide events regardless of vision', () => {
    for (const tag of ['kill', 'death', 'ice_kill', 'tenant_killed', 'level_up']) {
      expect(vis(ev(tag, {}))).toBe(true)
    }
  })
})

describe('isEventVisibleToPlayer — damage/heal', () => {
  it('shows a hit you are involved in (source or target)', () => {
    expect(
      vis(ev('damage', { sourceId: 'enemy', targetId: 'me', amount: 50, damageType: 'kinetic' })),
    ).toBe(true)
    expect(
      vis(ev('damage', { sourceId: 'me', targetId: 'enemy', amount: 50, damageType: 'kinetic' })),
    ).toBe(true)
  })
  it('shows a hit involving a teammate', () => {
    expect(
      vis(ev('damage', { sourceId: 'ally', targetId: 'enemy', amount: 50, damageType: 'kinetic' })),
    ).toBe(true)
  })
  it('hides an enemy-vs-enemy hit in fog, reveals it when their zone is visible', () => {
    const e = ev('damage', {
      sourceId: 'enemy',
      targetId: 'enemy2',
      amount: 50,
      damageType: 'kinetic',
    })
    expect(vis(e, ['coldstore-cross'])).toBe(false)
    expect(vis(e, ['shallows-cross'])).toBe(true)
  })
})

describe('isEventVisibleToPlayer — economy is team-private', () => {
  it('shows your own and allied scrip/last-hit/item events, hides the enemy', () => {
    for (const tag of ['wave_strip', 'scrip_change', 'item_purchased', 'item_sold']) {
      expect(vis(ev(tag, { playerId: 'me' }))).toBe(true)
      expect(vis(ev(tag, { playerId: 'ally' }))).toBe(true)
      expect(vis(ev(tag, { playerId: 'enemy' }))).toBe(false) // even with vision — economy is private
      expect(vis(ev(tag, { playerId: 'enemy' }), ['shallows-cross'])).toBe(false)
    }
  })
})

describe('isEventVisibleToPlayer — ability / ward / cache', () => {
  it('ability_used: own/ally always, enemy only when their zone is visible', () => {
    expect(vis(ev('ability_used', { playerId: 'me', abilityId: 'q', cooldown: 5 }))).toBe(true)
    expect(vis(ev('ability_used', { playerId: 'ally', abilityId: 'q', cooldown: 5 }))).toBe(true)
    expect(
      vis(ev('ability_used', { playerId: 'enemy', abilityId: 'q', cooldown: 5 }), [
        'coldstore-cross',
      ]),
    ).toBe(false)
    expect(
      vis(ev('ability_used', { playerId: 'enemy', abilityId: 'q', cooldown: 5 }), [
        'shallows-cross',
      ]),
    ).toBe(true)
  })
  it('ward_placed: own/allied-team always, enemy only when the ward zone is visible', () => {
    expect(
      vis(
        ev('ward_placed', {
          playerId: 'ally',
          zone: 'cache-seawall',
          team: 'chaff',
          wardType: 'camtap',
        }),
      ),
    ).toBe(true)
    expect(
      vis(
        ev('ward_placed', {
          playerId: 'enemy',
          zone: 'cache-shallows',
          team: 'audit',
          wardType: 'camtap',
        }),
        ['cache-seawall'],
      ),
    ).toBe(false)
    expect(
      vis(
        ev('ward_placed', {
          playerId: 'enemy',
          zone: 'cache-shallows',
          team: 'audit',
          wardType: 'camtap',
        }),
        ['cache-shallows'],
      ),
    ).toBe(true)
  })
  it('cache_picked: own always, otherwise only when the cache zone is visible', () => {
    expect(vis(ev('cache_picked', { playerId: 'me', zone: 'cache-seawall' }))).toBe(true)
    expect(
      vis(ev('cache_picked', { playerId: 'enemy', zone: 'cache-shallows' }), ['cache-seawall']),
    ).toBe(false)
    expect(
      vis(ev('cache_picked', { playerId: 'enemy', zone: 'cache-shallows' }), ['cache-shallows']),
    ).toBe(true)
  })
})

describe('status_applied obeys the same fog rule as damage', () => {
  // REGRESSION: status_applied was added to the union without a case here, so it
  // fell through `default: return true` and announced every disable in the match
  // to all ten players — while the `ability_used` that caused it was correctly
  // hidden. Same payload shape, same information, same rule.
  const cc = (sourceId: string, targetId: string): GameEngineEvent =>
    ({
      _tag: 'status_applied',
      cycle: 1,
      sourceId,
      targetId,
      status: 'stun',
      cyclesRemaining: 2,
    }) as GameEngineEvent

  it('shows a disable involving me or my team', () => {
    expect(isEventVisibleToPlayer(cc('enemy', 'me'), 'me', 'chaff', new Set(), state)).toBe(true)
    expect(isEventVisibleToPlayer(cc('enemy', 'ally'), 'me', 'chaff', new Set(), state)).toBe(true)
  })

  it('hides an enemy-on-enemy disable I have no vision on', () => {
    expect(isEventVisibleToPlayer(cc('enemy', 'enemy2'), 'me', 'chaff', new Set(), state)).toBe(
      false,
    )
  })

  it('shows an enemy-on-enemy disable in a zone I can see', () => {
    expect(
      isEventVisibleToPlayer(
        cc('enemy', 'enemy2'),
        'me',
        'chaff',
        new Set(['shallows-cross']),
        state,
      ),
    ).toBe(true)
  })
})
