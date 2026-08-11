import { Effect } from 'effect'
import { getGameRuntime } from '~~/server/plugins/game-server'
import type { SnapshotMeta, LoggedAction } from '~~/server/game/engine/replayArtifact'
import {
  reconstructReplay,
  finalSummaryHash,
  REPLAY_RULESET_VERSION,
} from '~~/server/game/engine/replayArtifact'

/**
 * Step-through replay frames — a compact per-cycle player/team summary that
 * the scrubber can render at any cycle T.
 *
 * The frames are produced by re-running every persisted action through
 * processCycle from a freshly-initialised state WITH THE ORIGINAL rngSeed
 * stitched in — resolution is deterministic under the seed, so crits, procs
 * and camp spawns land exactly as they did live.
 *
 * Archive-only (all-Vercel cutover): the only source is the Postgres archive
 * (match_replays) — see replayArtifact.ts's module doc and /api/replay/
 * [gameId].get.ts's doc comment. `verified`: whether the reconstruction's
 * final summary hash matches the recorded game — false means the engine
 * changed since the game was recorded (see rulesetVersion).
 */
export default defineEventHandler(async (event) => {
  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  const gameId = getRouterParam(event, 'gameId')
  if (!gameId) {
    throw createError({ statusCode: 400, message: 'Game ID required' })
  }

  const archived = await Effect.runPromise(runtime.dbService.getMatchReplay(gameId))
  if (!archived) {
    throw createError({ statusCode: 404, message: 'Replay not found' })
  }

  const meta = archived.meta as SnapshotMeta
  const actions = archived.actions as LoggedAction[]
  const rngSeed = archived.rngSeed
  const recordedHash = archived.finalSummaryHash
  const recordedRuleset = archived.rulesetVersion
  const lastRecordedCycle = (archived.finalState as { cycle?: number }).cycle ?? 0
  const integrity = { complete: true, truncated: false, readFailed: false }

  // The last persisted cycle caps the replay length. Snapshots may run a few
  // ticks ahead of the action log if the log was trimmed, so use whichever
  // is bigger as an upper bound.
  const lastActionCycle = actions.reduce((max, a) => (a.cycle > max ? a.cycle : max), 0)
  const lastCycle = Math.max(lastActionCycle, lastRecordedCycle)

  const { frames, finalState } = await reconstructReplay(meta, actions, rngSeed, lastCycle)

  // Honesty check: did the re-run land on the SAME game? False means the
  // engine changed since this was recorded (or the seed is missing on an old
  // artifact) — the client must label the scrubber as approximate.
  const verified = recordedHash !== null && finalSummaryHash(finalState) === recordedHash

  return {
    gameId,
    source: 'archive' as const,
    totalTicks: frames.length - 1,
    frames,
    meta,
    integrity,
    verified,
    rulesetVersion: recordedRuleset,
    currentRulesetVersion: REPLAY_RULESET_VERSION,
  }
})
