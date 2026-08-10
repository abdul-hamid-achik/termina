import type { MatchPersistenceResult } from '~~/server/services/DatabaseService'

/**
 * Derived ladder/stats may run after the match row itself is durable. Both a
 * fresh insert and an idempotent retry are valid inputs: the DB transaction
 * claims `matches.derived_stats_applied` and makes the second attempt a no-op.
 * A failed match write must never mutate the ladder.
 */
export function shouldApplyDerivedMatchStats(result: MatchPersistenceResult): boolean {
  return result === 'inserted' || result === 'already_exists'
}
