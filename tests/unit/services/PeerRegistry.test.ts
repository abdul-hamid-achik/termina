import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  registerPeer,
  unregisterPeer,
  sendToPeer,
  setPlayerGame,
  getPlayerGame,
  clearPlayerGame,
} from '~~/server/services/PeerRegistry'
import { peerLog } from '~~/server/utils/log'

function makePeer() {
  return { send: vi.fn(), close: vi.fn() }
}

function makeRawWs() {
  return { send: vi.fn() }
}

describe('PeerRegistry', () => {
  const registered: Array<{ playerId: string; peer: ReturnType<typeof makePeer> }> = []

  afterEach(() => {
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
      expect(peer.send).toHaveBeenCalledWith(JSON.stringify({ type: 'test' }))
    })

    it('unregisters a peer so sending drops the message', () => {
      const peer = makePeer()
      registerPeer('p2', peer, makeRawWs())
      unregisterPeer('p2', peer)

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
      const oldPeer = makePeer()
      const oldRawWs = makeRawWs()
      registerPeer('player1', oldPeer, oldRawWs)

      const newPeer = makePeer()
      const newRawWs = makeRawWs()
      registerPeer('player1', newPeer, newRawWs)
      registered.push({ playerId: 'player1', peer: newPeer })

      unregisterPeer('player1', oldPeer)

      sendToPeer('player1', { type: 'cycle_state', cycle: 1 })
      expect(newPeer.send).toHaveBeenCalledWith(JSON.stringify({ type: 'cycle_state', cycle: 1 }))
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

      const peer2 = makePeer()
      const rawWs2 = makeRawWs()
      registerPeer('player3', peer2, rawWs2)
      registered.push({ playerId: 'player3', peer: peer2 })

      unregisterPeer('player3', peer1)

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

      sendToPeer('p5', { type: 'cycle_state', cycle: 42, state: { integ: 100 } })
      expect(peer.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'cycle_state', cycle: 42, state: { integ: 100 } }),
      )
    })

    it('falls back to rawWs when crossws peer.send throws', () => {
      const rawWs = makeRawWs()
      const peer = makePeer()
      peer.send.mockImplementation(() => {
        throw new Error('peer failed')
      })
      registerPeer('p6', peer, rawWs)
      registered.push({ playerId: 'p6', peer })

      sendToPeer('p6', { type: 'test' })
      expect(rawWs.send).toHaveBeenCalledWith(JSON.stringify({ type: 'test' }))
    })

    it('warns when both crossws peer and rawWs fail', () => {
      const peer = makePeer()
      peer.send.mockImplementation(() => {
        throw new Error('peer failed')
      })
      const rawWs = makeRawWs()
      rawWs.send.mockImplementation(() => {
        throw new Error('rawWs failed')
      })
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

    it('returns true when send succeeds', () => {
      const peer = makePeer()
      registerPeer('p8', peer, makeRawWs())
      registered.push({ playerId: 'p8', peer })

      const result = sendToPeer('p8', { type: 'test' })
      expect(result).toBe(true)
    })

    it('returns true when fallback send succeeds', () => {
      const peer = makePeer()
      peer.send.mockImplementation(() => {
        throw new Error('peer failed')
      })
      const rawWs = makeRawWs()
      registerPeer('p9', peer, rawWs)
      registered.push({ playerId: 'p9', peer })

      const result = sendToPeer('p9', { type: 'test' })
      expect(result).toBe(true)
    })

    it('returns false when no peer is registered', () => {
      const warnSpy = vi.spyOn(peerLog, 'warn').mockImplementation(() => {})
      const result = sendToPeer('nonexistent', { type: 'test' })
      expect(result).toBe(false)
      warnSpy.mockRestore()
    })

    it('returns false when both sends fail', () => {
      const peer = makePeer()
      peer.send.mockImplementation(() => {
        throw new Error('peer failed')
      })
      const rawWs = makeRawWs()
      rawWs.send.mockImplementation(() => {
        throw new Error('rawWs failed')
      })
      registerPeer('p10', peer, rawWs)
      registered.push({ playerId: 'p10', peer })

      const warnSpy = vi.spyOn(peerLog, 'warn').mockImplementation(() => {})
      const result = sendToPeer('p10', { type: 'test' })
      expect(result).toBe(false)
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

  // Owner audit item 2b: a superseded peer must not linger — it can still
  // deliver stale game state, and its later close() must not be mistaken for
  // THE disconnect by ws.ts's isCurrentPeer check.
  describe('registerPeer closes a superseded connection', () => {
    it('closes the OLD peer when a second connection registers for the same player', () => {
      const oldPeer = makePeer()
      registerPeer('p_super', oldPeer, makeRawWs())

      const newPeer = makePeer()
      registerPeer('p_super', newPeer, makeRawWs())
      registered.push({ playerId: 'p_super', peer: newPeer })

      expect(oldPeer.close).toHaveBeenCalledWith(4009, expect.any(String))
      expect(newPeer.close).not.toHaveBeenCalled()
    })

    it('does not close anything on a FIRST registration (no prior peer)', () => {
      const peer = makePeer()
      registerPeer('p_first', peer, makeRawWs())
      registered.push({ playerId: 'p_first', peer })

      expect(peer.close).not.toHaveBeenCalled()
    })

    it('does not close when re-registering the SAME peer object', () => {
      const peer = makePeer()
      registerPeer('p_same', peer, makeRawWs())
      registerPeer('p_same', peer, makeRawWs())
      registered.push({ playerId: 'p_same', peer })

      expect(peer.close).not.toHaveBeenCalled()
    })

    it('tolerates a superseded peer with no close() method (fakes/mocks)', () => {
      const oldPeer = { send: vi.fn() } // no `.close` at all
      registerPeer('p_noclose', oldPeer, makeRawWs())

      const newPeer = makePeer()
      expect(() => registerPeer('p_noclose', newPeer, makeRawWs())).not.toThrow()
      registered.push({ playerId: 'p_noclose', peer: newPeer })
    })

    it('swallows a throwing close() rather than letting registerPeer fail', () => {
      const oldPeer = makePeer()
      oldPeer.close.mockImplementation(() => {
        throw new Error('already closed')
      })
      registerPeer('p_throwclose', oldPeer, makeRawWs())

      const warnSpy = vi.spyOn(peerLog, 'warn').mockImplementation(() => {})
      const newPeer = makePeer()
      expect(() => registerPeer('p_throwclose', newPeer, makeRawWs())).not.toThrow()
      registered.push({ playerId: 'p_throwclose', peer: newPeer })
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })
  })

  // Owner audit item 3: a send failure must drop only the dead peer, never
  // the player→game assignment — that assignment is what `reconnect` checks
  // inside the 60s grace window (see ws.ts). MUTATION-CHECKED: see the report.
  describe('sendToPeer failure scope (item 3)', () => {
    afterEach(() => {
      clearPlayerGame('p_deadsend')
    })

    it('drops the dead peer but preserves the player→game assignment', () => {
      const peer = makePeer()
      peer.send.mockImplementation(() => {
        throw new Error('peer failed')
      })
      const rawWs = makeRawWs()
      rawWs.send.mockImplementation(() => {
        throw new Error('rawWs failed')
      })
      registerPeer('p_deadsend', peer, rawWs)
      setPlayerGame('p_deadsend', 'game_grace')

      const warnSpy = vi.spyOn(peerLog, 'warn').mockImplementation(() => {})
      const result = sendToPeer('p_deadsend', { type: 'test' })
      warnSpy.mockRestore()

      expect(result).toBe(false)
      // The peer itself IS gone (a fresh sendToPeer would warn "no peer found").
      const warnSpy2 = vi.spyOn(peerLog, 'warn').mockImplementation(() => {})
      sendToPeer('p_deadsend', { type: 'test2' })
      expect(warnSpy2).toHaveBeenCalled()
      warnSpy2.mockRestore()
      // But the game assignment survives — reconnect() must still find it
      // inside the grace window.
      expect(getPlayerGame('p_deadsend')).toBe('game_grace')
    })
  })
})
