import { ref, onUnmounted } from 'vue'
import * as Ably from 'ably'
import type { ClientMessage, ServerMessage, ActionAckMessage } from '~~/shared/types/protocol'
import type { PlayerVisibleState } from '~~/shared/types/game'
import { useGameStore } from '~/stores/game'
import { socketLog } from '~/utils/logger'
import { routeServerMessage } from '~/utils/gameMessageRouter'
import { GUEST_SESSION_CHANGED_MESSAGE, sessionChangedMessage } from '~/utils/playRoute'

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

/** The code a server error body may carry for "this game is no longer your
 *  session's" (a guest upgraded to an account mid-game, on another tab). */
const SESSION_CHANGED_CODE = 'GAME_SESSION_CHANGED'

/** Ably's "operation not permitted with provided capability" — the token's
 *  player cannot read this channel. */
const CAPABILITY_DENIED_CODE = 40160

/**
 * The message to end the session with when an action/signal POST failure means
 * the game is no longer this session's — a 403 (not assigned: the cookie now
 * names someone else), a 404 (the game is gone), or an explicit
 * GAME_SESSION_CHANGED code, read defensively off h3's error body (`data.code`
 * — ofetch's `err.data.data.code` —, `code`, `statusMessage`). Null for
 * anything transient, which keeps the retry path.
 */
async function sessionEndedMessage(
  res: { status: number; json?: () => Promise<unknown> },
  playerId: string | null,
): Promise<{ message: string; reason: 'finished' | 'changed' } | null> {
  let body: Record<string, unknown> = {}
  try {
    const parsed = (await res.json?.()) as Record<string, unknown> | null
    if (parsed && typeof parsed === 'object') body = parsed
  } catch {
    // Not JSON — judge by the status alone.
  }
  const data = (body.data ?? {}) as Record<string, unknown>
  const code = data.code ?? body.code ?? body.statusMessage
  if (code === SESSION_CHANGED_CODE) {
    // The server says it in its own words (action.post / signal.post 409).
    const message =
      typeof body.message === 'string' && body.message
        ? body.message
        : GUEST_SESSION_CHANGED_MESSAGE
    return { message, reason: 'changed' }
  }
  // The live_games row is gone: the game was finalized — almost always because
  // it ENDED. (A guest practice deleted by a sign-in elsewhere 404s too, but the
  // server also pushes GAME_SESSION_CHANGED on the channel — kept open on a 404
  // — which re-labels the panel 'changed'.) Nothing will accept an order again.
  if (res.status === 404) {
    return { message: 'This game has finished — it is no longer running.', reason: 'finished' }
  }
  if (res.status !== 403) return null
  return {
    message: sessionChangedMessage(playerId),
    reason: 'changed',
  }
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
  // Highest cycle whose events were already fed to the store. A cycle_state
  // that Ably redelivers (resume after a blip) must not print its combat lines
  // a second time — the feed is built from the store's event list.
  let lastIngestedCycle = -1
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
      // (clientId = playerId; subscribe+presence on game:*:p:<playerId>,
      // subscribe on game:*:team:*), derived from the caller's session.
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
    lastIngestedCycle = -1
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
    const attach = channel.subscribe((message) => {
      _handleInbound(message)
    })
    // The token names the session's CURRENT player; a channel keyed to anyone
    // else is refused at attach (40160, capability). That is not a blip to
    // retry: this tab holds a stale id (a guest who signed in elsewhere), and
    // the HUD otherwise sat on "Waiting for the first cycle" forever.
    const subscribedTo = channel
    void Promise.resolve(attach).catch((err: unknown) => {
      if (channel !== subscribedTo) return
      const code = (err as { code?: unknown } | null)?.code
      socketLog.warn('Ably channel attach refused', { channel: channelName, code })
      if (code === CAPABILITY_DENIED_CODE && currentGameId !== 'lobby') {
        gameStore.endSession(
          'This game is not open to the account signed in now — start a new practice or go back to the lobby.',
          'changed',
        )
        disconnect()
      }
    })
    // PRESENCE — the AFK takeover's connection signal. While this page holds
    // the game open, the player is a presence member of their own channel; the
    // server's tick reads that over REST on its AFK checks (every 60 cycles)
    // to tell "here but idle" (4-minute, teammate-gated rule) from "gone"
    // (2-minute rule). Ably re-enters on resume by itself and drops the member
    // ~15s after an unclean disconnect, so there is no manual re-enter here.
    // Non-fatal: without presence the player just reads as "gone" to the AFK
    // check — never worth breaking the subscription over.
    if (currentGameId !== 'lobby') {
      channel.presence.enter().catch((err: unknown) => {
        socketLog.warn('Ably presence enter failed', { err })
      })
    }
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
        if (data.cycle > lastIngestedCycle) {
          lastIngestedCycle = data.cycle
          gameStore.addEvents(data.state.events ?? [])
        }
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
    // The game is over for this session: the request would only be refused
    // again. Not sent — and said so, so a chat line typed under the ended panel
    // is not dropped in silence. (GameScreen stops game actions before they get
    // here, so its "connection unstable, will retry" buffering never sees this.)
    if (gameStore.sessionEnded) {
      gameStore.addAnnouncement(
        gameStore.sessionEndReason === 'finished'
          ? '[GAME] Not sent — this game has finished'
          : '[GAME] Not sent — this game is no longer your session’s',
        'warning',
      )
      return false
    }
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
    // Exception: in the last LATE_STAMP_MS of the window the tick has often
    // already drained. A stamp for the dying cycle is dropped as 'late' and
    // the order vanishes. Leave those unstamped so they land on whatever
    // cycle is open when the POST arrives.
    const LATE_STAMP_MS = 400
    let action = message
    const remaining =
      gameStore.nextCommitAt != null
        ? gameStore.nextCommitAt - Date.now()
        : Number.POSITIVE_INFINITY
    const stampThisCycle =
      action.forCycle === undefined && gameStore.cycle > 0 && remaining >= LATE_STAMP_MS
    if (stampThisCycle) {
      action = { ...action, forCycle: gameStore.cycle, clientSeq: ++actionSeq }
    } else if (action.forCycle === undefined) {
      action = { ...action, clientSeq: ++actionSeq }
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
        const ended = await sessionEndedMessage(res, currentPlayerId)
        if (ended) {
          gameStore.endSession(ended.message, ended.reason)
          if (res.status !== 404) disconnect()
          return
        }
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
        const ended = await sessionEndedMessage(res, currentPlayerId)
        if (ended) {
          // Terminal, not transient: this session no longer owns the game.
          // Stop here — one message, no retry loop, no live channel.
          socketLog.warn('Action POST refused — game no longer this session’s', {
            status: res.status,
          })
          gameStore.endSession(ended.message, ended.reason)
          // A 404 can race a normal ending (finalize deletes the row right after
          // the final tick publishes): keep the channel so a game_over still in
          // flight lands on PostGame, which renders over the ended panel.
          if (res.status !== 404) disconnect()
          return
        }
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
      // Leave before close so the AFK check sees "gone" now, not ~15s later.
      // Best-effort: close() ends the membership anyway.
      channel.presence.leave().catch(() => {})
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
