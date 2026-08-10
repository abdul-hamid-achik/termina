/** Number of consecutive failed cycles before a match is announced as degraded. */
export const TICK_FAILURE_NOTICE_THRESHOLD = 3

interface TickHealth {
  consecutiveFailures: number
  lastFailureAt: number
}

const tickHealth = new Map<string, TickHealth>()

export function recordTickSuccess(gameId: string): void {
  tickHealth.delete(gameId)
}

export function recordTickFailure(gameId: string): TickHealth {
  const next: TickHealth = {
    consecutiveFailures: (tickHealth.get(gameId)?.consecutiveFailures ?? 0) + 1,
    lastFailureAt: Date.now(),
  }
  tickHealth.set(gameId, next)
  return next
}

export function clearGameLoopHealth(gameId: string): void {
  tickHealth.delete(gameId)
}

/** Public operational summary used by the liveness endpoint and tests. */
export function getGameLoopHealthSummary(): {
  degradedGames: number
  totalConsecutiveFailures: number
} {
  let totalConsecutiveFailures = 0
  let degradedGames = 0
  for (const health of tickHealth.values()) {
    totalConsecutiveFailures += health.consecutiveFailures
    if (health.consecutiveFailures >= TICK_FAILURE_NOTICE_THRESHOLD) degradedGames++
  }
  return { degradedGames, totalConsecutiveFailures }
}
