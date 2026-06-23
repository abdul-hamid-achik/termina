// Pure view helpers for the replay scrubber (app/pages/replay/[gameId].vue).
// Extracted so the branchy command-formatting + scrub-clamp logic is unit-tested
// independently of the page's data-fetching and template.

export interface ReplayCommand {
  type: string
  [k: string]: unknown
}

/**
 * Human label for a replayed action-log command. Mirrors the in-game command
 * vocabulary; an unrecognised command type falls through to its bare name rather
 * than dumping raw JSON.
 */
export function formatReplayCommand(cmd: ReplayCommand): string {
  switch (cmd.type) {
    case 'move':
      return `move → ${String(cmd['zone'] ?? '?')}`
    case 'attack': {
      const t = cmd['target'] as { kind?: string; id?: string } | undefined
      return `attack ${t?.kind ?? ''} ${t?.id ?? ''}`.trim()
    }
    case 'cast':
      return `cast ${String(cmd['ability'] ?? '?')}`
    case 'buy':
      return `buy ${String(cmd['item'] ?? '?')}`
    case 'sell':
      return `sell ${String(cmd['item'] ?? '?')}`
    case 'buyback':
      return 'buyback'
    case 'surrender':
      return `surrender (${String(cmd['vote'] ?? '?')})`
    case 'select_talent':
      return `talent tier${String(cmd['tier'] ?? '?')}`
    case 'place_ward':
      return `ward ${String(cmd['kind'] ?? '?')} @ ${String(cmd['zone'] ?? '?')}`
    default:
      return cmd.type
  }
}

/**
 * Clamp a scrub position to a valid frame index. Frames are indexed by tick
 * (0..N-1); scrubbing past the end pins to the last frame, before the start
 * pins to the first. Returns -1 when there are no frames (caller renders the
 * snapshot fallback instead).
 */
export function clampFrameIndex(frameCount: number, scrubTick: number): number {
  if (frameCount <= 0) return -1
  if (scrubTick < 0) return 0
  return Math.min(scrubTick, frameCount - 1)
}

/**
 * The next playback position, one tick on, capped at the final tick — drives the
 * replay's play/pause auto-advance. Stays at `max` once reached (the caller stops
 * the timer there).
 */
export function nextScrubTick(current: number, max: number): number {
  if (max <= 0) return 0
  return Math.min(current + 1, max)
}
