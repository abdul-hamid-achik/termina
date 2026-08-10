/**
 * Spectator broadcast delay — buffers each watched game's spectator frames
 * and releases them to whoever is currently watching only once they've aged
 * past SPECTATOR_BROADCAST_DELAY_MS (a global constant, NOT player-tunable —
 * see shared/constants/balance.ts). This turns the live spectator stream
 * (server/plugins/game-server.ts onSpectatorTick, fed by the fogless
 * VisionCalculator.filterStateForSpectator payload) from a real-time maphack
 * into a standard tape-delayed broadcast feed.
 *
 * Per watched game (an entry only exists once at least one spectator has been
 * present for a tick — see hasSpectatorBuffer):
 *  - `buffer`: FIFO of not-yet-delivered frames, oldest first. Bounded by
 *    SPECTATOR_BUFFER_MAX_FRAMES — a safety valve for a stalled flush timer,
 *    not something normal operation ever approaches (frames drain every
 *    flush tick as soon as they mature).
 *  - `latestMature`: the most recently DELIVERED frame, kept so a spectator
 *    who joins mid-game gets something immediately instead of waiting out
 *    the whole delay window with nothing on screen.
 *  - `timer`: a per-game interval that periodically checks the buffer head
 *    for maturity and delivers everything that has caught up, in order.
 *    Started lazily on the first enqueued frame; stopped and the entry
 *    dropped once the game-over marker frame is delivered, or by an explicit
 *    `stopSpectatorDelayBuffer` (zombie-game reaper / dev-game teardown).
 *
 * Delivery fans out via SpectatorRegistry.getSpectatorsOfGame at the moment
 * each frame matures — NOT at enqueue time — so a spectator who disconnects
 * and reconnects mid-window simply misses whatever drained while they were
 * away and picks back up via the normal join path (getSpectateJoinInfo).
 */

import { peerLog } from '~~/server/utils/log'
import { getSpectatorsOfGame, clearGameSpectators } from '~~/server/services/SpectatorRegistry'
import {
  SPECTATOR_BROADCAST_DELAY_MS,
  SPECTATOR_BUFFER_MAX_FRAMES,
} from '~~/shared/constants/balance'

/** How often the per-game timer checks the buffer head for maturity. This is
 *  delivery-loop granularity, independent of the game's own cycle cadence. */
const FLUSH_INTERVAL_MS = 1000

interface BufferedFrame {
  cycle: number
  payload: string
  enqueuedAt: number
  /** Marks the final frame for an ended game — once THIS frame delivers, the
   *  whole entry (buffer + timer + latestMature) tears itself down and every
   *  remaining spectator of the game is unsubscribed. */
  isGameOver?: boolean
}

interface GameBufferEntry {
  buffer: BufferedFrame[]
  latestMature: { cycle: number; payload: string } | null
  timer: ReturnType<typeof setInterval> | null
}

const games = new Map<string, GameBufferEntry>()

function ensureTimer(gameId: string, entry: GameBufferEntry): void {
  if (entry.timer) return
  const timer = setInterval(() => flush(gameId), FLUSH_INTERVAL_MS)
  // Never keep the process alive just to drain a spectator buffer.
  ;(timer as unknown as { unref?: () => void }).unref?.()
  entry.timer = timer
}

function stopTimer(entry: GameBufferEntry): void {
  if (entry.timer) {
    clearInterval(entry.timer)
    entry.timer = null
  }
}

function deliver(gameId: string, payload: string): void {
  const watchers = getSpectatorsOfGame(gameId)
  for (const watcher of watchers) {
    try {
      watcher.send(payload)
    } catch (err) {
      peerLog.warn('Delayed spectator send failed', { gameId, error: String(err) })
    }
  }
}

/**
 * Deliver every frame at the head of the buffer whose age has passed the
 * broadcast delay, in enqueue order. Frames are pushed in cycle order, so age
 * only decreases toward the tail — stop at the first immature one. If the
 * drained frame was the game-over marker, tear down the entry (buffer, timer,
 * latestMature) and drop every remaining spectator registration for the game.
 */
function flush(gameId: string, now: number = Date.now()): void {
  const entry = games.get(gameId)
  if (!entry) return

  while (
    entry.buffer.length > 0 &&
    now - entry.buffer[0]!.enqueuedAt >= SPECTATOR_BROADCAST_DELAY_MS
  ) {
    const frame = entry.buffer.shift()!
    entry.latestMature = { cycle: frame.cycle, payload: frame.payload }
    deliver(gameId, frame.payload)
    if (frame.isGameOver) {
      stopTimer(entry)
      games.delete(gameId)
      clearGameSpectators(gameId)
      return
    }
  }
}

/** True once at least one frame has ever been buffered for this game (i.e. it
 *  has had a spectator present for at least one tick and hasn't been torn
 *  down yet). Used to decide whether a new spectator tick should start
 *  buffering (cheap early-out for the common "nobody is watching" case) and
 *  whether game-over needs the deferred drain-then-cleanup path at all. */
export function hasSpectatorBuffer(gameId: string): boolean {
  return games.has(gameId)
}

/**
 * Append a live spectator frame to `gameId`'s buffer instead of sending it
 * immediately. Creates the entry (and starts its flush timer) on first use.
 * Trims from the front (oldest — closest to maturing anyway) if the bound is
 * ever exceeded, logging a warning; this should never trigger in normal
 * operation.
 */
export function enqueueSpectatorFrame(gameId: string, cycle: number, payload: string): void {
  let entry = games.get(gameId)
  if (!entry) {
    entry = { buffer: [], latestMature: null, timer: null }
    games.set(gameId, entry)
  }
  entry.buffer.push({ cycle, payload, enqueuedAt: Date.now() })
  if (entry.buffer.length > SPECTATOR_BUFFER_MAX_FRAMES) {
    const excess = entry.buffer.length - SPECTATOR_BUFFER_MAX_FRAMES
    entry.buffer.splice(0, excess)
    peerLog.warn('Spectator delay buffer exceeded its cap — dropping oldest frames', {
      gameId,
      dropped: excess,
      cap: SPECTATOR_BUFFER_MAX_FRAMES,
    })
  }
  ensureTimer(gameId, entry)
}

/**
 * Queue the final frame for a game that has ended. Requires an existing
 * buffer entry (callers should check `hasSpectatorBuffer` first and skip
 * straight to `clearGameSpectators` if nobody ever watched — there's nothing
 * to drain). The frame drains behind whatever's already buffered, at the same
 * per-frame delay as everything else, so the result never leaks early; once
 * it delivers, the entry and every spectator registration for the game are
 * torn down automatically (see `flush`).
 */
export function enqueueGameOverFrame(gameId: string, cycle: number, payload: string): void {
  const entry = games.get(gameId)
  if (!entry) {
    // Nothing was ever buffered for this game — no drain needed, no watchers
    // to potentially leave subscribed forever.
    clearGameSpectators(gameId)
    return
  }
  entry.buffer.push({ cycle, payload, enqueuedAt: Date.now(), isGameOver: true })
  ensureTimer(gameId, entry)
}

/**
 * What a spectator who just subscribed to `gameId` should receive right now:
 * the latest already-delivered (mature) frame if one exists, otherwise how
 * long until the first one will.
 */
export function getSpectateJoinInfo(
  gameId: string,
  now: number = Date.now(),
): { type: 'mature'; cycle: number; payload: string } | { type: 'delayed'; etaMs: number } {
  const entry = games.get(gameId)
  if (entry?.latestMature) {
    return { type: 'mature', cycle: entry.latestMature.cycle, payload: entry.latestMature.payload }
  }
  const oldest = entry?.buffer[0]
  const etaMs = oldest
    ? Math.max(0, SPECTATOR_BROADCAST_DELAY_MS - (now - oldest.enqueuedAt))
    : SPECTATOR_BROADCAST_DELAY_MS
  return { type: 'delayed', etaMs }
}

/**
 * Force-drop a game's buffer + timer without draining or notifying anyone.
 * For paths where the game is being torn down abnormally and no game-over
 * frame will ever be enqueued (the production liveGames reaper reviving a
 * zombie game, dev-game teardown) — the guarantee that matters there is "no
 * leaked timer/buffer forever", not a faithful drain of a game that's already
 * considered dead.
 */
export function stopSpectatorDelayBuffer(gameId: string): void {
  const entry = games.get(gameId)
  if (!entry) return
  stopTimer(entry)
  games.delete(gameId)
}

/** Test-only helper — wipe every buffer + timer. */
export function _resetSpectatorDelayBuffers(): void {
  for (const entry of games.values()) stopTimer(entry)
  games.clear()
}
