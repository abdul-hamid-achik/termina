import type { ServerMessage } from '~~/shared/types/protocol'
import { peerLog } from '~~/server/utils/log'

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

/** Whether a player currently has a live WS peer connected. */
export function hasPeer(playerId: string): boolean {
  return peers.has(playerId)
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

export function sendToPeer(playerId: string, message: ServerMessage): boolean {
  const entry = peers.get(playerId)
  if (!entry) {
    peerLog.warn('No peer found — message dropped', {
      playerId,
      type: message.type,
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

// ── Multi-instance: player location tracking ────────────────────
// When the game runs on multiple DO instances, sendToPeer may fail because the
// player's WS is connected to a different instance. The relay service (Phase 2
// of P4) publishes the message to the target instance's Redis channel. This
// requires knowing which instance holds the player — tracked in the Redis hash
// termina:player_location.
//
// Phase 1 (this file): register/unregister the local peer's presence in Redis
// so other instances can find them. Phase 2 (relay subscriber) will use this
// to route messages.

/** Redis key for the player→instance location hash. */
export const PLAYER_LOCATION_KEY = 'termina:player_location'

/** This instance's unique ID (generated on boot). */
let _instanceId: string | null = null

export function setInstanceId(id: string): void {
  _instanceId = id
}

export function getInstanceId(): string | null {
  return _instanceId
}

// ── Multi-instance: relay support ────────────────────────────────
// When sendToPeer finds no local peer, the caller can relay the message to
// the instance that holds the player's WS. This requires a Redis-backed
// lookup + publish. The relay functions are injected by the game-server plugin
// (which has the RedisService) so PeerRegistry stays free of Effect imports.

let _relayLookup: ((playerId: string) => Promise<string | null>) | null = null
let _relayPublish:
  | ((instanceId: string, playerId: string, message: ServerMessage) => Promise<void>)
  | null = null

/** Wire up the Redis-backed relay (called by game-server plugin on boot). */
export function configureRelay(options: {
  lookup: (playerId: string) => Promise<string | null>
  publish: (instanceId: string, playerId: string, message: ServerMessage) => Promise<void>
}): void {
  _relayLookup = options.lookup
  _relayPublish = options.publish
}

/**
 * Send a message to a player, locally first, then via Redis relay if the
 * player is on another instance. Returns true if delivered (locally or via
 * relay), false if the player is unreachable.
 *
 * In single-instance mode (no relay configured), this is identical to the
 * old sendToPeer — the relay is a no-op.
 */
export async function sendToPeerRelay(playerId: string, message: ServerMessage): Promise<boolean> {
  // Try local delivery first.
  if (sendToPeer(playerId, message)) return true

  // No local peer — try the relay if configured.
  if (!_relayLookup || !_relayPublish) return false

  try {
    const targetInstance = await _relayLookup(playerId)
    if (!targetInstance) return false
    await _relayPublish(targetInstance, playerId, message)
    return true
  } catch (err) {
    peerLog.warn('Relay delivery failed', { playerId, error: String(err) })
    return false
  }
}
