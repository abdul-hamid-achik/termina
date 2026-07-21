import type { ServerMessage } from '~~/shared/types/protocol'
import { peerLog } from '~~/server/utils/log'

type CrosswsPeer = { send: (data: string) => void }
type RawWs = { send: (data: string | ArrayBuffer | Uint8Array) => number | undefined }

interface PeerEntry {
  crosswsPeer: CrosswsPeer
  rawWs: RawWs | CrosswsPeer
}

const peers = new Map<string, PeerEntry>()
const playerGames = new Map<string, string>()
/** Reverse index: gameId → Set<playerId>, kept in sync with playerGames. */
const gamePlayers = new Map<string, Set<string>>()
/** Team cache: playerId → team, set once when the player joins a game.
 *  Avoids rebuilding the full reconnect payload just to route team chat. */
const playerTeams = new Map<string, string>()

export function registerPeer(
  playerId: string,
  crosswsPeer: CrosswsPeer,
  rawWs: RawWs | CrosswsPeer | null | undefined,
) {
  peers.set(playerId, { crosswsPeer, rawWs: rawWs ?? crosswsPeer })
}

/** Remove a peer and clean up any game association. */
export function unregisterPeer(playerId: string, peer: CrosswsPeer) {
  const entry = peers.get(playerId)
  if (entry && entry.crosswsPeer === peer) {
    peers.delete(playerId)
  }
}

/** Unconditionally remove a player's peer entry (no identity guard, unlike
 *  {@link unregisterPeer}). Used by WebSocketService.removeConnection, whose
 *  caller (the WS-route grace timer) already guarantees the player is gone for
 *  good — a reconnect cancels the pending removeConnection, so this never nukes
 *  a live reconnected peer. Without it, direct sendToPeer sends keep reaching a
 *  "removed" player because removing the game association alone doesn't drop the
 *  peer the send path looks up. */
export function removePeer(playerId: string): void {
  peers.delete(playerId)
}

export function setPlayerGame(playerId: string, gameId: string) {
  const oldGame = playerGames.get(playerId)
  if (oldGame === gameId) return
  if (oldGame) {
    const oldSet = gamePlayers.get(oldGame)
    oldSet?.delete(playerId)
    if (oldSet && oldSet.size === 0) gamePlayers.delete(oldGame)
  }
  playerGames.set(playerId, gameId)
  let set = gamePlayers.get(gameId)
  if (!set) {
    set = new Set()
    gamePlayers.set(gameId, set)
  }
  set.add(playerId)
}

export function getPlayerGame(playerId: string): string | undefined {
  return playerGames.get(playerId)
}

/** Set a player's team (cached when they join a game for chat routing). */
export function setPlayerTeam(playerId: string, team: string): void {
  playerTeams.set(playerId, team)
}

/** Get a player's team (O(1) cache lookup, no state rebuild needed). */
export function getPlayerTeam(playerId: string): string | undefined {
  return playerTeams.get(playerId)
}

/** Get all player IDs assigned to a game (reverse index, O(1)). */
export function getGamePlayers(gameId: string): string[] {
  const set = gamePlayers.get(gameId)
  return set ? [...set] : []
}

export function clearPlayerGame(playerId: string) {
  const gameId = playerGames.get(playerId)
  if (gameId) {
    const set = gamePlayers.get(gameId)
    set?.delete(playerId)
    if (set && set.size === 0) gamePlayers.delete(gameId)
  }
  playerGames.delete(playerId)
  playerTeams.delete(playerId)
}

/** Get the raw WS peer for a player (best-effort, for connection maps). */
export function getPeer(playerId: string): CrosswsPeer | undefined {
  return peers.get(playerId)?.crosswsPeer
}

export function sendToPeer(playerId: string, message: ServerMessage): boolean {
  return sendToPeerRaw(playerId, JSON.stringify(message))
}

/** Send a pre-serialized JSON string to a player's peer. Used by
 *  WebSocketService broadcasts to avoid re-serializing per-recipient.
 *  Returns false and removes the peer if the send fails on both paths
 *  (dead-connection cleanup). */
export function sendToPeerRaw(playerId: string, data: string): boolean {
  const entry = peers.get(playerId)
  if (!entry) {
    peerLog.warn('No peer found — message dropped', { playerId })
    return false
  }
  try {
    entry.crosswsPeer.send(data)
    return true
  } catch (err) {
    try {
      entry.rawWs.send(data)
      return true
    } catch {
      // Both send paths failed — the connection is dead. Remove the peer
      // and its game association so future broadcasts skip it.
      peerLog.warn('Peer send failed on both paths — removing dead peer', {
        playerId,
        error: String(err),
      })
      peers.delete(playerId)
      const gameId = playerGames.get(playerId)
      if (gameId) {
        const set = gamePlayers.get(gameId)
        set?.delete(playerId)
        if (set && set.size === 0) gamePlayers.delete(gameId)
        playerGames.delete(playerId)
      }
      playerTeams.delete(playerId)
      return false
    }
  }
}
