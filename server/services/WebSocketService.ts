import { Context, Effect, Layer } from 'effect'
import type { ServerMessage } from '~~/shared/types/protocol'

export interface WebSocketServiceApi {
  readonly addConnection: (gameId: string, playerId: string, ws: WebSocket) => Effect.Effect<void>
  readonly removeConnection: (playerId: string) => Effect.Effect<void>
  readonly sendToPlayer: (playerId: string, message: ServerMessage) => Effect.Effect<void>
  readonly broadcastToGame: (gameId: string, message: ServerMessage) => Effect.Effect<void>
  readonly broadcastFiltered: (
    gameId: string,
    filterFn: (playerId: string) => ServerMessage | null,
  ) => Effect.Effect<void>
  readonly getConnections: (gameId: string) => Effect.Effect<Map<string, WebSocket>>
  readonly getPlayerGame: (playerId: string) => Effect.Effect<string | null>
}

export class WebSocketService extends Context.Tag('WebSocketService')<
  WebSocketService,
  WebSocketServiceApi
>() {}

// In-memory connection state
const gameConnections = new Map<string, Map<string, WebSocket>>()
const playerToGame = new Map<string, string>()

export const WebSocketServiceLive = Layer.succeed(WebSocketService, {
  addConnection: (gameId, playerId, ws) =>
    Effect.sync(() => {
      let gameMap = gameConnections.get(gameId)
      if (!gameMap) {
        gameMap = new Map()
        gameConnections.set(gameId, gameMap)
      }
      gameMap.set(playerId, ws)
      playerToGame.set(playerId, gameId)
    }).pipe(
      Effect.tap(() =>
        Effect.logDebug('WS registered').pipe(Effect.annotateLogs({ playerId, gameId })),
      ),
    ),

  removeConnection: (playerId) =>
    Effect.sync(() => {
      const gameId = playerToGame.get(playerId)
      if (gameId) {
        const gameMap = gameConnections.get(gameId)
        if (gameMap) {
          gameMap.delete(playerId)
          if (gameMap.size === 0) {
            gameConnections.delete(gameId)
          }
        }
        playerToGame.delete(playerId)
      }
    }).pipe(
      Effect.tap(() => Effect.logDebug('WS removed').pipe(Effect.annotateLogs({ playerId }))),
    ),

  sendToPlayer: (playerId, message) =>
    Effect.sync(() => {
      const gameId = playerToGame.get(playerId)
      if (!gameId) return
      const gameMap = gameConnections.get(gameId)
      if (!gameMap) return
      const ws = gameMap.get(playerId)
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message))
      }
    }),

  broadcastToGame: (gameId, message) =>
    Effect.sync(() => {
      const gameMap = gameConnections.get(gameId)
      if (!gameMap) return
      const data = JSON.stringify(message)
      for (const ws of gameMap.values()) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data)
        }
      }
    }),

  broadcastFiltered: (gameId, filterFn) =>
    Effect.sync(() => {
      const gameMap = gameConnections.get(gameId)
      if (!gameMap) return
      for (const [playerId, ws] of gameMap.entries()) {
        if (ws.readyState !== WebSocket.OPEN) continue
        const msg = filterFn(playerId)
        if (msg) {
          ws.send(JSON.stringify(msg))
        }
      }
    }),

  getConnections: (gameId) =>
    Effect.sync(() => {
      return gameConnections.get(gameId) ?? new Map()
    }),

  getPlayerGame: (playerId) =>
    Effect.sync(() => {
      return playerToGame.get(playerId) ?? null
    }),
})
