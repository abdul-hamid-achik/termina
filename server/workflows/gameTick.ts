import { RetryableError, getStepMetadata, getWorkflowMetadata, sleep } from 'workflow'
import { start } from 'workflow/api'
import type { TickResult } from './gameTickCore'

/**
 * THE PRODUCTION game-tick workflow — THIN by construction.
 *
 * Workflow DevKit's bundler forbids Node.js modules anywhere in a workflow
 * module's STATIC import graph (only step bodies may touch them). Every
 * heavy dependency — postgres, the engine, Ably REST, the finalization
 * pipeline — therefore lives in ./gameTickCore.ts and is loaded via DYNAMIC
 * import inside the step bodies below. Keep it that way: adding a static
 * import of anything that transitively touches `postgres`/`ioredis`/
 * `node:*` to THIS file breaks the Vercel build (workflow-node-module-error).
 *
 * The tick pattern is spike-proven variant 3: coarse queue wake at
 * deadline−2500ms, fine in-process alignment to the exact 4s grid inside the
 * step (±2ms measured over 150 ticks). Chaining, CAS idempotency, action
 * drain and finalization semantics are documented at their implementation
 * sites in gameTickCore.ts.
 */

/** Chain a continuation run at multiples of this cycle count, keeping each
 *  run's event log well under Workflow's ~2,000-event replay-degradation
 *  line. Keyed off the DURABLE cycle (see shouldChainAt), never this run's
 *  local loop index. */
export const CHAIN_EVERY_TICKS = 250

/** Pure — lives here (not Core) because the WORKFLOW BODY calls it, and the
 *  workflow body may only reference this module's clean static scope. */
export function shouldChainAt(cycle: number, everyTicks: number = CHAIN_EVERY_TICKS): boolean {
  return cycle > 0 && cycle % everyTicks === 0
}

// ── Workflow steps (each loads the heavy core dynamically) ────────────

async function nowStep(): Promise<number> {
  'use step'
  return Date.now()
}

interface TickStepResult extends TickResult {
  alignMs: number
}

/** Coarse queue wake at `target - 2500ms`, fine in-process alignment to the
 *  exact deadline inside the step — the variant-3 pattern from the spikes. */
async function gameTickStep(
  gameId: string,
  target: number,
  epoch: string,
): Promise<TickStepResult> {
  'use step'
  const wait = target - Date.now()
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  const alignMs = Date.now() - target
  const core = await import('./gameTickCore')
  const result = await core.runOneTick(gameId, core.productionTickDeps(), epoch)
  console.log(`[gameTick] ${gameId} ${JSON.stringify({ ...result, alignMs })}`)
  return { ...result, alignMs }
}

/** Claim the game for THIS run: stamps the workflow run id as the runEpoch in
 *  the live_games state. Any older run for the same game is fenced out: its
 *  next tick sees a foreign epoch and exits. The epoch is passed in (not
 *  generated here) so a retried claim step writes the SAME value. Returns null
 *  when the row no longer exists. */
async function claimRunStep(gameId: string, runId: string): Promise<string | null> {
  'use step'
  const core = await import('./gameTickCore')
  return core.claimRun(gameId, runId)
}

/** Finalization with exponential backoff: a Neon blip of ~15s outlasts the
 *  default few-immediate-retries budget, so retry for ~2.5 minutes before the
 *  workflow gives up and falls back to forceDeleteGameStep. */
async function finalizeGameStep(gameId: string): Promise<void> {
  'use step'
  const core = await import('./gameTickCore')
  try {
    await core.finalizeGame(gameId)
  } catch (err) {
    const { attempt } = getStepMetadata()
    throw new RetryableError(String(err), { retryAfter: Math.min(2 ** attempt * 1000, 30_000) })
  }
}
finalizeGameStep.maxRetries = 8

/** Last resort once finalize has exhausted its retries: drop the rows without
 *  recording, so the players are freed instead of pinned to a dead game. */
async function forceDeleteGameStep(gameId: string): Promise<void> {
  'use step'
  const core = await import('./gameTickCore')
  await core.forceDeleteGame(gameId)
}

/** Background execution via step (see workflow's common-patterns doc): a
 *  step that calls start() launches the continuation run without the parent
 *  blocking on it — the parent returns right after. */
async function chainContinuationStep(gameId: string): Promise<void> {
  'use step'
  await start(runGame, [gameId])
}

export interface RunGameResult {
  gameId: string
  ended: boolean
  finalCycle: number | null
  chained: boolean
  /** True when the run exited because a newer run claimed the game. */
  stale?: boolean
}

/**
 * Drive one game's 4s batch clock. Reads roster/config from live_games (the
 * row created by POST /api/game/start-workflow) rather than any hardcoded
 * roster — a continuation started by chainContinuationStep is just this same
 * function called again, and it picks up wherever the row currently is.
 */
export async function runGame(gameId: string): Promise<RunGameResult> {
  'use workflow'
  const t0 = await nowStep()
  // One run per game: claim ownership before ticking. A duplicate run (retried
  // chain step, double start) would otherwise run its own t0 clock against the
  // same row — the CAS alone never rejects it, since it reloads the current
  // cycle every tick — and the game would advance at double speed.
  // The epoch is this run's workflow run id: stable across replays and step
  // retries (a retried claim writes the same value), distinct per run.
  const epoch = await claimRunStep(gameId, getWorkflowMetadata().workflowRunId)
  if (epoch === null) return { gameId, ended: true, finalCycle: null, chained: false }
  let lastCycle: number | null = null

  for (let i = 0; i < CHAIN_EVERY_TICKS; i++) {
    const target = t0 + (i + 1) * 4000
    await sleep(new Date(target - 2500))
    const result = await gameTickStep(gameId, target, epoch)

    if (result.missing) {
      // The row is gone — another run's finalize+delete already completed
      // this game. Nothing left for this execution to do.
      return { gameId, ended: true, finalCycle: lastCycle, chained: false }
    }

    if (result.stale) {
      // A newer run owns this game now; it keeps the clock. Do not finalize,
      // do not chain — just stop.
      return { gameId, ended: false, finalCycle: lastCycle, chained: false, stale: true }
    }

    lastCycle = result.cycle

    if (result.ended) {
      try {
        await finalizeGameStep(gameId)
      } catch (err) {
        // Finalize failed past its retry budget (long outage or a permanent
        // error). Leaving the row at phase 'ended' would lock its players out
        // of the queue forever — free them, losing only this match's record.
        console.error(
          `[gameTick] ${gameId} finalize failed permanently; deleting without recording: ${String(err)}`,
        )
        await forceDeleteGameStep(gameId)
      }
      return { gameId, ended: true, finalCycle: result.cycle, chained: false }
    }

    if (shouldChainAt(result.cycle)) {
      await chainContinuationStep(gameId)
      return { gameId, ended: false, finalCycle: result.cycle, chained: true }
    }
  }

  // Exhausted this run's tick budget without landing exactly on a chain
  // boundary (possible when some ticks were skipped by the CAS guard while
  // a duplicate execution advanced the row) — chain anyway so no single
  // run's event log grows unbounded.
  await chainContinuationStep(gameId)
  return { gameId, ended: false, finalCycle: lastCycle, chained: true }
}
