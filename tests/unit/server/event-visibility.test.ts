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
