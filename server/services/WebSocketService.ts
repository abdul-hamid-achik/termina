import { Context, Effect, Layer } from 'effect'
import type { ServerMessage } from '~~/shared/types/protocol'
import { wsLog } from '~~/server/utils/log'
import {
  registerPeer as peerRegister,
  removePeer as peerRemovePeer,
  setPlayerGame as peerSetPlayerGame,
  clearPlayerGame as peerClearPlayerGame,
  getPlayerGame as peerGetGame,
  getGamePlayers as peerGetGamePlayers,
  getPeer as peerGetPeer,
  sendToPeer as peerSendToPeer,
  sendToPeerRaw as peerSendToPeerRaw,
} from '~~/server/services/PeerRegistry'

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

/**
 * WebSocketService delegates to PeerRegistry, the single source of truth for
 * peer connections and player→game mapping. The old duplicate gameConnections
 * and playerToGame maps are gone — PeerRegistry now maintains a reverse
 * gamePlayers index that this service queries.
 *
 * `addConnection` / `removeConnection` register/unregister the raw WS with
 * PeerRegistry (so sendToPeer works for game broadcasts) and track the
 * player→game association via setPlayerGame/clearPlayerGame.
 */
export const WebSocketServiceLive = Layer.succeed(WebSocketService, {
  addConnection: (gameId, playerId, ws) =>
    Effect.sync(() => {
      if (ws.readyState !== 1) {
        wsLog.warn('Rejected non-OPEN WebSocket connection', {
          playerId,
          gameId,
          readyState: ws.readyState,
        })
        return
      }
      // Register the WS as the player's peer (for sendToPeer-based broadcasts).
      // Use a minimal adapter so PeerRegistry's send works with a raw WebSocket.
      const wsAdapter = ws as unknown as { send: (data: string) => void }
      peerRegister(playerId, wsAdapter, wsAdapter)
      // Track the player→game association so broadcasts reach this peer.
      peerSetPlayerGame(playerId, gameId)
      wsLog.debug('addConnection', { playerId, gameId })
    }).pipe(
      Effect.tap(() =>
        Effect.logDebug('WS registered').pipe(Effect.annotateLogs({ playerId, gameId })),
      ),
    ),

  removeConnection: (playerId) =>
    Effect.sync(() => {
      // Drop the player completely: remove the peer entry so direct sendToPeer
      // sends stop reaching them (sendToPeer routes via the peers map, not the
      // game association), AND clear the player→game association so broadcasts
      // skip them. The WS-route grace timer guarantees this only fires for a
      // player who did not reconnect, so the unconditional removal is safe.
      peerRemovePeer(playerId)
      peerClearPlayerGame(playerId)
      wsLog.debug('removeConnection', { playerId })
    }).pipe(
      Effect.tap(() => Effect.logDebug('WS removed').pipe(Effect.annotateLogs({ playerId }))),
    ),

  sendToPlayer: (playerId, message) =>
    Effect.sync(() => {
      // Delegate to PeerRegistry's sendToPeer (the single send path).
      peerSendToPeer(playerId, message)
    }),

  broadcastToGame: (gameId, message) =>
    Effect.sync(() => {
      const data = JSON.stringify(message)
      const playerIds = peerGetGamePlayers(gameId)
      for (const pid of playerIds) {
        // Send the pre-serialized data directly to avoid double-serialize.
        peerSendToPeerRaw(pid, data)
      }
    }),

  broadcastFiltered: (gameId, filterFn) =>
    Effect.sync(() => {
      const playerIds = peerGetGamePlayers(gameId)
      for (const pid of playerIds) {
        const msg = filterFn(pid)
        if (!msg) continue
        peerSendToPeerRaw(pid, JSON.stringify(msg))
      }
    }),

  getConnections: (gameId) =>
    Effect.sync(() => {
      // Return a Map keyed by playerId for backward compat (chat routing
      // iterates [pid, ws] pairs). The WS values come from PeerRegistry.
      const map = new Map<string, WebSocket>()
      for (const pid of peerGetGamePlayers(gameId)) {
        const peer = peerGetPeer(pid)
        if (peer) map.set(pid, peer as unknown as WebSocket)
      }
      return map
    }),

  getPlayerGame: (playerId) =>
    Effect.sync(() => {
      return peerGetGame(playerId) ?? null
    }),
})
