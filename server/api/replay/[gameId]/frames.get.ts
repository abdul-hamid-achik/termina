import { Effect } from 'effect'
import { getGameRuntime } from '~~/server/plugins/game-server'
import { readSnapshot, type SnapshotMeta } from '~~/server/game/engine/StateSnapshot'
import { readActionLog, type LoggedAction } from '~~/server/game/engine/ActionLog'
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
 * and camp spawns land exactly as they did live (this used to be a documented
 * V1 divergence; the seed closed it).
 *
 * Two sources: the Redis snapshot + log (8h fast path) or the Postgres
 * archive (match_replays, forever). Either way the response carries
 * `verified`: whether the reconstruction's final summary hash matches the
 * recorded game. A false there means the engine changed since the game was
 * recorded (see rulesetVersion) — the scrubber must say so rather than
 * present a plausible-but-different timeline as history.
 *
 * Integrity (V1 decision): reconstruction always starts at cycle 0. A
 * truncated action log cannot rebuild an honest timeline → 409. A Redis read
 * failure falls through to the archive; missing both → 404.
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

  // Resolve the artifact: Redis first, archive second.
  let meta: SnapshotMeta
  let actions: LoggedAction[]
  let rngSeed: number | null
  let recordedHash: string | null
  let recordedRuleset: number
  let lastRecordedCycle: number
  let integrity: { complete: boolean; truncated: boolean; readFailed: boolean }
  let source: 'live' | 'archive'

  const snap = await Effect.runPromise(readSnapshot(runtime.redisService, gameId))
  const log = snap ? await Effect.runPromise(readActionLog(runtime.redisService, gameId)) : null

  if (snap && log && !log.integrity.readFailed) {
    if (snap.state.phase !== 'ended') {
      throw createError({ statusCode: 403, message: 'Replay available after the game ends' })
    }
    if (!snap.meta) {
      throw createError({ statusCode: 422, message: 'Replay missing setup metadata' })
    }
    if (log.integrity.truncated || !log.integrity.complete) {
      throw createError({
        statusCode: 409,
        message: 'Replay incomplete — action log was truncated; cannot reconstruct from cycle 1',
        data: { integrity: log.integrity },
      })
    }
    source = 'live'
    meta = snap.meta
    actions = log.actions
    rngSeed = snap.state.rngSeed ?? null
    recordedHash = finalSummaryHash(snap.state)
    recordedRuleset = REPLAY_RULESET_VERSION
    lastRecordedCycle = snap.state.cycle
    integrity = log.integrity
  } else {
    const archived = await Effect.runPromise(runtime.dbService.getMatchReplay(gameId))
    if (!archived) {
      // A Redis snapshot existed but its log read failed — that's transient
      // (retry), not proof the replay is gone. Only a clean miss on BOTH
      // sources is a real 404.
      if (snap && log?.integrity.readFailed) {
        throw createError({ statusCode: 503, message: 'Replay action log unavailable' })
      }
      throw createError({ statusCode: 404, message: 'Replay not found' })
    }
    source = 'archive'
    meta = archived.meta as SnapshotMeta
    actions = archived.actions as LoggedAction[]
    rngSeed = archived.rngSeed
    recordedHash = archived.finalSummaryHash
    recordedRuleset = archived.rulesetVersion
    lastRecordedCycle = (archived.finalState as { cycle?: number }).cycle ?? 0
    integrity = { complete: true, truncated: false, readFailed: false }
  }

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
    source,
    totalTicks: frames.length - 1,
    frames,
    meta,
    integrity,
    verified,
    rulesetVersion: recordedRuleset,
    currentRulesetVersion: REPLAY_RULESET_VERSION,
  }
})
