import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  addSpectator,
  removeSpectator,
  getSpectatorsOfGame,
  spectatorCount,
  clearGameSpectators,
  _resetSpectatorRegistry,
} from '../../../server/services/SpectatorRegistry'

function makePeer() {
  return { send: vi.fn() }
}

beforeEach(() => {
  _resetSpectatorRegistry()
})

describe('SpectatorRegistry', () => {
  it('adds a spectator and finds them by gameId', () => {
    const peer = makePeer()
    addSpectator('alice', 'game_1', peer)
    expect(spectatorCount('game_1')).toBe(1)
    expect(getSpectatorsOfGame('game_1')).toEqual([peer])
  })

  it('returns empty for a game with no spectators', () => {
    expect(getSpectatorsOfGame('nobody')).toEqual([])
    expect(spectatorCount('nobody')).toBe(0)
  })

  it('removes a spectator by id', () => {
    addSpectator('alice', 'game_1', makePeer())
    addSpectator('bob', 'game_1', makePeer())
    expect(spectatorCount('game_1')).toBe(2)

    removeSpectator('alice')
    expect(spectatorCount('game_1')).toBe(1)
  })

  it('replacing an existing spectator moves them between games', () => {
    const p1 = makePeer()
    const p2 = makePeer()

    addSpectator('alice', 'game_a', p1)
    expect(getSpectatorsOfGame('game_a')).toEqual([p1])

    // Same id, different game + new peer
    addSpectator('alice', 'game_b', p2)
    expect(getSpectatorsOfGame('game_a')).toEqual([])
    expect(getSpectatorsOfGame('game_b')).toEqual([p2])
  })

  it('clearGameSpectators drops everyone watching a game', () => {
    addSpectator('alice', 'game_1', makePeer())
    addSpectator('bob', 'game_1', makePeer())
    addSpectator('carol', 'game_2', makePeer())

    clearGameSpectators('game_1')

    expect(spectatorCount('game_1')).toBe(0)
    expect(spectatorCount('game_2')).toBe(1)
  })

  it('isolates spectators across games', () => {
    addSpectator('alice', 'game_a', makePeer())
    addSpectator('bob', 'game_b', makePeer())

    expect(spectatorCount('game_a')).toBe(1)
    expect(spectatorCount('game_b')).toBe(1)
    expect(getSpectatorsOfGame('game_a')).toHaveLength(1)
    expect(getSpectatorsOfGame('game_b')).toHaveLength(1)
  })

  it('removeSpectator is a no-op for an unknown id', () => {
    expect(() => removeSpectator('ghost')).not.toThrow()
  })
})
