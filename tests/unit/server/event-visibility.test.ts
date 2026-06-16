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
})
