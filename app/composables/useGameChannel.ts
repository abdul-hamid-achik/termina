import { ref, onUnmounted } from 'vue'
import * as Ably from 'ably'
import type { ClientMessage, ServerMessage, ActionAckMessage } from '~~/shared/types/protocol'
import type { PlayerVisibleState } from '~~/shared/types/game'
import { useGameStore } from '~/stores/game'
import { socketLog } from '~/utils/logger'
import { routeServerMessage } from '~/utils/gameMessageRouter'

// Ably auto-reconnects/resumes on its own (subscription + presence recovery
// included) — this composable does NOT reimplement the WS composable's
// manual grace-window/backoff loop. `connected`/`reconnecting` just mirror
// Ably's own connection state machine.
const PING_INTERVAL = 10_000

/** The shape a `cycle_state` Ably message's `data` field carries, per the
 * ably-token/publish contract: the same PlayerVisibleState payload today's
 * WS `cycle_state` carries, plus an optional `nextCommitAt`. */
interface CycleStateData {
  cycle: number
  state: PlayerVisibleState
  nextCommitAt?: number
}

/**
 * Ably+HTTP transport — mirrors useGameSocket's public surface (connect,
 * disconnect, connected/reconnecting refs, send) so call sites can swap
 * between the two behind the `useAblyTransport` flag with no other changes.
 *
 * - Realtime messages: subscribes to the per-player channel
 *   `game:{gameId}:p:{playerId}` (INTEGRATION TODO: the team channel
 *   `game:{gameId}:team:{team}` from the token's capability grant isn't
 *   subscribed yet — nothing publishes team-broadcast events over Ably today;
 *   wire it here once the server side does).
 * - Actions: POSTs `/api/game/action`, stamping forCycle/clientSeq the same
 *   way useGameSocket's `send` does, then routes the JSON response through
 *   the SAME action_ack handling as the WS path (routeServerMessage).
 * - Auth: an `authCallback` hits `/api/auth/ably-token` via the plain global
 *   `fetch` — same pattern as useGameSocket's ws-ticket fetch. Same-origin
 *   credentials ride along automatically; in the Vercel(www)+DO(api) split,
 *   `app/plugins/api-origin.client.ts` already rewrites `/api/...` and adds
 *   `credentials: 'include'` for any global fetch call, so no special-casing
 *   is needed here (see useServerUrl.ts's rewriteApiRequest).
 */
export function useGameChannel() {
  const connected = ref(false)
  const reconnecting = ref(false)
  const connectionLost = ref(false)
  const latency = ref(0)

  let client: Ably.Realtime | null = null
  let channel: Ably.RealtimeChannel | null = null
  let currentGameId: string | null = null
  let currentPlayerId: string | null = null
  let hasConnectedOnce = false
  let pingTimer: ReturnType<typeof setInterval> | null = null
  // Monotonic per-connection order counter, echoed back in action_ack —
  // mirrors useGameSocket's actionSeq.
  let actionSeq = 0
  const handlers: Array<(msg: ServerMessage) => void> = []

  const gameStore = useGameStore()

  async function ablyAuthCallback(
    _tokenParams: Ably.TokenParams,
    callback: (
      error: Ably.ErrorInfo | string | null,
      tokenRequestOrDetails: Ably.TokenDetails | Ably.TokenRequest | string | null,
    ) => void,
  ) {
    try {
      // POST /api/auth/ably-token mints a locally-signed Ably TokenRequest
      // (clientId = playerId; subscribe capability on game:*:p:<playerId>
      // and game:*:team:*), derived from the caller's session — no params.
      const res = await fetch('/api/auth/ably-token', { method: 'POST' })
      if (!res.ok) {
        callback(`ably-token request failed: ${res.status}`, null)
        return
      }
      const tokenRequest = await res.json()
      callback(null, tokenRequest)
    } catch (err) {
      callback(err instanceof Error ? err.message : 'ably-token request failed', null)
    }
  }

  function connect(gameId: string, playerId: string) {
    currentGameId = gameId
    currentPlayerId = playerId
    // Only set gameStore.gameId for real game IDs, not the lobby placeholder
    // (mirrors useGameSocket.connect).
    if (gameId !== 'lobby') {
      gameStore.gameId = gameId
    }
    gameStore.playerId = playerId
    hasConnectedOnce = false
    _open()
  }

  function _open() {
    if (client) {
      _teardown()
    }
    connected.value = false
    reconnecting.value = false
    connectionLost.value = false

    client = new Ably.Realtime({ authCallback: ablyAuthCallback })

    client.connection.on((change) => {
      const state = change.current
      socketLog.trace('Ably connection state', { state })
      if (state === 'connected') {
        hasConnectedOnce = true
        connected.value = true
        reconnecting.value = false
        connectionLost.value = false
        _startPing()
      } else if (state === 'connecting' || state === 'disconnected') {
        connected.value = false
        // Only a RE-connection attempt (after having been up once) counts as
        // "reconnecting" — the initial handshake is just "connecting".
        reconnecting.value = hasConnectedOnce
      } else if (state === 'suspended' || state === 'failed') {
        connected.value = false
        reconnecting.value = false
        connectionLost.value = true
        _stopPing()
      } else {
        // closing / closed / initialized
        connected.value = false
        reconnecting.value = false
        _stopPing()
      }
    })

    const channelName = `game:${currentGameId}:p:${currentPlayerId}`
    socketLog.debug('Subscribing to Ably channel', { channel: channelName })
    channel = client.channels.get(channelName)
    channel.subscribe((message) => {
      _handleInbound(message)
    })
  }

  function _handleInbound(message: Ably.InboundMessage) {
    socketLog.trace(`Ably message: ${message.name}`, { name: message.name })
    switch (message.name) {
      case 'cycle_state': {
        const data = message.data as CycleStateData
        const msg: ServerMessage = {
          type: 'cycle_state',
          cycle: data.cycle,
          state: data.state,
          nextCommitAt: data.nextCommitAt,
        }
        routeServerMessage(gameStore, msg, { disconnect })
        // The legacy WS transport gets the fog-filtered event log via a
        // SEPARATE 'events' message (routed by gameMessageRouter's own
        // 'events' case, calling addEvents there) — updateFromCycle
        // deliberately does not touch state.events itself. Ably has no such
        // second channel: VisionCalculator.filterStateForPlayer already
        // folds the same events into the cycle_state payload, so this is the
        // ONLY place that needs to feed them to the store on this transport.
        // Doing this in the shared gameMessageRouter instead would double-add
        // them on the WS path, where the separate 'events' message still
        // fires — hence handling it here, not there.
        gameStore.addEvents(data.state.events ?? [])
        _notifyHandlers(msg)
        break
      }
      case 'game_over':
      case 'announcement':
      case 'error':
      case 'chat':
      case 'ping_map': {
        // game_over: published by the tick workflow in the same batch as the
        // final cycle_state — winner + full end-of-match scoreboard.
        // announcement/error: published by the operator panel's halt (and any
        // future server-side notifier). chat/ping_map: re-broadcast by
        // POST /api/game/signal (GameScreen's onMessage renders them; the
        // router deliberately has no case). All reuse the shared routing so
        // the WS-era handling (setGameOver, NOT_ASSIGNED → lobby) applies
        // verbatim.
        const msg = { ...(message.data as object), type: message.name } as ServerMessage
        routeServerMessage(gameStore, msg, { disconnect })
        _notifyHandlers(msg)
        break
      }
      default:
        // INTEGRATION TODO: once the server publishes other message types on
        // this channel (events, announcement, error, ...), route them the
        // same way — see gameMessageRouter.ts / useGameSocket.ts.
        socketLog.warn('Unhandled Ably message on game channel', { name: message.name })
    }
  }

  /** Returns true if the action POST was fired, false if there's no active
   *  game to send it to (caller can then buffer/retry, same contract as
   *  useGameSocket's send). Unlike the WS `send`, this is inherently async —
   *  the boolean is "the request went out", not "the server accepted it";
   *  the accept/reject arrives later via the action_ack routing below. */
  function send(message: ClientMessage): boolean {
    if (!currentGameId) {
      socketLog.warn('Send dropped — no active game', { type: message.type })
      return false
    }
    if (message.type === 'chat' || message.type === 'ping_map') {
      // Non-action signals ride their own ingress: POST /api/game/signal
      // re-broadcasts them to the recipients' Ably channels (sender included
      // — your own line coming back is the delivery confirmation).
      void _postSignal(message)
      return true
    }
    // Stamp every order with the batch it's aimed at, mirroring
    // useGameSocket's send: the cycle the player saw OPEN when they typed it.
    let action = message
    if (action.forCycle === undefined && gameStore.cycle > 0) {
      action = { ...action, forCycle: gameStore.cycle, clientSeq: ++actionSeq }
    }
    void _postAction(action)
    return true
  }

  async function _postSignal(message: Extract<ClientMessage, { type: 'chat' | 'ping_map' }>) {
    try {
      const res = await fetch('/api/game/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: currentGameId, signal: message }),
      })
      if (!res.ok) {
        socketLog.warn('Signal POST rejected', { status: res.status, type: message.type })
        gameStore.addAnnouncement('[CHAT] Message failed to send', 'warning')
      }
    } catch (err) {
      socketLog.warn('Signal POST errored', { err })
      gameStore.addAnnouncement('[CHAT] Message failed to send', 'warning')
    }
  }

  async function _postAction(message: Extract<ClientMessage, { type: 'action' }>) {
    const gameId = currentGameId
    try {
      // POST /api/game/action → pending_actions, drained by the next tick;
      // responds with the same ActionAckMessage shape the WS path echoed.
      const res = await fetch('/api/game/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameId,
          command: message.command,
          forCycle: message.forCycle,
          clientSeq: message.clientSeq,
        }),
      })
      if (!res.ok) {
        // A transport/HTTP failure is NOT the same thing as the server's own
        // 'late'/'future' rejection reasons — don't fabricate one of those
        // reasons for a request that never got a server verdict.
        socketLog.warn('Action POST rejected', { status: res.status })
        gameStore.markOrderRejected()
        gameStore.addAnnouncement('[CYCLE] Order failed to reach the server — retype it', 'warning')
        return
      }
      const body = (await res.json()) as ActionAckMessage
      const ack: ServerMessage = { ...body, type: 'action_ack' }
      routeServerMessage(gameStore, ack, { disconnect })
      _notifyHandlers(ack)
    } catch (err) {
      socketLog.warn('Action POST errored', { err })
      gameStore.markOrderRejected()
      gameStore.addAnnouncement('[CYCLE] Order failed to reach the server — retype it', 'warning')
    }
  }

  function onMessage(handler: (msg: ServerMessage) => void) {
    handlers.push(handler)
    return () => {
      const idx = handlers.indexOf(handler)
      if (idx !== -1) handlers.splice(idx, 1)
    }
  }

  function _notifyHandlers(msg: ServerMessage) {
    for (const handler of handlers) handler(msg)
  }

  function _startPing() {
    _stopPing()
    pingTimer = setInterval(async () => {
      if (!client || client.connection.state !== 'connected') return
      try {
        latency.value = await client.connection.ping()
      } catch {
        // Transient ping failure — leave the last known latency displayed.
      }
    }, PING_INTERVAL)
  }

  function _stopPing() {
    if (pingTimer) {
      clearInterval(pingTimer)
      pingTimer = null
    }
  }

  function _teardown() {
    _stopPing()
    if (channel) {
      channel.unsubscribe()
      channel = null
    }
    if (client) {
      client.close()
      client = null
    }
  }

  function disconnect() {
    _teardown()
    connected.value = false
    reconnecting.value = false
    currentGameId = null
    currentPlayerId = null
  }

  onUnmounted(() => {
    disconnect()
  })

  return {
    connected,
    reconnecting,
    connectionLost,
    latency,
    connect,
    send,
    onMessage,
    disconnect,
  }
}
