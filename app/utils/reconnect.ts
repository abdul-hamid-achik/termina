/**
 * Exponential-backoff delay (ms) for the Nth reconnect attempt (0-indexed),
 * capped at `maxMs`. Shared by the game socket (useGameSocket) and the spectator
 * stream so both back off on the same schedule: 1s, 2s, 4s, 8s, … up to the cap.
 *
 * attempt 0 → baseMs (the first retry waits one base interval). Negative
 * attempts are treated as 0 rather than producing a sub-base delay.
 */
export function reconnectDelay(attempt: number, baseMs = 1000, maxMs = 30_000): number {
  return Math.min(baseMs * 2 ** Math.max(0, attempt), maxMs)
}
