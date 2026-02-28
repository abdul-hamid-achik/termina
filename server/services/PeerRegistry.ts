import { peerLog } from '../utils/log'

// Global peer tracking for pre-game WebSocket messages.
// Players register when they connect, before they join a game.
// This allows lobby and game-server to send messages to players
// who aren't yet registered with WebSocketService (via addConnection).
//
// We store both the crossws peer (for use within handlers) and the raw
// websocket (for reliable send from outside handlers — e.g. matchmaking timers).
// On Bun, crossws peer.send() may not deliver when called outside handler scope.

type CrosswsPeer = { send: (data: string) => void }
type RawWs = { send: (data: string | ArrayBuffer | Uint8Array) => number | undefined }

interface PeerEntry {
  crosswsPeer: CrosswsPeer
  rawWs: RawWs
}

const peers = new Map<string, PeerEntry>()

export function registerPeer(
  playerId: string,
  crosswsPeer: CrosswsPeer,
  rawWs: RawWs | null | undefined,
) {
  // If rawWs is unavailable (some crossws adapters), fall back to the crossws peer
  peers.set(playerId, { crosswsPeer, rawWs: rawWs ?? crosswsPeer })
}

export function unregisterPeer(playerId: string, peer: CrosswsPeer) {
  const entry = peers.get(playerId)
  // Only remove if the stored peer is the one being unregistered.
  // This prevents a race where an old socket's close event removes
  // a newer socket that already re-registered under the same playerId.
  if (entry && entry.crosswsPeer === peer) {
    peers.delete(playerId)
  }
}

// Track player → gameId for HTTP polling fallback
const playerGames = new Map<string, string>()

export function setPlayerGame(playerId: string, gameId: string) {
  playerGames.set(playerId, gameId)
}

export function getPlayerGame(playerId: string): string | undefined {
  return playerGames.get(playerId)
}

export function clearPlayerGame(playerId: string) {
  playerGames.delete(playerId)
}

export function sendToPeer(playerId: string, message: unknown) {
  const entry = peers.get(playerId)
  if (!entry) {
    peerLog.warn('No peer found — message dropped', { playerId, type: (message as { type?: string }).type })
    return
  }
  const data = JSON.stringify(message)
  try {
    // Use the raw websocket for reliable delivery outside handler scope
    entry.rawWs.send(data)
  } catch {
    try {
      // Fall back to crossws peer
      entry.crosswsPeer.send(data)
    } catch {
      peerLog.warn('Failed to send', { playerId, type: (message as { type?: string }).type })
    }
  }
}
