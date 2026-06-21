/**
 * Spectator registry — tracks live, non-player WebSocket peers subscribed to
 * a game's tick stream. Mirrors PeerRegistry's pattern but indexed by gameId
 * since spectators have no playerId.
 *
 * A spectator is identified by an opaque "spectator id" (the WS peer's
 * unique key) and is associated with exactly one game at a time. Calling
 * `addSpectator` for the same id moves them between games.
 *
 * Two indexes are maintained:
 *  - `spectators`: spectatorId → entry (for add/remove by id)
 *  - `gameIndex`:  gameId → Set<spectatorId> (for O(1) lookup by game)
 */

import { peerLog } from '~~/server/utils/log'

type Peer = { send: (data: string) => void }

interface SpectatorEntry {
  gameId: string
  peer: Peer
}

const spectators = new Map<string, SpectatorEntry>()
const gameIndex = new Map<string, Set<string>>()

/** Subscribe a peer as a spectator of `gameId`. Idempotent for the same peer. */
export function addSpectator(spectatorId: string, gameId: string, peer: Peer): void {
  // If already spectating a different game, remove from that game's set first.
  const existing = spectators.get(spectatorId)
  if (existing && existing.gameId !== gameId) {
    const oldSet = gameIndex.get(existing.gameId)
    oldSet?.delete(spectatorId)
    if (oldSet && oldSet.size === 0) gameIndex.delete(existing.gameId)
  }

  spectators.set(spectatorId, { gameId, peer })
  let set = gameIndex.get(gameId)
  if (!set) {
    set = new Set()
    gameIndex.set(gameId, set)
  }
  set.add(spectatorId)
  peerLog.debug('Spectator added', { spectatorId, gameId })
}

/** Remove a spectator entirely. */
export function removeSpectator(spectatorId: string): void {
  const entry = spectators.get(spectatorId)
  if (!entry) return
  spectators.delete(spectatorId)
  const set = gameIndex.get(entry.gameId)
  set?.delete(spectatorId)
  if (set && set.size === 0) gameIndex.delete(entry.gameId)
  peerLog.debug('Spectator removed', { spectatorId })
}

/** Get all spectator peers watching `gameId`. O(1) via reverse index. */
export function getSpectatorsOfGame(gameId: string): Peer[] {
  const set = gameIndex.get(gameId)
  if (!set) return []
  const peers: Peer[] = []
  for (const id of set) {
    const entry = spectators.get(id)
    if (entry) peers.push(entry.peer)
  }
  return peers
}

/** Total number of spectators watching `gameId`. O(1) via reverse index. */
export function spectatorCount(gameId: string): number {
  return gameIndex.get(gameId)?.size ?? 0
}

/** Drop all spectators watching `gameId`. Call on game-over / shutdown. */
export function clearGameSpectators(gameId: string): void {
  const set = gameIndex.get(gameId)
  if (!set) return
  for (const id of set) {
    spectators.delete(id)
  }
  gameIndex.delete(gameId)
}

/** Test helper — wipe everything. */
export function _resetSpectatorRegistry(): void {
  spectators.clear()
  gameIndex.clear()
}
