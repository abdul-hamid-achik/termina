import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  registerPeer,
  unregisterPeer,
  sendToPeer,
  setPlayerGame,
  getPlayerGame,
  clearPlayerGame,
} from '../../../server/services/PeerRegistry'
import { peerLog } from '../../../server/utils/log'

// ── Helpers ────────────────────────────────────────────────────────

function makePeer() {
  return { send: vi.fn() }
}

function makeRawWs() {
  return { send: vi.fn() }
}

// ── Tests ──────────────────────────────────────────────────────────

describe('PeerRegistry', () => {
  // Track registered players for cleanup
  const registered: Array<{ playerId: string; peer: ReturnType<typeof makePeer> }> = []

  afterEach(() => {
    // Clean up all registered peers
    for (const { playerId, peer } of registered) {
      unregisterPeer(playerId, peer)
    }
    registered.length = 0
  })

  describe('registerPeer / unregisterPeer', () => {
    it('registers a peer and allows sending', () => {
      const peer = makePeer()
      const rawWs = makeRawWs()
      registerPeer('p1', peer, rawWs)
      registered.push({ playerId: 'p1', peer })

      sendToPeer('p1', { type: 'test' })
      // crossws peer is used as primary send path
      expect(peer.send).toHaveBeenCalledWith(JSON.stringify({ type: 'test' }))
    })

    it('unregisters a peer so sending drops the message', () => {
      const peer = makePeer()
      registerPeer('p2', peer, makeRawWs())
      unregisterPeer('p2', peer)
      // No need to track — already unregistered

      const warnSpy = vi.spyOn(peerLog, 'warn').mockImplementation(() => {})
      sendToPeer('p2', { type: 'test' })
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('falls back to crossws peer when rawWs is null', () => {
      const peer = makePeer()
      registerPeer('p3', peer, null)
      registered.push({ playerId: 'p3', peer })

      sendToPeer('p3', { type: 'fallback' })
      expect(peer.send).toHaveBeenCalledWith(JSON.stringify({ type: 'fallback' }))
    })

    it('falls back to crossws peer when rawWs is undefined', () => {
      const peer = makePeer()
      registerPeer('p4', peer, undefined)
      registered.push({ playerId: 'p4', peer })

      sendToPeer('p4', { type: 'undef' })
      expect(peer.send).toHaveBeenCalledWith(JSON.stringify({ type: 'undef' }))
    })
  })

  describe('race condition prevention', () => {
    it('does NOT remove new peer when old peer unregisters', () => {
      // Simulate the lobby→game transition race:
      // 1. Old lobby socket connects
      const oldPeer = makePeer()
      const oldRawWs = makeRawWs()
      registerPeer('player1', oldPeer, oldRawWs)

      // 2. New game socket connects (replaces old in registry)
      const newPeer = makePeer()
      const newRawWs = makeRawWs()
      registerPeer('player1', newPeer, newRawWs)
      registered.push({ playerId: 'player1', peer: newPeer })

      // 3. Old lobby socket closes — its close handler calls unregisterPeer
      unregisterPeer('player1', oldPeer)

      // 4. New peer should still be registered and messages should deliver
      sendToPeer('player1', { type: 'tick_state', tick: 1 })
      expect(newPeer.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'tick_state', tick: 1 }),
      )
      expect(oldPeer.send).not.toHaveBeenCalled()
    })

    it('removes peer when the same peer unregisters', () => {
      const peer = makePeer()
      registerPeer('player2', peer, makeRawWs())
      unregisterPeer('player2', peer)

      const warnSpy = vi.spyOn(peerLog, 'warn').mockImplementation(() => {})
      sendToPeer('player2', { type: 'test' })
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('handles rapid re-registration (reconnect scenario)', () => {
      const peer1 = makePeer()
      const rawWs1 = makeRawWs()
      registerPeer('player3', peer1, rawWs1)

      // Player disconnects and reconnects quickly
      const peer2 = makePeer()
      const rawWs2 = makeRawWs()
      registerPeer('player3', peer2, rawWs2)
      registered.push({ playerId: 'player3', peer: peer2 })

      // Old close fires
      unregisterPeer('player3', peer1)

      // New peer is still active
      sendToPeer('player3', { type: 'reconnected' })
      expect(peer2.send).toHaveBeenCalledWith(JSON.stringify({ type: 'reconnected' }))
      expect(peer1.send).not.toHaveBeenCalled()
    })
  })

  describe('sendToPeer', () => {
    it('serializes message as JSON', () => {
      const rawWs = makeRawWs()
      const peer = makePeer()
      registerPeer('p5', peer, rawWs)
      registered.push({ playerId: 'p5', peer })

      sendToPeer('p5', { type: 'tick_state', tick: 42, state: { hp: 100 } })
      // crossws peer is the primary send path
      expect(peer.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'tick_state', tick: 42, state: { hp: 100 } }),
      )
    })

    it('falls back to rawWs when crossws peer.send throws', () => {
      const rawWs = makeRawWs()
      const peer = makePeer()
      peer.send.mockImplementation(() => { throw new Error('peer failed') })
      registerPeer('p6', peer, rawWs)
      registered.push({ playerId: 'p6', peer })

      sendToPeer('p6', { type: 'test' })
      expect(rawWs.send).toHaveBeenCalledWith(JSON.stringify({ type: 'test' }))
    })

    it('warns when both crossws peer and rawWs fail', () => {
      const peer = makePeer()
      peer.send.mockImplementation(() => { throw new Error('peer failed') })
      const rawWs = makeRawWs()
      rawWs.send.mockImplementation(() => { throw new Error('rawWs failed') })
      registerPeer('p7', peer, rawWs)
      registered.push({ playerId: 'p7', peer })

      const warnSpy = vi.spyOn(peerLog, 'warn').mockImplementation(() => {})
      sendToPeer('p7', { type: 'critical' })
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('warns when no peer is registered', () => {
      const warnSpy = vi.spyOn(peerLog, 'warn').mockImplementation(() => {})
      sendToPeer('nonexistent', { type: 'lost' })
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })
  })

  describe('playerGame tracking', () => {
    afterEach(() => {
      clearPlayerGame('pg1')
      clearPlayerGame('pg2')
    })

    it('stores and retrieves player game', () => {
      setPlayerGame('pg1', 'game_123')
      expect(getPlayerGame('pg1')).toBe('game_123')
    })

    it('returns undefined for unknown player', () => {
      expect(getPlayerGame('unknown')).toBeUndefined()
    })

    it('clears player game', () => {
      setPlayerGame('pg2', 'game_456')
      clearPlayerGame('pg2')
      expect(getPlayerGame('pg2')).toBeUndefined()
    })

    it('overwrites previous game mapping', () => {
      setPlayerGame('pg1', 'game_old')
      setPlayerGame('pg1', 'game_new')
      expect(getPlayerGame('pg1')).toBe('game_new')
    })
  })
})
