// A game cycle is 4 seconds (CYCLE_DURATION_MS in shared/constants/balance.ts).
const SECONDS_PER_CYCLE = 4

/** Format a seconds count as a clock — "M:SS" by default, "MM:SS" when padded. */
export function formatSeconds(seconds: number, padMinutes = false): string {
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  const mm = padMinutes ? String(minutes).padStart(2, '0') : String(minutes)
  return `${mm}:${String(secs).padStart(2, '0')}`
}

/**
 * Format a cycle count as a game clock string. `padMinutes` selects "MM:SS"
 * (header / scoreboard) vs "M:SS" (inline logs). Faithfully mirrors the inline
 * formatting it replaced across the UI — no clamping; callers that need a floor
 * of 0 should clamp the cycle before calling (e.g. `Math.max(0, cycles)`).
 */
export function formatTickClock(cycle: number, padMinutes = false): string {
  return formatSeconds(cycle * SECONDS_PER_CYCLE, padMinutes)
}
