// Global peer tracking for pre-game WebSocket messages.
// Players register when they connect, before they join a game.
// This allows lobby and game-server to send messages to players
// who aren't yet registered with WebSocketService (via addConnection).

const peers = new Map<string, { send: (data: string) => void }>()

export function registerPeer(playerId: string, peer: { send: (data: string) => void }) {
  peers.set(playerId, peer)
}

export function unregisterPeer(playerId: string) {
  peers.delete(playerId)
}

export function sendToPeer(playerId: string, message: unknown) {
  const peer = peers.get(playerId)
  if (peer) peer.send(JSON.stringify(message))
}
