import { Effect } from 'effect'
import type { ClientMessage } from '~~/shared/types/protocol'
import { getGameRuntime } from '../plugins/game-server'
import { submitAction } from '../game/engine/GameLoop'
import { pickHero } from '../game/matchmaking/lobby'
import { registerPeer, unregisterPeer } from '../services/PeerRegistry'

interface PeerContext {
  playerId: string | null
  gameId: string | null
}

const peerState = new WeakMap<object, PeerContext>()
const disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()

const RECONNECT_WINDOW_MS = 60_000

export default defineWebSocketHandler({
  open(peer) {
    const reqUrl = peer.request?.url || peer.websocket?.url || ''
    const url = new URL(reqUrl, 'http://localhost')
    const playerId = url.searchParams.get('playerId')

    if (!playerId) {
      peer.send(
        JSON.stringify({ type: 'error', code: 'AUTH_REQUIRED', message: 'Missing playerId' }),
      )
      peer.close(4001, 'Missing playerId')
      return
    }

    peerState.set(peer, { playerId, gameId: null })
    registerPeer(playerId, peer)

    // Cancel any pending disconnect timer for this player
    const timer = disconnectTimers.get(playerId)
    if (timer) {
      clearTimeout(timer)
      disconnectTimers.delete(playerId)
    }

    peer.send(
      JSON.stringify({ type: 'announcement', message: 'Connected to TERMINA', level: 'info' }),
    )
  },

  message(peer, message) {
    const ctx = peerState.get(peer)
    if (!ctx?.playerId) {
      peer.send(
        JSON.stringify({ type: 'error', code: 'NOT_AUTHENTICATED', message: 'Not authenticated' }),
      )
      return
    }

    let parsed: ClientMessage
    try {
      parsed = JSON.parse(typeof message === 'string' ? message : message.toString())
    } catch {
      peer.send(
        JSON.stringify({ type: 'error', code: 'INVALID_JSON', message: 'Invalid JSON message' }),
      )
      return
    }

    switch (parsed.type) {
      case 'heartbeat':
        // Acknowledge heartbeat
        break

      case 'reconnect': {
        const runtime = getGameRuntime()
        if (!runtime) break
        ctx.gameId = parsed.gameId
        // Re-add connection via runtime
        const addConn = runtime.wsService.addConnection(
          parsed.gameId,
          ctx.playerId,
          peer.websocket as unknown as WebSocket,
        )
        Effect.runSync(addConn)
        peer.send(
          JSON.stringify({ type: 'announcement', message: 'Reconnected to game', level: 'info' }),
        )
        break
      }

      case 'action': {
        if (!ctx.gameId) {
          peer.send(JSON.stringify({ type: 'error', code: 'NO_GAME', message: 'Not in a game' }))
          break
        }
        submitAction(ctx.gameId, ctx.playerId, parsed.command)
        break
      }

      case 'join_game': {
        const runtime = getGameRuntime()
        if (!runtime) break
        ctx.gameId = parsed.gameId
        const addConn = runtime.wsService.addConnection(
          parsed.gameId,
          ctx.playerId,
          peer.websocket as unknown as WebSocket,
        )
        Effect.runSync(addConn)
        peer.send(JSON.stringify({ type: 'announcement', message: 'Joined game', level: 'info' }))
        break
      }

      case 'hero_pick': {
        const runtime = getGameRuntime()
        if (!runtime) {
          peer.send(
            JSON.stringify({
              type: 'error',
              code: 'NO_GAME_SERVER',
              message: 'Game server not ready',
            }),
          )
          break
        }
        const result = pickHero(
          parsed.lobbyId,
          ctx.playerId,
          parsed.heroId,
          runtime.wsService,
          runtime.redisService,
          runtime.dbService,
        )
        if (!result.success) {
          peer.send(
            JSON.stringify({
              type: 'error',
              code: 'PICK_FAILED',
              message: result.error ?? 'Hero pick failed',
            }),
          )
        }
        break
      }

      case 'chat':
      case 'ping_map': {
        const runtime = getGameRuntime()
        if (!runtime) {
          peer.send(
            JSON.stringify({
              type: 'error',
              code: 'NO_GAME_SERVER',
              message: 'Game server not ready',
            }),
          )
          break
        }
        const routeMsg = runtime.redisService.publish(
          `game:${ctx.gameId}:actions`,
          JSON.stringify({ playerId: ctx.playerId, ...parsed }),
        )
        Effect.runPromise(routeMsg).catch(() => {})
        break
      }
    }
  },

  close(peer, _details) {
    const ctx = peerState.get(peer)
    if (!ctx?.playerId) return

    const { playerId, gameId } = ctx
    unregisterPeer(playerId)

    if (gameId) {
      // Allow reconnect within window before removing from game
      disconnectTimers.set(
        playerId,
        setTimeout(() => {
          disconnectTimers.delete(playerId)
          const runtime = getGameRuntime()
          if (runtime) {
            Effect.runSync(runtime.wsService.removeConnection(playerId))
            // Notify game that player has fully disconnected
            Effect.runPromise(
              runtime.redisService.publish(
                `game:${gameId}:events`,
                JSON.stringify({ type: 'player_disconnect', playerId }),
              ),
            ).catch(() => {})
          }
        }, RECONNECT_WINDOW_MS),
      )
    }

    peerState.delete(peer)
  },

  error(peer, error) {
    // eslint-disable-next-line no-console
    console.error('[WS] Error:', error)
  },
})
