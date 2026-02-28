import { ref, onUnmounted } from 'vue'
import type { ClientMessage, ServerMessage } from '~~/shared/types/protocol'
import { useGameStore } from '~/stores/game'
import { socketLog } from '~/utils/logger'

const MAX_RECONNECT_DELAY = 30_000
const HEARTBEAT_INTERVAL = 10_000

export function useGameSocket() {
  const connected = ref(false)
  const reconnecting = ref(false)
  const latency = ref(0)

  let ws: WebSocket | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempts = 0
  let currentGameId: string | null = null
  let currentPlayerId: string | null = null
  let lastPingTime = 0
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

  function _open() {
    if (ws) {
      ws.onclose = null
      ws.close()
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${window.location.host}/ws?playerId=${currentPlayerId}&gameId=${currentGameId}`
    socketLog.debug('Connecting', { url })
    ws = new WebSocket(url)

    ws.onopen = () => {
      socketLog.info('Connected', { gameId: currentGameId })
      connected.value = true
      reconnecting.value = false
      reconnectAttempts = 0
      _startHeartbeat()

      // If connecting to a game (not lobby), send join_game to register ctx.gameId on server
      if (currentGameId && currentPlayerId) {
        if (currentGameId !== 'lobby') {
          send({ type: 'join_game', gameId: currentGameId })
        }
      }
    }

    ws.onmessage = (event) => {
      let msg: ServerMessage
      try {
        msg = JSON.parse(event.data)
      } catch {
        return
      }

      // Measure latency from heartbeat round-trip
      if (lastPingTime && msg.type === 'announcement') {
        latency.value = Date.now() - lastPingTime
      }

      socketLog.trace(`Received: ${msg.type}`, { type: msg.type, ...('tick' in msg ? { tick: msg.tick } : {}) })

      // Route to game store
      switch (msg.type) {
        case 'tick_state':
          gameStore.updateFromTick(msg)
          break
        case 'events':
          gameStore.addEvents(msg.events)
          break
        case 'announcement':
          gameStore.addAnnouncement(msg.message)
          break
        case 'error':
          socketLog.warn('Server error', { code: msg.code, message: msg.message })
          gameStore.addAnnouncement(`[ERROR] ${msg.message}`)
          break
        case 'game_over':
          gameStore.setGameOver(msg.winner, msg.stats)
          break
      }

      // Notify all registered handlers
      for (const handler of handlers) {
        handler(msg)
      }
    }

    ws.onclose = () => {
      socketLog.warn('Disconnected', { gameId: currentGameId })
      connected.value = false
      _stopHeartbeat()
      _scheduleReconnect()
    }

    ws.onerror = () => {
      // onclose will fire after onerror
    }
  }

  function send(message: ClientMessage) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      socketLog.trace(`Sending: ${message.type}`, { type: message.type })
      ws.send(JSON.stringify(message))
    }
  }

  function onMessage(handler: (msg: ServerMessage) => void) {
    handlers.push(handler)
    return () => {
      const idx = handlers.indexOf(handler)
      if (idx !== -1) handlers.splice(idx, 1)
    }
  }

  function disconnect() {
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
    heartbeatTimer = setInterval(() => {
      lastPingTime = Date.now()
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
    // Don't reconnect if intentionally disconnected or if this was a lobby connection
    if (!currentGameId || !currentPlayerId || currentGameId === 'lobby') return
    reconnecting.value = true
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY)
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
    latency,
    connect,
    send,
    onMessage,
    disconnect,
  }
}
