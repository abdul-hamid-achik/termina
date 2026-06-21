import type { PlayerVisibleState } from '~~/shared/types/game'

/**
 * Per-player last-sent state cache for delta compression.
 *
 * The engine uses immutable spread updates — unchanged fields keep the same
 * object reference across ticks. `filterStateForPlayer` passes through several
 * fields by reference (teams, towers, ancients, roshan, aegis, runes, neutrals,
 * timeOfDay, dayNightTick, mapId, mode, tutorialStep). By comparing each field
 * by reference (===, O(1)), we can skip re-sending fields that didn't change.
 *
 * Fields that are always new objects (players, zones, creeps, events,
 * visibleZones) are always sent — the engine rebuilds them each tick.
 *
 * On reconnect, the caller sends a full_state (not a delta) to resync.
 */

/** Compute the delta: only the fields that changed since lastSent. */
export function computeDelta(
  current: PlayerVisibleState,
  lastSent: PlayerVisibleState | null,
): Partial<PlayerVisibleState> {
  if (!lastSent) return current // First tick or post-reconnect — send full state

  const delta: Partial<PlayerVisibleState> = { tick: current.tick }
  let hasChanges = false

  // Always-changed fields: include unconditionally.
  delta.players = current.players
  delta.zones = current.zones
  delta.creeps = current.creeps
  delta.events = current.events
  delta.visibleZones = current.visibleZones
  hasChanges = true

  // Delta-able fields: include only when the reference changed.
  if (current.phase !== lastSent.phase) {
    delta.phase = current.phase
    hasChanges = true
  }
  if (current.teams !== lastSent.teams) {
    delta.teams = current.teams
    hasChanges = true
  }
  if (current.towers !== lastSent.towers) {
    delta.towers = current.towers
    hasChanges = true
  }
  if (current.ancients !== lastSent.ancients) {
    delta.ancients = current.ancients
    hasChanges = true
  }
  if (current.neutrals !== lastSent.neutrals) {
    delta.neutrals = current.neutrals
    hasChanges = true
  }
  if (current.runes !== lastSent.runes) {
    delta.runes = current.runes
    hasChanges = true
  }
  if (current.roshan !== lastSent.roshan) {
    delta.roshan = current.roshan
    hasChanges = true
  }
  if (current.aegis !== lastSent.aegis) {
    delta.aegis = current.aegis
    hasChanges = true
  }
  if (current.timeOfDay !== lastSent.timeOfDay) {
    delta.timeOfDay = current.timeOfDay
    hasChanges = true
  }
  if (current.dayNightTick !== lastSent.dayNightTick) {
    delta.dayNightTick = current.dayNightTick
    hasChanges = true
  }
  if (current.mapId !== lastSent.mapId) {
    delta.mapId = current.mapId
    hasChanges = true
  }
  if (current.mode !== lastSent.mode) {
    delta.mode = current.mode
    hasChanges = true
  }
  if (current.tutorialStep !== lastSent.tutorialStep) {
    delta.tutorialStep = current.tutorialStep
    hasChanges = true
  }

  return hasChanges ? delta : { tick: current.tick }
}

/**
 * The last-sent state cache, organized as a per-game sub-Map for O(1) cleanup.
 * Outer key = gameId, inner key = playerId. Cleared on game over / disconnect
 * to force a full resync on reconnect.
 */
const lastSentCache = new Map<string, Map<string, PlayerVisibleState>>()

/** Record the state sent to a player this tick (for next tick's delta). */
export function recordSentState(gameId: string, playerId: string, state: PlayerVisibleState): void {
  let gameMap = lastSentCache.get(gameId)
  if (!gameMap) {
    gameMap = new Map()
    lastSentCache.set(gameId, gameMap)
  }
  gameMap.set(playerId, state)
}

/** Clear the cache for a player (forces full_state on next tick). */
export function clearSentState(gameId: string, playerId: string): void {
  lastSentCache.get(gameId)?.delete(playerId)
}

/** Clear all caches for a game (on game over). O(1) — drops the entire sub-Map. */
export function clearGameSentStates(gameId: string): void {
  lastSentCache.delete(gameId)
}

/** Get the last-sent state for a player (for delta computation). */
export function getSentState(gameId: string, playerId: string): PlayerVisibleState | null {
  return lastSentCache.get(gameId)?.get(playerId) ?? null
}
