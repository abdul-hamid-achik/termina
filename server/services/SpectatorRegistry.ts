/**
 * Spectator registry — tracks live, non-player WebSocket peers subscribed to
 * a game's tick stream. Mirrors PeerRegistry's pattern but indexed by gameId
 * since spectators have no playerId.
 *
 * A spectator is identified by an opaque "spectator id" (the WS peer's
 * unique key) and is associated with exactly one game at a time. Calling
 * `addSpectator` for the same id moves them between games.
 */

import { peerLog } from '~~/server/utils/log'

type Peer = { send: (data: string) => void }

interface SpectatorEntry {
  gameId: string
  peer: Peer
}

const spectators = new Map<string, SpectatorEntry>()

/** Subscribe a peer as a spectator of `gameId`. Idempotent for the same peer. */
export function addSpectator(spectatorId: string, gameId: string, peer: Peer): void {
  spectators.set(spectatorId, { gameId, peer })
  peerLog.debug('Spectator added', { spectatorId, gameId })
}

/** Remove a spectator entirely. */
export function removeSpectator(spectatorId: string): void {
  if (spectators.delete(spectatorId)) {
    peerLog.debug('Spectator removed', { spectatorId })
  }
}

/** Get all spectator peers watching `gameId`. */
export function getSpectatorsOfGame(gameId: string): Peer[] {
  const peers: Peer[] = []
  for (const entry of spectators.values()) {
    if (entry.gameId === gameId) peers.push(entry.peer)
  }
  return peers
}

/** Total number of spectators watching `gameId`. */
export function spectatorCount(gameId: string): number {
  let n = 0
  for (const entry of spectators.values()) {
    if (entry.gameId === gameId) n++
  }
  return n
}

/** Drop all spectators watching `gameId`. Call on game-over / shutdown. */
export function clearGameSpectators(gameId: string): void {
  for (const [id, entry] of spectators.entries()) {
    if (entry.gameId === gameId) spectators.delete(id)
  }
}

/** Test helper — wipe everything. */
export function _resetSpectatorRegistry(): void {
  spectators.clear()
}
