import { ref, onUnmounted } from 'vue'
import type { ClientMessage, ServerMessage } from '~~/shared/types/protocol'
import { useGameStore } from '~/stores/game'
import { socketLog } from '~/utils/logger'
import { reconnectDelay } from '~/utils/reconnect'
import { routeServerMessage } from '~/utils/gameMessageRouter'

const MAX_RECONNECT_DELAY = 30_000
const MAX_RECONNECT_ATTEMPTS = 20
const HEARTBEAT_INTERVAL = 10_000
// Heartbeats that may go unacked before the connection is declared dead.
// The dev WS proxy chain can drop the server side of a socket without the
// browser ever seeing a close frame — a half-open socket looks "connected"
// forever and silently receives nothing. Two missed acks (~20s) forces a
// close + reconnect, which the server's `reconnect` path recovers via
// full_state.
const MAX_MISSED_HEARTBEATS = 2

export function useGameSocket() {
  const connected = ref(false)
  const reconnecting = ref(false)
  const connectionLost = ref(false)
  const latency = ref(0)

  let ws: WebSocket | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempts = 0
  // Connection epoch: bumped on every _open() and on disconnect(), so an _open
  // suspended on the async ticket fetch can detect it was superseded (a newer
  // connect/_open) or cancelled (disconnect) and abort instead of building an
  // orphan socket whose handlers write to the store after unmount/navigation.
  let openGen = 0
  let currentGameId: string | null = null
  let currentPlayerId: string | null = null
  let lastPingTime = 0
  let awaitingAck = false
  // Monotonic per-connection order counter, echoed back in action_ack.
  let actionSeq = 0
  let missedHeartbeats = 0
  const handlers: Array<(msg: ServerMessage) => void> = []

  const gameStore = useGameStore()

  function connect(gameId: string, playerId: string) {
    currentGameId = gameId
    currentPlayerId = playerId
    // Only set gameStore.gameId for real game IDs, not the lobby placeholder
    if (gameId !== 'lobby') {
      gameStore.gameId = gameId
    }
    gameStore.playerId = playerId
    reconnectAttempts = 0
    _open()
  }

  async function _open() {
    const myGen = ++openGen
    if (ws) {
      ws.onclose = null
      ws.close()
    }
    connected.value = false

    // Fetch a signed WS ticket via HTTP (auth works over HTTP even when WS proxy loses session)
    let ticket = ''
    try {
      const res = await fetch('/api/auth/ws-ticket')
      if (res.ok) {
        const data = await res.json()
        ticket = data.ticket ?? ''
      }
    } catch {
      // Graceful degradation — try connecting without ticket
    }

    // Superseded (newer _open) or cancelled (disconnect cleared the target)
    // while awaiting the ticket — do NOT build a now-orphan socket.
    if (myGen !== openGen || !currentGameId || !currentPlayerId) {
      connected.value = false
      return
    }

    const wsBase = useWsOrigin()
    let url = `${wsBase}/ws?playerId=${currentPlayerId}&gameId=${currentGameId}`
    if (ticket) {
      url += `&ticket=${encodeURIComponent(ticket)}`
    }
    socketLog.debug('Connecting', { url: url.replace(/ticket=[^&]+/, 'ticket=***') })
    ws = new WebSocket(url)

    ws.onopen = () => {
      socketLog.info('Connected', { gameId: currentGameId, readyState: ws?.readyState })
      connected.value = true
      reconnecting.value = false
      connectionLost.value = false
      const isReconnect = reconnectAttempts > 0
      reconnectAttempts = 0
      _startHeartbeat()

      // If connecting to a game (not lobby), send join_game or reconnect
      if (currentGameId && currentPlayerId && currentGameId !== 'lobby') {
        if (isReconnect) {
          // lastCycle lets the server replay the visible events missed while
          // disconnected; the reconnect response includes a full_state snapshot.
          send({
            type: 'reconnect',
            gameId: currentGameId,
            playerId: currentPlayerId,
            lastCycle: gameStore.cycle > 0 ? gameStore.cycle : undefined,
          })
        } else {
          send({ type: 'join_game', gameId: currentGameId })
        }
      }
    }

    ws.onmessage = (event) => {
      let msg: ServerMessage
      try {
        msg = JSON.parse(event.data)
      } catch {
        socketLog.warn('Failed to parse message', { data: event.data })
        return
      }

      // Any message proves the link is alive
      missedHeartbeats = 0

      // Adapters without native ping/pong receive a protocol probe from the
      // server. Answer it through the normal client heartbeat path so the
      // server can clear its liveness timeout without adding a second wire
      // message shape.
      if (msg.type === 'heartbeat') {
        send({ type: 'heartbeat' })
        return
      }

      // Measure latency from the heartbeat round-trip
      if (msg.type === 'heartbeat_ack') {
        if (lastPingTime) {
          latency.value = Date.now() - lastPingTime
        }
        awaitingAck = false
        return
      }

      socketLog.trace(`Received: ${msg.type}`, {
        type: msg.type,
        ...('cycle' in msg ? { cycle: msg.cycle } : {}),
      })

      // Route to game store — the store-routing half of this switch is
      // shared with the Ably+HTTP transport (useGameChannel.ts) via
      // routeServerMessage; only WS-specific plumbing stays here.
      routeServerMessage(gameStore, msg, { disconnect })

      // Notify all registered handlers
      for (const handler of handlers) {
        handler(msg)
      }
    }

    ws.onclose = (event) => {
      socketLog.warn('Disconnected', {
        gameId: currentGameId,
        code: event.code,
        reason: event.reason,
      })
      connected.value = false
      _stopHeartbeat()
      _scheduleReconnect()
    }

    ws.onerror = (event) => {
      socketLog.error('Socket error', { event })
    }
  }

  /** Returns true if the message went out, false if the socket isn't open
   *  (caller can then buffer/retry instead of assuming the action landed). */
  function send(message: ClientMessage): boolean {
    // Stamp every order with the batch it's aimed at (the cycle the player saw
    // OPEN when they typed it). The server refuses a stamp for a committed
    // batch with an explicit action_ack 'late' instead of silently rolling the
    // order into a batch the player didn't aim at. clientSeq correlates acks
    // when sends race a slow socket. Callers that pre-stamp keep their stamp.
    if (message.type === 'action' && message.forCycle === undefined && gameStore.cycle > 0) {
      message = { ...message, forCycle: gameStore.cycle, clientSeq: ++actionSeq }
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      socketLog.trace(`Sending: ${message.type}`, { type: message.type })
      ws.send(JSON.stringify(message))
      return true
    }
    socketLog.warn('Send dropped — socket not open', {
      type: message.type,
      readyState: ws?.readyState ?? 'none',
    })
    return false
  }

  function onMessage(handler: (msg: ServerMessage) => void) {
    handlers.push(handler)
    return () => {
      const idx = handlers.indexOf(handler)
      if (idx !== -1) handlers.splice(idx, 1)
    }
  }

  function disconnect() {
    openGen++ // invalidate any _open() suspended on the ticket fetch
    _stopHeartbeat()
    _clearReconnect()
    reconnecting.value = false
    if (ws) {
      // Null out all handlers BEFORE closing to prevent:
      // - "WebSocket is closed before the connection is established" errors
      // - Reconnect attempts from onclose
      ws.onopen = null
      ws.onclose = null
      ws.onerror = null
      ws.onmessage = null
      ws.close()
      ws = null
    }
    connected.value = false
    currentGameId = null
    currentPlayerId = null
  }

  function _startHeartbeat() {
    _stopHeartbeat()
    awaitingAck = false
    missedHeartbeats = 0
    heartbeatTimer = setInterval(() => {
      // Previous ping never got acked (and no other message arrived to clear
      // the counter) — the socket may be half-open: the dev proxy chain can
      // drop the server side without delivering a close frame to the browser.
      if (awaitingAck) {
        missedHeartbeats++
        if (missedHeartbeats >= MAX_MISSED_HEARTBEATS) {
          socketLog.warn('Heartbeat acks missing — forcing reconnect', {
            missed: missedHeartbeats,
          })
          missedHeartbeats = 0
          awaitingAck = false
          // Close without handlers (they'd double-schedule) and reconnect.
          if (ws) {
            ws.onclose = null
            try {
              ws.close()
            } catch {
              /* already closed */
            }
            ws = null
          }
          connected.value = false
          _stopHeartbeat()
          _scheduleReconnect()
          return
        }
      }
      lastPingTime = Date.now()
      awaitingAck = true
      send({ type: 'heartbeat' })
    }, HEARTBEAT_INTERVAL)
  }

  function _stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }

  function _scheduleReconnect() {
    // Don't reconnect if intentionally disconnected
    if (!currentGameId || !currentPlayerId) return
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      connectionLost.value = true
      reconnecting.value = false
      socketLog.warn('Max reconnect attempts reached', { attempts: reconnectAttempts })
      return
    }
    reconnecting.value = true
    const delay = reconnectDelay(reconnectAttempts, 1000, MAX_RECONNECT_DELAY)
    reconnectAttempts++
    reconnectTimer = setTimeout(() => {
      _open()
    }, delay)
  }

  function _clearReconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
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
