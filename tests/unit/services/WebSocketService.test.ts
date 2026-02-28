import { describe, it, expect, vi } from 'vitest'
import { Effect } from 'effect'
import {
  WebSocketService,
  WebSocketServiceLive,
} from '../../../server/services/WebSocketService'
import { wsLog } from '../../../server/utils/log'

// ── Helpers ────────────────────────────────────────────────────────

function makeTestWs() {
  return { send: vi.fn(), readyState: 1 } as unknown as WebSocket
}

// Provide the layer and run
function runWithService<A>(
  fn: (svc: {
    addConnection: (gameId: string, playerId: string, ws: WebSocket) => Effect.Effect<void>
    removeConnection: (playerId: string) => Effect.Effect<void>
    sendToPlayer: (playerId: string, message: unknown) => Effect.Effect<void>
    broadcastToGame: (gameId: string, message: unknown) => Effect.Effect<void>
    broadcastFiltered: (gameId: string, filterFn: (playerId: string) => unknown | null) => Effect.Effect<void>
    getConnections: (gameId: string) => Effect.Effect<Map<string, WebSocket>>
    getPlayerGame: (playerId: string) => Effect.Effect<string | null>
  }) => Effect.Effect<A>,
): Promise<A> {
  const program = Effect.gen(function* () {
    const svc = yield* WebSocketService
    return yield* fn(svc as never)
  })
  return Effect.runPromise(program.pipe(Effect.provide(WebSocketServiceLive)))
}

// ── Tests ──────────────────────────────────────────────────────────

describe('WebSocketService', () => {
  describe('addConnection / getConnections', () => {
    it('adds a connection and retrieves it', async () => {
      const ws = makeTestWs()
      await runWithService((svc) =>
        Effect.gen(function* () {
          yield* svc.addConnection('game_1', 'player_1', ws)
          const connections = yield* svc.getConnections('game_1')
          expect(connections.get('player_1')).toBe(ws)
        }),
      )
    })

    it('tracks player to game mapping', async () => {
      const ws = makeTestWs()
      await runWithService((svc) =>
        Effect.gen(function* () {
          yield* svc.addConnection('game_2', 'player_2', ws)
          const gameId = yield* svc.getPlayerGame('player_2')
          expect(gameId).toBe('game_2')
        }),
      )
    })

    it('overwrites connection when same player re-registers', async () => {
      const ws1 = makeTestWs()
      const ws2 = makeTestWs()
      await runWithService((svc) =>
        Effect.gen(function* () {
          yield* svc.addConnection('game_c', 'player_c', ws1)
          yield* svc.addConnection('game_c', 'player_c', ws2)

          yield* svc.sendToPlayer('player_c', { type: 'test' })
          expect(ws2.send).toHaveBeenCalled()
          expect(ws1.send).not.toHaveBeenCalled()
        }),
      )
    })

    it('supports multiple games simultaneously', async () => {
      const ws1 = makeTestWs()
      const ws2 = makeTestWs()
      await runWithService((svc) =>
        Effect.gen(function* () {
          yield* svc.addConnection('game_a', 'pa', ws1)
          yield* svc.addConnection('game_b', 'pb', ws2)

          const gameA = yield* svc.getPlayerGame('pa')
          const gameB = yield* svc.getPlayerGame('pb')
          expect(gameA).toBe('game_a')
          expect(gameB).toBe('game_b')

          yield* svc.broadcastToGame('game_a', { type: 'test' })
          expect(ws1.send).toHaveBeenCalled()
          expect(ws2.send).not.toHaveBeenCalled()
        }),
      )
    })
  })

  describe('removeConnection', () => {
    it('removes a connection and cleans up empty game maps', async () => {
      const ws = makeTestWs()
      await runWithService((svc) =>
        Effect.gen(function* () {
          yield* svc.addConnection('game_6', 'player_6', ws)
          yield* svc.removeConnection('player_6')
          const gameId = yield* svc.getPlayerGame('player_6')
          expect(gameId).toBeNull()
          const connections = yield* svc.getConnections('game_6')
          expect(connections.size).toBe(0)
        }),
      )
    })
  })

  describe('sendToPlayer', () => {
    it('sends message to a connected player', async () => {
      const ws = makeTestWs()
      await runWithService((svc) =>
        Effect.gen(function* () {
          yield* svc.addConnection('game_3', 'player_3', ws)
          yield* svc.sendToPlayer('player_3', { type: 'tick_state', tick: 1 })
          expect(ws.send).toHaveBeenCalledWith(
            JSON.stringify({ type: 'tick_state', tick: 1 }),
          )
        }),
      )
    })

    it('does nothing when sending to unknown player', async () => {
      await runWithService((svc) =>
        Effect.gen(function* () {
          yield* svc.sendToPlayer('nonexistent_player', { type: 'test' })
        }),
      )
    })

    it('handles send failure gracefully', async () => {
      const ws = makeTestWs()
      ;(ws.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Connection closed')
      })
      const warnSpy = vi.spyOn(wsLog, 'warn').mockImplementation(() => {})

      await runWithService((svc) =>
        Effect.gen(function* () {
          yield* svc.addConnection('game_7', 'player_7', ws)
          yield* svc.sendToPlayer('player_7', { type: 'test' })
          expect(warnSpy).toHaveBeenCalled()
        }),
      )

      warnSpy.mockRestore()
    })
  })

  describe('broadcastToGame', () => {
    it('broadcasts message to all players in a game', async () => {
      const ws1 = makeTestWs()
      const ws2 = makeTestWs()
      await runWithService((svc) =>
        Effect.gen(function* () {
          yield* svc.addConnection('game_4', 'p1', ws1)
          yield* svc.addConnection('game_4', 'p2', ws2)
          yield* svc.broadcastToGame('game_4', { type: 'announcement', message: 'test', level: 'info' })
          const expected = JSON.stringify({ type: 'announcement', message: 'test', level: 'info' })
          expect(ws1.send).toHaveBeenCalledWith(expected)
          expect(ws2.send).toHaveBeenCalledWith(expected)
        }),
      )
    })

    it('does nothing when broadcasting to unknown game', async () => {
      await runWithService((svc) =>
        Effect.gen(function* () {
          yield* svc.broadcastToGame('unknown_game', { type: 'test' })
        }),
      )
    })

    it('handles broadcast send failure gracefully', async () => {
      const ws = makeTestWs()
      ;(ws.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Connection closed')
      })
      const warnSpy = vi.spyOn(wsLog, 'warn').mockImplementation(() => {})

      await runWithService((svc) =>
        Effect.gen(function* () {
          yield* svc.addConnection('game_8', 'player_8', ws)
          yield* svc.broadcastToGame('game_8', { type: 'test' })
          expect(warnSpy).toHaveBeenCalled()
        }),
      )

      warnSpy.mockRestore()
    })
  })

  describe('broadcastFiltered', () => {
    it('sends per-player filtered messages', async () => {
      const ws1 = makeTestWs()
      const ws2 = makeTestWs()
      await runWithService((svc) =>
        Effect.gen(function* () {
          yield* svc.addConnection('game_5', 'p1', ws1)
          yield* svc.addConnection('game_5', 'p2', ws2)
          yield* svc.broadcastFiltered('game_5', (playerId: string) => {
            if (playerId === 'p1') return { type: 'tick_state', tick: 1, state: {} }
            return null
          })
          expect(ws1.send).toHaveBeenCalled()
          expect(ws2.send).not.toHaveBeenCalled()
        }),
      )
    })
  })

  describe('getConnections / getPlayerGame', () => {
    it('returns empty map for unknown game connections', async () => {
      await runWithService((svc) =>
        Effect.gen(function* () {
          const connections = yield* svc.getConnections('nonexistent_game')
          expect(connections.size).toBe(0)
        }),
      )
    })

    it('returns null for unknown player game', async () => {
      await runWithService((svc) =>
        Effect.gen(function* () {
          const gameId = yield* svc.getPlayerGame('unknown_player')
          expect(gameId).toBeNull()
        }),
      )
    })
  })
})
