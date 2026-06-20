import { Effect } from 'effect'
import type { ClientMessage } from '~~/shared/types/protocol'
import { getGameRuntime, getReconnectPayload, stopDevGame } from '~~/server/plugins/game-server'
import { submitAction } from '~~/server/game/engine/GameLoop'
import {
  pickHero,
  getPlayerLobby,
  getLobby,
  cancelLobby,
  currentPickTurn,
} from '~~/server/game/matchmaking/lobby'
import {
  registerPeer,
  unregisterPeer,
  getPlayerGame,
  sendToPeer,
  getInstanceId,
  PLAYER_LOCATION_KEY,
} from '~~/server/services/PeerRegistry'
import { addSpectator, removeSpectator } from '~~/server/services/SpectatorRegistry'
import { wsLog } from '~~/server/utils/log'
import { verifyWsTicket } from '~~/server/utils/ws-ticket'
import { checkRateLimit, checkScopedRateLimit, resetRateLimit } from '~~/server/utils/RateLimiter'
import { clientMessageSchema } from '~~/server/utils/ws-schemas'

interface PeerContext {
  playerId: string | null
  gameId: string | null
}

const peerState = new WeakMap<object, PeerContext>()
const disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()
const lobbyDisconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** Clear all pending disconnect/lobby timers. Called on Nitro shutdown so the
 *  process can exit cleanly without orphaned setTimeout callbacks. */
export function clearDisconnectTimers(): void {
  for (const timer of disconnectTimers.values()) clearTimeout(timer)
  for (const timer of lobbyDisconnectTimers.values()) clearTimeout(timer)
  disconnectTimers.clear()
  lobbyDisconnectTimers.clear()
}

const RECONNECT_WINDOW_MS = 60_000
// Dev/e2e (`dev_*`) games get a much shorter window: the e2e browser disconnects
// permanently at spec end and (almost) never reconnects, so a 60s window lets
// every seeded game keep ticking through the whole suite (which runs in ~30s) and
// pile up. 3s still tolerates an in-spec WS blip but stops the loop promptly after.
const DEV_GAME_RECONNECT_MS = 3_000
const _LOBBY_DISCONNECT_GRACE_MS = 30_000

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
    // Register this player's location in Redis so other instances can relay
    // messages to them (P4 multi-instance). Best-effort — single-instance mode
    // has no other instance to relay to, so a failure is harmless.
    try {
      const runtime0 = getGameRuntime()
      const instanceId0 = getInstanceId()
      if (runtime0 && instanceId0) {
        Effect.runSync(runtime0.redisService.hset(PLAYER_LOCATION_KEY, playerId, instanceId0))
      }
    } catch {
      // Redis unavailable or mock environment — skip location registration.
    }
    wsLog.info('Peer connected', { playerId })

    const timer = disconnectTimers.get(playerId)
    // A pending in-game disconnect timer means this open is a genuine reconnect
    // (the player dropped and came back inside the window), not a first connect.
    const wasReconnecting = !!timer
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
      // Tell the rest of the game the player is back (mirrors player_disconnect).
      // Gated on wasReconnecting so a first connect doesn't falsely announce it.
      if (wasReconnecting) {
        const runtime = getGameRuntime()
        if (runtime) {
          Effect.runPromise(
            runtime.wsService.broadcastToGame(existingGameId, {
              type: 'player_reconnect',
              playerId,
            }),
          ).catch((err) => {
            wsLog.warn('Reconnect broadcast failed', { playerId, error: String(err) })
          })
        }
      }
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
          // Also re-send whose-turn-it-is — lobby_state alone doesn't carry the
          // current picker, so without this a client that (re)connects mid-draft
          // (a refresh, or a seeded draft) never learns it's their turn.
          const turn = currentPickTurn(lobby)
          if (turn) {
            peer.send(JSON.stringify(turn))
            wsLog.info('Re-sent pick_turn on reconnect', { playerId, picker: turn.playerId })
          }
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

    let rawParsed: unknown
    try {
      rawParsed = JSON.parse(typeof message === 'string' ? message : message.toString())
    } catch {
      peer.send(
        JSON.stringify({ type: 'error', code: 'INVALID_JSON', message: 'Invalid JSON message' }),
      )
      return
    }

    // Schema validation — malformed or out-of-contract messages are rejected
    // before they can reach game/lobby state.
    const validated = clientMessageSchema.safeParse(rawParsed)
    if (!validated.success) {
      wsLog.warn('Invalid message rejected', {
        playerId: ctx.playerId,
        type: (rawParsed as { type?: string })?.type ?? 'unknown',
      })
      peer.send(
        JSON.stringify({ type: 'error', code: 'INVALID_MESSAGE', message: 'Invalid message' }),
      )
      return
    }
    const parsed: ClientMessage = validated.data as ClientMessage

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
          // Send the current state immediately (instead of waiting up to a
          // full tick) plus the visible events missed while disconnected.
          const payload = getReconnectPayload(parsed.gameId, ctx.playerId, parsed.lastTick)
          if (payload) {
            peer.send(
              JSON.stringify({ type: 'full_state', tick: payload.tick, state: payload.state }),
            )
            if (payload.events.length > 0) {
              peer.send(
                JSON.stringify({
                  type: 'events',
                  tick: payload.tick,
                  events: payload.events,
                }),
              )
            }
          }
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

      case 'request_state': {
        if (!ctx.gameId) {
          peer.send(JSON.stringify({ type: 'error', code: 'NO_GAME', message: 'Not in a game' }))
          break
        }
        const statePayload = getReconnectPayload(ctx.gameId, ctx.playerId)
        if (statePayload) {
          peer.send(
            JSON.stringify({
              type: 'full_state',
              tick: statePayload.tick,
              state: statePayload.state,
            }),
          )
        } else {
          peer.send(JSON.stringify({ type: 'game_not_found', gameId: ctx.gameId }))
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
          // Send current state immediately so the client renders without waiting
          // for the next tick broadcast — required for manual-tick dev games (no
          // auto-loop), and a faster first paint for normal games too.
          const joinState = getReconnectPayload(parsed.gameId, ctx.playerId)
          if (joinState) {
            peer.send(
              JSON.stringify({ type: 'full_state', tick: joinState.tick, state: joinState.state }),
            )
          }
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
        if (!checkScopedRateLimit('lobby', ctx.playerId)) {
          peer.send(JSON.stringify({ type: 'error', code: 'RATE_LIMITED', message: 'Slow down' }))
          break
        }
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
        // Rate limit chat + pings to prevent spam (was unlimited)
        if (!checkScopedRateLimit('chat', ctx.playerId)) {
          wsLog.warn('Chat/ping rate limited', { playerId: ctx.playerId, gameId: ctx.gameId })
          peer.send(
            JSON.stringify({
              type: 'error',
              code: 'RATE_LIMITED',
              message: 'Chat rate limited. Please slow down.',
            }),
          )
          break
        }
        const outMsg = { playerId: ctx.playerId, ...parsed }
        // Team chat and map pings are team-scoped: fanning them to the whole game
        // leaks your strategy and where you're looking to the enemy. 'all' chat
        // still reaches everyone.
        const teamScoped =
          parsed.type === 'ping_map' || (parsed.type === 'chat' && parsed.channel === 'team')
        const gid = ctx.gameId
        const senderId = ctx.playerId
        Effect.runPromise(
          Effect.gen(function* () {
            const connections = yield* runtime.wsService.getConnections(gid)
            const teamOf: Record<string, string> = {}
            if (teamScoped) {
              // The sender's filtered state carries a team for every player
              // (teammates full, enemies fogged-but-team-present).
              const payload = getReconnectPayload(gid, senderId)
              if (payload) {
                for (const p of Object.values(payload.state.players)) teamOf[p.id] = p.team
              }
            }
            const senderTeam = teamOf[senderId]
            for (const [pid] of connections) {
              // Only filter when teams are known; otherwise fall back to fan-out.
              if (teamScoped && senderTeam !== undefined && teamOf[pid] !== senderTeam) continue
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

      case 'spectate': {
        // Players in a game may not spectate it — the spectator stream is
        // fogless, which would be a free maphack for participants.
        const playerCurrentGame = getPlayerGame(ctx.playerId)
        if (playerCurrentGame === parsed.gameId) {
          peer.send(
            JSON.stringify({
              type: 'error',
              code: 'SPECTATE_FORBIDDEN',
              message: 'Cannot spectate a game you are playing in',
            }),
          )
          break
        }
        // Subscribe this peer to a game's tick stream as a fogless spectator.
        // No game-server interaction needed — the registry alone is enough,
        // because the game loop's onSpectatorTick fans out from there.
        addSpectator(ctx.playerId, parsed.gameId, {
          send: (data) => peer.send(data),
        })
        peer.send(JSON.stringify({ type: 'spectator_ack', gameId: parsed.gameId }))
        wsLog.info('Spectator subscribed', { playerId: ctx.playerId, gameId: parsed.gameId })
        break
      }

      case 'unspectate': {
        removeSpectator(ctx.playerId)
        wsLog.info('Spectator unsubscribed', { playerId: ctx.playerId })
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
    removeSpectator(playerId)

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
      const timer = setTimeout(
        () => {
          disconnectTimers.delete(playerId)

          resetRateLimit(playerId)

          const runtime = getGameRuntime()
          if (runtime) {
            Effect.runPromise(
              Effect.gen(function* () {
                yield* runtime.wsService.removeConnection(playerId)
                // Notify the surviving players. removeConnection ran first, so the
                // dropped player is already out of the connection set. (The old
                // code published to a Redis channel nobody subscribed to, so the
                // disconnect notice never actually reached anyone.)
                yield* runtime.wsService.broadcastToGame(gameId, {
                  type: 'player_disconnect',
                  playerId,
                })
              }),
            ).catch((err) => {
              wsLog.warn('Disconnect cleanup failed', { playerId, error: String(err) })
            })
          }

          // Dev/e2e games: the player is gone for good (grace expired with no
          // reconnect) — stop the seeded game's loop so dev games don't pile up and
          // tick forever across an e2e suite. No-op for real (matchmaking) games.
          stopDevGame(gameId)

          // Deregister the player's location from Redis (P4 multi-instance).
          try {
            if (runtime) {
              Effect.runSync(runtime.redisService.hdel(PLAYER_LOCATION_KEY, playerId))
            }
          } catch {
            // Redis unavailable — skip.
          }

          peerState.delete(peer)
        },
        gameId.startsWith('dev_') ? DEV_GAME_RECONNECT_MS : RECONNECT_WINDOW_MS,
      )

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

// Register a Nitro close hook to clear pending disconnect timers on shutdown
// so the process exits cleanly without orphaned setTimeout callbacks.
// Guarded for the vitest context (no Nitro runtime there).
try {
  const nitroApp = useNitroApp()
  nitroApp.hooks.hook('close', () => {
    clearDisconnectTimers()
  })
} catch {
  // No Nitro app available (vitest) — skip the hook registration.
}
