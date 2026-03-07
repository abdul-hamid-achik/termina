import { peerLog } from '../utils/log'

type CrosswsPeer = { send: (data: string) => void }
type RawWs = { send: (data: string | ArrayBuffer | Uint8Array) => number | undefined }

interface PeerEntry {
  crosswsPeer: CrosswsPeer
  rawWs: RawWs | CrosswsPeer
}

const peers = new Map<string, PeerEntry>()

export function registerPeer(
  playerId: string,
  crosswsPeer: CrosswsPeer,
  rawWs: RawWs | CrosswsPeer | null | undefined,
) {
  peers.set(playerId, { crosswsPeer, rawWs: rawWs ?? crosswsPeer })
}

export function unregisterPeer(playerId: string, peer: CrosswsPeer) {
  const entry = peers.get(playerId)
  if (entry && entry.crosswsPeer === peer) {
    peers.delete(playerId)
  }
}

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

export function sendToPeer(playerId: string, message: unknown): boolean {
  const entry = peers.get(playerId)
  if (!entry) {
    peerLog.warn('No peer found — message dropped', {
      playerId,
      type: (message as { type?: string }).type,
    })
    return false
  }
  const data = JSON.stringify(message)
  try {
    entry.crosswsPeer.send(data)
    return true
  } catch (err) {
    try {
      entry.rawWs.send(data)
      return true
    } catch {
      peerLog.warn('Failed to send to peer', {
        playerId,
        type: (message as { type?: string }).type,
        error: String(err),
      })
      return false
    }
  }
}
