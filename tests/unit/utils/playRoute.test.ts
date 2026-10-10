import { describe, it, expect, vi } from 'vitest'
import {
  adoptPlayRoute,
  GUEST_SESSION_CHANGED_MESSAGE,
  SESSION_CHANGED_MESSAGE,
} from '~~/app/utils/playRoute'

function store(gameId: string | null, playerId: string | null) {
  const s = {
    gameId,
    playerId,
    ended: null as { message: string; reason?: string } | null,
    reset: vi.fn(() => {
      s.gameId = null
      s.ended = null
    }),
    endSession: vi.fn((message: string, reason?: 'finished' | 'changed') => {
      s.ended = { message, reason }
    }),
  }
  return s
}

/**
 * Playtest 3: after a guest signed in on another tab, [NEW PRACTICE] opened
 * /play?gameId=<new>&playerId=guest_… and the screen subscribed as the guest —
 * Ably refused the channel (40160). /play names the player from the SESSION.
 */
describe('adoptPlayRoute', () => {
  it('opens a tutorial URL whose player is the session player', () => {
    const s = store(null, 'guest_old')
    const ok = adoptPlayRoute(s, { tutorial: '1', gameId: 'g2', playerId: 'github_7' }, 'github_7')
    expect(ok).toBe(true)
    expect(s.gameId).toBe('g2')
    expect(s.playerId).toBe('github_7')
    expect(s.endSession).not.toHaveBeenCalled()
  })

  // Round-4 review: reloading an old guest-practice URL after signing in
  // elsewhere subscribed the ACCOUNT's channel to the guest's game and hung.
  it('a URL naming another player ends the session as changed, at once', () => {
    const s = store(null, null)
    const ok = adoptPlayRoute(
      s,
      { tutorial: '1', gameId: 'g_guest', playerId: 'guest_old' },
      'github_7',
    )
    expect(ok).toBe(true) // the screen mounts — to show the panel
    expect(s.ended).toEqual({ message: GUEST_SESSION_CHANGED_MESSAGE, reason: 'changed' })
  })

  it('…after dropping a previous game (reset would otherwise clear the panel)', () => {
    const s = store('g_dead', 'github_7')
    adoptPlayRoute(s, { tutorial: '1', gameId: 'g_other', playerId: 'github_9' }, 'github_7')
    expect(s.reset).toHaveBeenCalledOnce()
    expect(s.ended).toEqual({ message: SESSION_CHANGED_MESSAGE, reason: 'changed' })
  })

  it('falls back to the URL player when the session has no id yet', () => {
    const s = store(null, null)
    adoptPlayRoute(s, { tutorial: '1', gameId: 'g2', playerId: 'p1' }, undefined)
    expect(s.playerId).toBe('p1')
  })

  it('drops the previous game before opening a different one', () => {
    const s = store('g_dead', 'guest_old')
    adoptPlayRoute(s, { tutorial: '1', gameId: 'g2' }, 'github_7')
    expect(s.reset).toHaveBeenCalledOnce()
    expect(s.gameId).toBe('g2')
  })

  it('keeps the store when the URL names the game already open', () => {
    const s = store('g2', 'github_7')
    adoptPlayRoute(s, { tutorial: '1', gameId: 'g2' }, 'github_7')
    expect(s.reset).not.toHaveBeenCalled()
  })

  it('re-keys a lobby-found game opened under a stale id', () => {
    const s = store('g_live', 'guest_old')
    expect(adoptPlayRoute(s, {}, 'github_7')).toBe(true)
    expect(s.playerId).toBe('github_7')
  })

  it('reports nothing to open without a game', () => {
    expect(adoptPlayRoute(store(null, 'github_7'), {}, 'github_7')).toBe(false)
  })
})
