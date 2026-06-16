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
    me: { id: 'me', team: 'radiant', zone: 'mid-river' },
    ally: { id: 'ally', team: 'radiant', zone: 'top-river' },
    enemy: { id: 'enemy', team: 'dire', zone: 'bot-river' },
    enemy2: { id: 'enemy2', team: 'dire', zone: 'bot-river' },
  },
} as unknown as GameState

const tpComplete = (playerId: string, destination: string): GameEngineEvent =>
  ({ _tag: 'teleport_complete', tick: 1, playerId, destination }) as GameEngineEvent
const tpCancelled = (playerId: string): GameEngineEvent =>
  ({ _tag: 'teleport_cancelled', tick: 1, playerId, reason: 'damage' }) as GameEngineEvent

describe('isEventVisibleToPlayer — teleport vision gating', () => {
  it('always shows your own and your allies teleports', () => {
    expect(
      isEventVisibleToPlayer(
        tpComplete('me', 'radiant-fountain'),
        'me',
        'radiant',
        new Set(),
        state,
      ),
    ).toBe(true)
    expect(
      isEventVisibleToPlayer(tpComplete('ally', 'dire-base'), 'me', 'radiant', new Set(), state),
    ).toBe(true)
  })

  it('hides an enemy teleport whose destination you cannot see (no rotation leak)', () => {
    const ev = tpComplete('enemy', 'dire-base')
    expect(isEventVisibleToPlayer(ev, 'me', 'radiant', new Set(['mid-river']), state)).toBe(false)
  })

  it('reveals an enemy teleport when you can see where they arrive', () => {
    const ev = tpComplete('enemy', 'mid-river')
    expect(isEventVisibleToPlayer(ev, 'me', 'radiant', new Set(['mid-river']), state)).toBe(true)
  })

  it('hides an enemy teleport_cancelled unless you can see them', () => {
    const ev = tpCancelled('enemy') // enemy is at bot-river
    expect(isEventVisibleToPlayer(ev, 'me', 'radiant', new Set(['mid-river']), state)).toBe(false)
    expect(isEventVisibleToPlayer(ev, 'me', 'radiant', new Set(['bot-river']), state)).toBe(true)
  })

  it('still always shows your own teleport_cancelled', () => {
    expect(isEventVisibleToPlayer(tpCancelled('me'), 'me', 'radiant', new Set(), state)).toBe(true)
  })
})

const neutralKilled = (playerId: string, zone: string): GameEngineEvent =>
  ({
    _tag: 'neutral_killed',
    tick: 1,
    playerId,
    neutralId: 'n0',
    neutralType: 'kobold',
    zone,
  }) as GameEngineEvent
const talentSelected = (playerId: string): GameEngineEvent =>
  ({
    _tag: 'talent_selected',
    tick: 1,
    playerId,
    talentId: 't',
    tier: 10,
    talentName: '+15 Attack',
  }) as GameEngineEvent

describe('isEventVisibleToPlayer — enemy-info leaks', () => {
  it('hides an enemy jungle kill unless you can see the camp', () => {
    const ev = neutralKilled('enemy', 'jungle-dire-bot')
    expect(isEventVisibleToPlayer(ev, 'me', 'radiant', new Set(['mid-river']), state)).toBe(false)
    expect(isEventVisibleToPlayer(ev, 'me', 'radiant', new Set(['jungle-dire-bot']), state)).toBe(
      true,
    )
  })

  it('always shows your own / allied jungle kills (own gold/xp + shared vision)', () => {
    expect(
      isEventVisibleToPlayer(
        neutralKilled('me', 'jungle-rad-top'),
        'me',
        'radiant',
        new Set(),
        state,
      ),
    ).toBe(true)
    expect(
      isEventVisibleToPlayer(
        neutralKilled('ally', 'jungle-rad-bot'),
        'me',
        'radiant',
        new Set(),
        state,
      ),
    ).toBe(true)
  })

  it('hides enemy talent picks (build is private), shows your own and allies', () => {
    expect(isEventVisibleToPlayer(talentSelected('enemy'), 'me', 'radiant', new Set(), state)).toBe(
      false,
    )
    expect(isEventVisibleToPlayer(talentSelected('me'), 'me', 'radiant', new Set(), state)).toBe(
      true,
    )
    expect(isEventVisibleToPlayer(talentSelected('ally'), 'me', 'radiant', new Set(), state)).toBe(
      true,
    )
  })

  it('hides enemy power spikes (decision A: team-private), shows your own and allies', () => {
    const spike = (playerId: string): GameEngineEvent =>
      ({
        _tag: 'power_spike',
        tick: 1,
        playerId,
        spikeType: 'level_6',
        message: 'spike',
      }) as GameEngineEvent
    // Even with vision of the enemy's zone — a spike is build/level info, not a
    // sighting; it leaks only through scouting, never a broadcast.
    expect(
      isEventVisibleToPlayer(spike('enemy'), 'me', 'radiant', new Set(['bot-river']), state),
    ).toBe(false)
    expect(isEventVisibleToPlayer(spike('me'), 'me', 'radiant', new Set(), state)).toBe(true)
    expect(isEventVisibleToPlayer(spike('ally'), 'me', 'radiant', new Set(), state)).toBe(true)
  })
})

// ── Lock the PRE-EXISTING gating too (was a private fn before — untested) ──

const ev = (tag: string, extra: Record<string, unknown>): GameEngineEvent =>
  ({ _tag: tag, tick: 1, ...extra }) as GameEngineEvent
const vis = (e: GameEngineEvent, zones: string[] = []) =>
  isEventVisibleToPlayer(e, 'me', 'radiant', new Set(zones), state)

describe('isEventVisibleToPlayer — global events', () => {
  it('always shows map-wide events regardless of vision', () => {
    for (const tag of ['kill', 'death', 'tower_kill', 'roshan_killed', 'level_up']) {
      expect(vis(ev(tag, {}))).toBe(true)
    }
  })
})

describe('isEventVisibleToPlayer — damage/heal', () => {
  it('shows a hit you are involved in (source or target)', () => {
    expect(
      vis(ev('damage', { sourceId: 'enemy', targetId: 'me', amount: 50, damageType: 'physical' })),
    ).toBe(true)
    expect(
      vis(ev('damage', { sourceId: 'me', targetId: 'enemy', amount: 50, damageType: 'physical' })),
    ).toBe(true)
  })
  it('shows a hit involving a teammate', () => {
    expect(
      vis(
        ev('damage', { sourceId: 'ally', targetId: 'enemy', amount: 50, damageType: 'physical' }),
      ),
    ).toBe(true)
  })
  it('hides an enemy-vs-enemy hit in fog, reveals it when their zone is visible', () => {
    const e = ev('damage', {
      sourceId: 'enemy',
      targetId: 'enemy2',
      amount: 50,
      damageType: 'physical',
    })
    expect(vis(e, ['mid-river'])).toBe(false)
    expect(vis(e, ['bot-river'])).toBe(true)
  })
})

describe('isEventVisibleToPlayer — economy is team-private', () => {
  it('shows your own and allied gold/last-hit/item events, hides the enemy', () => {
    for (const tag of ['creep_lasthit', 'gold_change', 'item_purchased', 'item_sold']) {
      expect(vis(ev(tag, { playerId: 'me' }))).toBe(true)
      expect(vis(ev(tag, { playerId: 'ally' }))).toBe(true)
      expect(vis(ev(tag, { playerId: 'enemy' }))).toBe(false) // even with vision — economy is private
      expect(vis(ev(tag, { playerId: 'enemy' }), ['bot-river'])).toBe(false)
    }
  })
})

describe('isEventVisibleToPlayer — ability / ward / rune', () => {
  it('ability_used: own/ally always, enemy only when their zone is visible', () => {
    expect(vis(ev('ability_used', { playerId: 'me', abilityId: 'q', cooldown: 5 }))).toBe(true)
    expect(vis(ev('ability_used', { playerId: 'ally', abilityId: 'q', cooldown: 5 }))).toBe(true)
    expect(
      vis(ev('ability_used', { playerId: 'enemy', abilityId: 'q', cooldown: 5 }), ['mid-river']),
    ).toBe(false)
    expect(
      vis(ev('ability_used', { playerId: 'enemy', abilityId: 'q', cooldown: 5 }), ['bot-river']),
    ).toBe(true)
  })
  it('ward_placed: own/allied-team always, enemy only when the ward zone is visible', () => {
    expect(
      vis(
        ev('ward_placed', {
          playerId: 'ally',
          zone: 'rune-top',
          team: 'radiant',
          wardType: 'observer',
        }),
      ),
    ).toBe(true)
    expect(
      vis(
        ev('ward_placed', {
          playerId: 'enemy',
          zone: 'rune-bot',
          team: 'dire',
          wardType: 'observer',
        }),
        ['rune-top'],
      ),
    ).toBe(false)
    expect(
      vis(
        ev('ward_placed', {
          playerId: 'enemy',
          zone: 'rune-bot',
          team: 'dire',
          wardType: 'observer',
        }),
        ['rune-bot'],
      ),
    ).toBe(true)
  })
  it('rune_picked: own always, otherwise only when the rune zone is visible', () => {
    expect(vis(ev('rune_picked', { playerId: 'me', zone: 'rune-top' }))).toBe(true)
    expect(vis(ev('rune_picked', { playerId: 'enemy', zone: 'rune-bot' }), ['rune-top'])).toBe(
      false,
    )
    expect(vis(ev('rune_picked', { playerId: 'enemy', zone: 'rune-bot' }), ['rune-bot'])).toBe(true)
  })
})
