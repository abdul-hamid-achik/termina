import { sleep } from 'workflow'
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
async function gameTickStep(gameId: string, target: number): Promise<TickStepResult> {
  'use step'
  const wait = target - Date.now()
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  const alignMs = Date.now() - target
  const core = await import('./gameTickCore')
  const result = await core.runOneTick(gameId, core.productionTickDeps())
  console.log(`[gameTick] ${gameId} ${JSON.stringify({ ...result, alignMs })}`)
  return { ...result, alignMs }
}

async function finalizeGameStep(gameId: string): Promise<void> {
  'use step'
  const core = await import('./gameTickCore')
  await core.finalizeGame(gameId)
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
  let lastCycle: number | null = null

  for (let i = 0; i < CHAIN_EVERY_TICKS; i++) {
    const target = t0 + (i + 1) * 4000
    await sleep(new Date(target - 2500))
    const result = await gameTickStep(gameId, target)

    if (result.missing) {
      // The row is gone — another run's finalize+delete already completed
      // this game. Nothing left for this execution to do.
      return { gameId, ended: true, finalCycle: lastCycle, chained: false }
    }

    lastCycle = result.cycle

    if (result.ended) {
      await finalizeGameStep(gameId)
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
