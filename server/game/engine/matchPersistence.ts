/**
 * Derived ladder/stats may only run after the match row itself is durable.
 * Applying MMR/W-L without a match record desyncs history from the ladder.
 */
export function shouldApplyDerivedMatchStats(matchPersisted: boolean): boolean {
  return matchPersisted
}
