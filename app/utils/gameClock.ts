// A game tick is 4 seconds (TICK_DURATION_MS in shared/constants/balance.ts).
const SECONDS_PER_TICK = 4

/** Format a seconds count as a clock — "M:SS" by default, "MM:SS" when padded. */
export function formatSeconds(seconds: number, padMinutes = false): string {
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  const mm = padMinutes ? String(minutes).padStart(2, '0') : String(minutes)
  return `${mm}:${String(secs).padStart(2, '0')}`
}

/**
 * Format a tick count as a game clock string. `padMinutes` selects "MM:SS"
 * (header / scoreboard) vs "M:SS" (inline logs). Faithfully mirrors the inline
 * formatting it replaced across the UI — no clamping; callers that need a floor
 * of 0 should clamp the tick before calling (e.g. `Math.max(0, ticks)`).
 */
export function formatTickClock(tick: number, padMinutes = false): string {
  return formatSeconds(tick * SECONDS_PER_TICK, padMinutes)
}
