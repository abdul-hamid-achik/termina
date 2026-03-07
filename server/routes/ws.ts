import { Effect } from 'effect'
import type { ClientMessage } from '~~/shared/types/protocol'
import { getGameRuntime } from '../plugins/game-server'
import { submitAction } from '../game/engine/GameLoop'
import { pickHero, banHero, getPlayerLobby, getLobby, cancelLobby } from '../game/matchmaking/lobby'
import { registerPeer, unregisterPeer, getPlayerGame, sendToPeer } from '../services/PeerRegistry'
import { wsLog } from '../utils/log'
import { verifyWsTicket } from '../utils/ws-ticket'
import { checkRateLimit, resetRateLimit } from '../utils/RateLimiter'

interface PeerContext {
  playerId: string | null
  gameId: string | null
}

const peerState = new WeakMap<object, PeerContext>()
const disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()
const lobbyDisconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()

const RECONNECT_WINDOW_MS = 60_000
const LOBBY_DISCONNECT_GRACE_MS = 30_000

export default defineWebSocketHandler({
  open(peer) {
    const reqUrl = peer.request?.url || peer.websocket?.url || ''
    const url = new URL(reqUrl, 'http://localhost')
    const queryPlayerId = url.searchParams.get('playerId')

    // Derive playerId from authenticated session (attached by auth middleware)
    let playerId: string | null = null
    const session = (peer.request as Record<string, unknown> | undefined)?.__authSession as {
      user?: { id?: string }
    } | null
    playerId = (session?.user?.id as string) ?? null

    // Fallback: verify signed ticket (works through proxy chains where session is lost)
    if (!playerId) {
      const ticket = url.searchParams.get('ticket')
      if (ticket) {
        const secret = useRuntimeConfig().session?.password as string | undefined
        if (secret) {
          playerId = verifyWsTicket(ticket, secret)
        }
      }
    }

    // Reject direct bot connections - bots are created server-side only
    if (queryPlayerId?.startsWith('bot_')) {
      peer.send(
        JSON.stringify({
          type: 'error',
          code: 'BOT_CONNECTION_FORBIDDEN',
          message: 'Direct bot connections are not allowed',
        }),
      )
      peer.close(4003, 'Direct bot connections are not allowed')
      return
    }

    if (!playerId) {
      peer.send(
        JSON.stringify({
          type: 'error',
          code: 'AUTH_REQUIRED',
          message: 'Authentication required',
        }),
      )
      peer.close(4001, 'Authentication required')
      return
    }

    peerState.set(peer, { playerId, gameId: null })
    const rawWs = peer.websocket as unknown as {
      send: (data: string | ArrayBuffer | Uint8Array) => number | undefined
    } | null
    registerPeer(playerId, peer, rawWs)
    wsLog.info('Peer connected', { playerId })

    const timer = disconnectTimers.get(playerId)
    if (timer) {
      clearTimeout(timer)
      disconnectTimers.delete(playerId)
    }

    const lobbyTimer = lobbyDisconnectTimers.get(playerId)
    if (lobbyTimer) {
      clearTimeout(lobbyTimer)
      lobbyDisconnectTimers.delete(playerId)
      wsLog.info('Cleared lobby disconnect timer on reconnect', { playerId })
    }

    const announcementMsg = JSON.stringify({
      type: 'announcement',
      message: 'Connected to TERMINA',
      level: 'info',
    })
    peer.send(announcementMsg)
    wsLog.debug('Sent announcement to peer', { playerId, peerType: peer.constructor?.name })

    // Re-send game_starting if this player is already in an active game (reconnect recovery)
    const existingGameId = getPlayerGame(playerId)
    if (existingGameId) {
      peer.send(
        JSON.stringify({
          type: 'game_starting',
          gameId: existingGameId,
        }),
      )
      wsLog.info('Re-sent game_starting on reconnect', { playerId, gameId: existingGameId })
    } else {
      // Re-send lobby_state if this player is already in a lobby (reconnect recovery)
      const existingLobbyId = getPlayerLobby(playerId)
      if (existingLobbyId) {
        const lobby = getLobby(existingLobbyId)
        if (lobby) {
          const playerEntry = lobby.players.find((p) => p.playerId === playerId)
          const teamId = playerEntry?.team ?? 'radiant'
          peer.send(
            JSON.stringify({
              type: 'lobby_state',
              lobbyId: existingLobbyId,
              team: teamId,
              players: lobby.players.map((p) => ({
                playerId: p.playerId,
                username: p.username,
                team: p.team,
                heroId: p.heroId,
              })),
            }),
          )
          wsLog.info('Re-sent lobby_state on reconnect', { playerId, lobbyId: existingLobbyId })
        }
      }
    }
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
        peer.send(JSON.stringify({ type: 'heartbeat_ack', timestamp: Date.now() }))
        break

      case 'reconnect': {
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
        try {
          ctx.gameId = parsed.gameId
          const addConn = runtime.wsService.addConnection(
            parsed.gameId,
            ctx.playerId,
            peer.websocket as unknown as WebSocket,
          )
          Effect.runSync(addConn)
          peer.send(
            JSON.stringify({ type: 'announcement', message: 'Reconnected to game', level: 'info' }),
          )
        } catch (err) {
          wsLog.error('Reconnect failed', {
            playerId: ctx.playerId,
            gameId: parsed.gameId,
            error: err,
          })
          peer.send(
            JSON.stringify({
              type: 'error',
              code: 'RECONNECT_FAILED',
              message: 'Failed to reconnect',
            }),
          )
        }
        break
      }

      case 'action': {
        if (!ctx.gameId) {
          wsLog.warn('Action rejected — no gameId', { playerId: ctx.playerId })
          peer.send(JSON.stringify({ type: 'error', code: 'NO_GAME', message: 'Not in a game' }))
          break
        }

        // Rate limit check - prevent action spam
        if (!checkRateLimit(ctx.playerId)) {
          wsLog.warn('Action rate limited', { playerId: ctx.playerId, gameId: ctx.gameId })
          peer.send(
            JSON.stringify({
              type: 'error',
              code: 'RATE_LIMITED',
              message: 'Action rate limited. Please slow down.',
            }),
          )
          break
        }

        wsLog.debug('Action received', {
          playerId: ctx.playerId,
          gameId: ctx.gameId,
          command: parsed.command.type,
        })
        submitAction(ctx.gameId, ctx.playerId, parsed.command)
        break
      }

      case 'join_game': {
        const runtime = getGameRuntime()
        if (!runtime) break

        // Verify the player is assigned to this game
        const assignedGame = getPlayerGame(ctx.playerId)
        if (!assignedGame || assignedGame !== parsed.gameId) {
          peer.send(
            JSON.stringify({
              type: 'error',
              code: 'NOT_ASSIGNED',
              message: 'Not assigned to this game',
            }),
          )
          break
        }

        wsLog.info('join_game received', { playerId: ctx.playerId, gameId: parsed.gameId })
        ctx.gameId = parsed.gameId
        try {
          Effect.runSync(
            runtime.wsService.addConnection(
              parsed.gameId,
              ctx.playerId,
              peer.websocket as unknown as WebSocket,
            ),
          )
          peer.send(JSON.stringify({ type: 'announcement', message: 'Joined game', level: 'info' }))
        } catch (err) {
          wsLog.error('join_game addConnection failed', {
            playerId: ctx.playerId,
            gameId: parsed.gameId,
            error: err,
          })
        }
        break
      }

      case 'hero_pick': {
        wsLog.debug('hero_pick received', {
          playerId: ctx.playerId,
          lobbyId: parsed.lobbyId,
          heroId: parsed.heroId,
        })
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

      case 'hero_ban': {
        wsLog.debug('hero_ban received', {
          playerId: ctx.playerId,
          lobbyId: parsed.lobbyId,
          heroId: parsed.heroId,
        })
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
        const result = banHero(
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
              code: 'BAN_FAILED',
              message: result.error ?? 'Hero ban failed',
            }),
          )
        }
        break
      }

      case 'chat':
      case 'ping_map': {
        const runtime = getGameRuntime()
        if (!runtime || !ctx.gameId) {
          peer.send(
            JSON.stringify({
              type: 'error',
              code: 'NO_GAME',
              message: 'Not in a game',
            }),
          )
          break
        }
        const outMsg = { playerId: ctx.playerId, ...parsed }
        Effect.runPromise(
          Effect.gen(function* () {
            const connections = yield* runtime.wsService.getConnections(ctx.gameId!)
            for (const [pid] of connections) {
              sendToPeer(pid, outMsg)
            }
          }),
        ).catch((err) => {
          wsLog.warn('Failed to route message', {
            type: parsed.type,
            gameId: ctx.gameId,
            error: err,
          })
        })
        break
      }
    }
  },

  close(peer, _details) {
    const ctx = peerState.get(peer)
    if (!ctx?.playerId) return

    const { playerId, gameId } = ctx
    wsLog.info('Peer disconnected', { playerId, gameId })
    unregisterPeer(playerId, peer)

    const existingTimer = disconnectTimers.get(playerId)
    if (existingTimer) {
      clearTimeout(existingTimer)
      disconnectTimers.delete(playerId)
    }

    const lobbyId = getPlayerLobby(playerId)
    if (lobbyId) {
      const runtime = getGameRuntime()
      if (runtime) {
        const existingLobbyTimer = lobbyDisconnectTimers.get(playerId)
        if (existingLobbyTimer) {
          clearTimeout(existingLobbyTimer)
        }

        wsLog.info('Player disconnected during lobby — starting grace period', {
          playerId,
          lobbyId,
        })

        const timer = setTimeout(() => {
          lobbyDisconnectTimers.delete(playerId)
          const currentLobbyId = getPlayerLobby(playerId)
          if (currentLobbyId) {
            wsLog.info('Grace period expired — cancelling lobby', {
              playerId,
              lobbyId: currentLobbyId,
            })
            cancelLobby(currentLobbyId, runtime.wsService)
          }
        }, RECONNECT_WINDOW_MS)

        lobbyDisconnectTimers.set(playerId, timer)
      }
    }

    if (gameId) {
      const timer = setTimeout(() => {
        disconnectTimers.delete(playerId)

        resetRateLimit(playerId)

        const runtime = getGameRuntime()
        if (runtime) {
          Effect.runPromise(
            Effect.gen(function* () {
              yield* runtime.wsService.removeConnection(playerId)
              yield* runtime.redisService.publish(
                `game:${gameId}:events`,
                JSON.stringify({ type: 'player_disconnect', playerId }),
              )
            }),
          ).catch((err) => {
            wsLog.warn('Disconnect cleanup failed', { playerId, error: String(err) })
          })
        }

        peerState.delete(peer)
      }, RECONNECT_WINDOW_MS)

      disconnectTimers.set(playerId, timer)
    } else {
      resetRateLimit(playerId)
      peerState.delete(peer)
    }
  },

  error(peer, error) {
    wsLog.error('WebSocket error', { error })
  },
})
