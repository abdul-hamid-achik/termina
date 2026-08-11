import { Effect } from 'effect'
import type { ClientMessage } from '~~/shared/types/protocol'
import { getGameRuntime, getReconnectPayload, stopDevGame } from '~~/server/plugins/game-server'
import { submitAction, getGameClock } from '~~/server/game/engine/GameLoop'
import { isGameBot } from '~~/server/game/ai/BotManager'
import { markClientInput } from '~~/server/services/LeaverSystem'
import {
  pickHero,
  banHero,
  getPlayerLobby,
  getLobby,
  cancelLobby,
  currentPickTurn,
  currentBanTurn,
} from '~~/server/game/matchmaking/lobby'
import {
  registerPeer,
  unregisterPeer,
  getPeer,
  getPlayerGame,
  setPlayerTeam,
  getPlayerTeam,
  sendToPeer,
} from '~~/server/services/PeerRegistry'
import { addSpectator, removeSpectator } from '~~/server/services/SpectatorRegistry'
import { getSpectateJoinInfo } from '~~/server/services/SpectatorDelayBuffer'
import { wsLog } from '~~/server/utils/log'
import { testHooksEnabled } from '~~/server/utils/testHooks'
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
// Dev/e2e (`dev_*`) games get a much shorter window UNDER TEST HOOKS ONLY: the
// e2e browser disconnects permanently at spec end and (almost) never reconnects,
// so a 60s window lets every seeded game keep ticking through the whole suite
// (which runs in ~30s) and pile up. 3s still tolerates an in-spec WS blip but
// stops the loop promptly after.
//
// The `dev_` prefix is NOT a test marker — production tutorials are `dev_` games
// too (game-server.ts `_createDevGame`), so keying on the prefix alone gave a real
// player learning the game a 3-second reconnect grace: any Wi-Fi blip ended their
// practice match. `serve:test` sets TERMINA_TEST_HOOKS=1, so the e2e suite still
// gets the short window.
const DEV_GAME_RECONNECT_MS = 3_000

// ── Server-side ping/pong (zombie-connection detection) ──────────
// The client sends heartbeats, but if a client's TCP connection dies silently
// (laptop closed, Wi-Fi dropped), the server never gets a close event — the
// peer hangs until the OS TCP keepalive timeout fires (minutes). This ping
// sweep proactively detects dead peers by sending a server-side ping every
// PING_INTERVAL_MS and removing peers that fail to send within PONG_TIMEOUT_MS.
const PING_INTERVAL_MS = 30_000
const PONG_TIMEOUT_MS = 45_000
let pingSweepTimer: ReturnType<typeof setInterval> | null = null
interface PeerSocket {
  ping?: () => void
  on?: (event: 'pong', listener: () => void) => void
}

interface PeerLiveness {
  peer: object
  lastPongAt: number
  pingSentAt: number | null
}

const lastPongAt = new Map<string, PeerLiveness>()

function peerSocket(peer: object): PeerSocket {
  return (peer as { websocket?: PeerSocket }).websocket ?? {}
}

function isCurrentPeer(playerId: string, peer: object): boolean {
  const registered = getPeer(playerId)
  return registered === undefined || registered === peer
}

/** Record a successful protocol pong or any client traffic. */
function touchPeer(playerId: string, peer: object): void {
  const liveness = lastPongAt.get(playerId)
  if (!liveness || liveness.peer !== peer) return
  liveness.lastPongAt = Date.now()
  liveness.pingSentAt = null
}

function registerPeerLiveness(playerId: string, peer: object): void {
  lastPongAt.set(playerId, { peer, lastPongAt: Date.now(), pingSentAt: null })
  const socket = peerSocket(peer)
  socket.on?.('pong', () => touchPeer(playerId, peer))
}

/** Close a dead peer while leaving the normal close handler to apply the
 * reconnect grace period and game cleanup. The identity check prevents a
 * stale sweep from closing a replacement connection. */
function closeDeadPeer(playerId: string, liveness: PeerLiveness): void {
  if (lastPongAt.get(playerId) !== liveness || !isCurrentPeer(playerId, liveness.peer)) {
    return
  }
  lastPongAt.delete(playerId)
  unregisterPeer(playerId, liveness.peer as { send: (data: string) => void })
  try {
    ;(liveness.peer as { close?: (code?: number, reason?: string) => void }).close?.(
      4000,
      'Heartbeat timeout',
    )
  } catch (error) {
    wsLog.warn('Dead peer close failed', { playerId, error: String(error) })
  }
}

/** Start the periodic ping sweep. Called once on Nitro boot. Idempotent. */
export function startPingSweep(): void {
  if (pingSweepTimer) return
  pingSweepTimer = setInterval(() => {
    const now = Date.now()
    for (const [pid, liveness] of lastPongAt) {
      if (liveness.pingSentAt !== null) {
        if (now - liveness.pingSentAt > PONG_TIMEOUT_MS) {
          wsLog.warn('Peer pong timeout — closing dead peer', {
            playerId: pid,
            age: now - liveness.pingSentAt,
          })
          closeDeadPeer(pid, liveness)
        }
        continue
      }

      const socket = peerSocket(liveness.peer)
      if (typeof socket.ping === 'function') {
        try {
          socket.ping()
          liveness.pingSentAt = now
        } catch (error) {
          wsLog.warn('Peer ping failed — closing dead peer', {
            playerId: pid,
            error: String(error),
          })
          closeDeadPeer(pid, liveness)
        }
      } else {
        // Crossws adapters without a native ping still get a write probe. A
        // synchronous send failure enters the same close/grace cleanup path.
        try {
          ;(liveness.peer as { send: (data: string) => void }).send(
            JSON.stringify({ type: 'heartbeat', serverProbe: true }),
          )
          // Protocol heartbeats from the browser clear this probe via
          // touchPeer(). Without recording the probe, adapters lacking native
          // ping/pong would write forever without ever detecting a dead peer.
          liveness.pingSentAt = now
        } catch (error) {
          wsLog.warn('Peer heartbeat failed — closing dead peer', {
            playerId: pid,
            error: String(error),
          })
          closeDeadPeer(pid, liveness)
        }
      }
    }
  }, PING_INTERVAL_MS)
  // Don't keep the process alive for the ping sweep alone.
  if (pingSweepTimer && typeof pingSweepTimer.unref === 'function') {
    pingSweepTimer.unref()
  }
}

/** Stop the ping sweep (called on Nitro shutdown). */
export function stopPingSweep(): void {
  if (pingSweepTimer) {
    clearInterval(pingSweepTimer)
    pingSweepTimer = null
  }
  lastPongAt.clear()
}

export default defineWebSocketHandler({
  open(peer) {
    const reqUrl = peer.request?.url || peer.websocket?.url || ''
    // Guard: a malformed request URL must be a clean close, not a throw out of
    // the open hook (which would crash connection setup).
    let url: URL
    try {
      url = new URL(reqUrl, 'http://localhost')
    } catch {
      peer.close(4400, 'Invalid connection URL')
      return
    }
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
    registerPeerLiveness(playerId, peer)
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
          const teamId = playerEntry?.team ?? 'chaff'
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
              phase: lobby.phase === 'banning' ? 'banning' : 'picking',
              bans: [...(lobby.bannedHeroes ?? [])],
            }),
          )
          wsLog.info('Re-sent lobby_state on reconnect', { playerId, lobbyId: existingLobbyId })
          // Also re-send whose-turn-it-is — lobby_state alone doesn't carry the
          // current picker/banner, so without this a client that (re)connects
          // mid-draft (a refresh, or a seeded draft) never learns it's their turn.
          const banTurn = currentBanTurn(lobby)
          if (banTurn) {
            peer.send(JSON.stringify(banTurn))
            wsLog.info('Re-sent ban_turn on reconnect', { playerId, banner: banTurn.playerId })
          }
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

    touchPeer(ctx.playerId, peer)

    // Reject oversized frames before parsing — valid messages are <1KB (chat
    // caps at 500 chars). Defense-in-depth at the handler; the complete cap is a
    // server-level ws maxPayload (tracked in the prod-readiness checklist).
    const text = typeof message === 'string' ? message : message.toString()
    if (Buffer.byteLength(text) > 16 * 1024) {
      wsLog.warn('Oversized WS message rejected', { playerId: ctx.playerId, bytes: text.length })
      peer.send(
        JSON.stringify({ type: 'error', code: 'MESSAGE_TOO_LARGE', message: 'Message too large' }),
      )
      return
    }

    let rawParsed: unknown
    try {
      rawParsed = JSON.parse(text)
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
        // Both browser heartbeats and adapter fallback probes use the same
        // acknowledgement. `touchPeer` above records the response as liveness.
        peer.send(JSON.stringify({ type: 'heartbeat_ack', timestamp: Date.now() }))
        break

      case 'reconnect': {
        if (!checkScopedRateLimit('recovery', ctx.playerId)) {
          peer.send(
            JSON.stringify({ type: 'error', code: 'RATE_LIMITED', message: 'Too many requests' }),
          )
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
        // Ownership check (same guard as join_game): only reconnect into the
        // game this player is actually assigned to. Without this, any authed
        // client could reconnect into an arbitrary gameId and receive its
        // objective state + inject chat/pings into a match they're not in.
        {
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
          const payload = getReconnectPayload(parsed.gameId, ctx.playerId, parsed.lastCycle)
          if (payload) {
            peer.send(
              JSON.stringify({ type: 'full_state', cycle: payload.cycle, state: payload.state }),
            )
            if (payload.events.length > 0) {
              peer.send(
                JSON.stringify({
                  type: 'events',
                  cycle: payload.cycle,
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
        if (!checkScopedRateLimit('recovery', ctx.playerId)) {
          peer.send(
            JSON.stringify({ type: 'error', code: 'RATE_LIMITED', message: 'Too many requests' }),
          )
          break
        }
        if (!ctx.gameId) {
          peer.send(JSON.stringify({ type: 'error', code: 'NO_GAME', message: 'Not in a game' }))
          break
        }
        const statePayload = getReconnectPayload(ctx.gameId, ctx.playerId)
        if (statePayload) {
          peer.send(
            JSON.stringify({
              type: 'full_state',
              cycle: statePayload.cycle,
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

        // Any attempted action is presence — feeds the AFK takeover's gate even
        // if a later check drops the command. Gated on the player still being
        // assigned to this game (clearPlayerGame runs at cleanup), so a
        // straggler message after game end can't repopulate the ledger that
        // clearClientInput just emptied (a slow map-entry leak otherwise).
        if (getPlayerGame(ctx.playerId) === ctx.gameId) {
          markClientInput(ctx.gameId, ctx.playerId)
        }

        // No-reclaim AFK takeover: once a player has been replaced by a bot,
        // their slot is bot-controlled for the rest of the match. Drop any input
        // a reconnecting human sends so they can't fight the bot for control —
        // EXCEPT surrender: the human is still a team member and must be able to
        // concede a match they can no longer play (their vote counts, the bot's
        // never does).
        if (isGameBot(ctx.gameId, ctx.playerId) && parsed.command.type !== 'surrender') {
          peer.send(
            JSON.stringify({
              type: 'error',
              code: 'AI_CONTROLLED',
              message:
                'A bot is playing your hero for the rest of this match (AFK takeover). You can still chat, ping, and vote to surrender.',
            }),
          )
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

        // forCycle-stamped orders are validated against the live clock: an
        // order aimed at a batch that already committed is dead ('late'), one
        // aimed past the open batch is a client bug ('future'). Both are
        // refused EXPLICITLY — silently rolling a late order into the next
        // batch reads as "the game ate my input", the exact opposite of what
        // the batch clock promises. Unstamped orders (bots, dev tools, older
        // clients) keep today's behavior: queue for the open cycle.
        const clock = getGameClock(ctx.gameId)
        const seqEcho = parsed.clientSeq !== undefined ? { clientSeq: parsed.clientSeq } : {}
        if (parsed.forCycle !== undefined && clock && parsed.forCycle !== clock.cycle) {
          peer.send(
            JSON.stringify({
              type: 'action_ack',
              accepted: false,
              cycle: clock.cycle,
              reason: parsed.forCycle < clock.cycle ? 'late' : 'future',
              ...seqEcho,
            }),
          )
          break
        }
        const queued = submitAction(ctx.gameId, ctx.playerId, parsed.command)
        peer.send(
          JSON.stringify({
            type: 'action_ack',
            accepted: true,
            ...(clock ? { cycle: clock.cycle } : {}),
            slot: queued.slot,
            replaced: queued.replaced,
            ...seqEcho,
          }),
        )
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
          // for the next cycle broadcast — required for manual-tick dev games (no
          // auto-loop), and a faster first paint for normal games too.
          const joinState = getReconnectPayload(parsed.gameId, ctx.playerId)
          if (joinState) {
            // Cache the player's team for O(1) chat/ping routing (avoids
            // rebuilding the reconnect payload on every team-scoped message).
            const myTeam = joinState.state.players[ctx.playerId]?.team
            if (myTeam) setPlayerTeam(ctx.playerId, myTeam)
            peer.send(
              JSON.stringify({
                type: 'full_state',
                cycle: joinState.cycle,
                state: joinState.state,
              }),
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

      case 'hero_ban': {
        wsLog.debug('hero_ban received', {
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
        const banResult = banHero(
          parsed.lobbyId,
          ctx.playerId,
          parsed.heroId,
          runtime.wsService,
          runtime.redisService,
          runtime.dbService,
        )
        if (!banResult.success) {
          peer.send(
            JSON.stringify({
              type: 'error',
              code: 'BAN_FAILED',
              message: banResult.error ?? 'Hero ban failed',
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
        // Chat + pings are deliberate input — presence for the AFK takeover
        // gate. Same still-assigned guard as the action case (see above).
        if (getPlayerGame(ctx.playerId) === ctx.gameId) {
          markClientInput(ctx.gameId, ctx.playerId)
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
            // Use the O(1) team cache instead of rebuilding the full reconnect
            // payload (which does state filtering + vision calc + event filter)
            // just to get team IDs for routing.
            const senderTeam = getPlayerTeam(senderId)
            for (const [pid] of connections) {
              // Only filter when teams are known; otherwise fall back to fan-out.
              if (teamScoped && senderTeam !== undefined && getPlayerTeam(pid) !== senderTeam)
                continue
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

        // The live feed is delayed (SpectatorDelayBuffer) — hand the new
        // watcher whatever's already mature right away instead of leaving
        // them staring at nothing for up to the full delay window. If nothing
        // has matured yet (a fresh game, or nobody's watched it long enough),
        // tell them how long until the first frame lands.
        const joinInfo = getSpectateJoinInfo(parsed.gameId)
        if (joinInfo.type === 'mature') {
          peer.send(joinInfo.payload)
        } else {
          peer.send(
            JSON.stringify({
              type: 'spectator_delayed',
              gameId: parsed.gameId,
              etaMs: joinInfo.etaMs,
            }),
          )
        }

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
    // Heartbeat timestamp is dead the moment the socket closes; don't delete a
    // replacement peer's liveness record if this is a stale close callback.
    const liveness = lastPongAt.get(playerId)
    if (!liveness || liveness.peer === peer) lastPongAt.delete(playerId)

    const existingTimer = disconnectTimers.get(playerId)
    if (existingTimer) {
      clearTimeout(existingTimer)
      disconnectTimers.delete(playerId)
    }

    // Stale-close guard: if a newer connection already took over this
    // player's slot (duplicate tab, or a reconnect racing ahead of this close
    // event), the unregisterPeer above left that live peer registered — so
    // this close event must not cancel a lobby or start a disconnect grace
    // period against a socket that's actually healthy. Same isCurrentPeer
    // check the ping sweep uses for the same reason. Peer-scoped bookkeeping
    // above (unregister, spectator, liveness) still ran; only the
    // lobby-cancel / disconnect-grace side effects are skipped here.
    if (!isCurrentPeer(playerId, peer)) {
      peerState.delete(peer)
      return
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

          // Peer-identity guard: if a newer connection has already taken over
          // this player's slot (duplicate tab, or a reconnect that opened before
          // this close fired), `unregisterPeer` left that live peer registered —
          // so tearing down here would kill the live connection. Only this stale
          // peer's bookkeeping is dropped; the active connection is left intact.
          if (getPeer(playerId)) {
            peerState.delete(peer)
            return
          }

          resetRateLimit(playerId)

          const runtime = getGameRuntime()
          if (runtime) {
            Effect.runPromise(
              Effect.gen(function* () {
                yield* runtime.wsService.removeConnection(playerId)
                // Notify the surviving players. removeConnection ran first, so the
                // dropped player's peer is gone and this can't echo back to them.
                // (The old code published to a Redis channel nobody subscribed to,
                // so the disconnect notice never actually reached anyone.)
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

          peerState.delete(peer)
        },
        gameId.startsWith('dev_') && testHooksEnabled()
          ? DEV_GAME_RECONNECT_MS
          : RECONNECT_WINDOW_MS,
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
    stopPingSweep()
  })
  // Start the ping sweep now (Nitro doesn't have an 'init' hook in all versions).
  startPingSweep()
} catch {
  // No Nitro app available (vitest) — skip the hook registration.
}
