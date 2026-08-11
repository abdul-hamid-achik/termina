import { sleep } from 'workflow'
import postgres from 'postgres'
import { Effect } from 'effect'
import { createInMemoryStateManager } from '~~/server/game/engine/StateManager'
import { processCycle } from '~~/server/game/engine/GameLoop'
import { filterStateForPlayer } from '~~/server/game/engine/VisionCalculator'
import { serializeStateForTransport } from '~~/server/game/engine/replayArtifact'
import { registerAllHeroes } from '~~/server/game/heroes'
import { registerBots } from '~~/server/game/ai/BotManager'
import type { GameState, TeamId } from '~~/shared/types/game'

/**
 * SPIKE 3 (spike/workflow-tick): the REAL per-tick pipeline on Vercel —
 * load ~full GameState from Neon → run the actual processCycle (bots and
 * all) → save back → publish per-player fog-filtered payloads to Ably —
 * inside the variant-3 tick driver (coarse queue wake + fine in-process
 * alignment). A 2v2 all-bot match on the one-lane map plays itself to a win.
 *
 * Go/no-go (migration memo): total server-side work per tick < 500ms p95.
 *
 * Serverless truths this spike embraces:
 *  - Every step invocation may land on a FRESH instance: hero registry and
 *    bot registry are rehydrated from the state row every tick.
 *  - At-least-once execution: the state row is the single source of truth;
 *    a duplicate tick re-runs against whatever cycle the row holds. (The
 *    real migration adds a cycle-CAS guard; the spike measures, not guards.)
 */

// Module-level lazy singletons — reused across invocations on a warm Fluid
// instance, rebuilt for free on a cold one.
let _sql: ReturnType<typeof postgres> | null = null
function db(): ReturnType<typeof postgres> {
  if (!_sql) {
    _sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 })
  }
  return _sql
}

const ROSTER = [
  { playerId: 'bot_s3_a1', team: 'chaff' as TeamId, heroId: 'echo' },
  { playerId: 'bot_s3_a2', team: 'chaff' as TeamId, heroId: 'kernel' },
  { playerId: 'bot_s3_b1', team: 'audit' as TeamId, heroId: 'daemon' },
  { playerId: 'bot_s3_b2', team: 'audit' as TeamId, heroId: 'regex' },
]

function hydrate(raw: Record<string, unknown>): GameState {
  const votes = raw.surrenderVotes as { chaff: string[]; audit: string[] }
  return {
    ...(raw as unknown as GameState),
    surrenderVotes: { chaff: new Set(votes?.chaff ?? []), audit: new Set(votes?.audit ?? []) },
  }
}

/** Rehydrate the per-process registries a fresh instance lacks. */
function rehydrateRegistries(gameId: string): void {
  registerAllHeroes()
  registerBots(gameId, ROSTER, { forceLane: 'coldstore', difficulty: 'medium' })
}

async function ablyPublish(channel: string, data: unknown): Promise<void> {
  const key = process.env.ABLY_API_KEY
  if (!key) return
  const res = await fetch(`https://rest.ably.io/channels/${encodeURIComponent(channel)}/messages`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(key).toString('base64')}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ name: 'cycle_state', data }),
  })
  if (!res.ok) throw new Error(`ably publish ${res.status}`)
}

async function initGameStep(gameId: string): Promise<number> {
  'use step'
  await db()`CREATE TABLE IF NOT EXISTS spike_games (
    id text PRIMARY KEY, state jsonb NOT NULL, updated_at timestamptz DEFAULT now()
  )`
  rehydrateRegistries(gameId)
  const sm = createInMemoryStateManager()
  await Effect.runPromise(
    sm.createGame(
      gameId,
      ROSTER.map((p) => ({ id: p.playerId, name: p.playerId, team: p.team, heroId: p.heroId })),
      { mapId: 'one_lane', mode: 'normal' },
    ),
  )
  await Effect.runPromise(sm.updateState(gameId, (s) => ({ ...s, phase: 'playing' as const })))
  const state = await Effect.runPromise(sm.getState(gameId))
  await db()`INSERT INTO spike_games (id, state)
    VALUES (${gameId}, ${db().json(serializeStateForTransport(state) as never)})
    ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`
  console.log(`[gameSpike:${gameId}] initialised (seed ${state.rngSeed})`)
  return Date.now()
}

interface TickMetrics {
  i: number
  cycle: number
  ended: boolean
  alignMs: number
  loadMs: number
  cycleMs: number
  saveMs: number
  publishMs: number
  totalMs: number
}

async function gameTickStep(gameId: string, i: number, target: number): Promise<TickMetrics> {
  'use step'
  const wait = target - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  const t0 = Date.now()

  const rows = await db()`SELECT state FROM spike_games WHERE id = ${gameId}`
  const state = hydrate(rows[0]!.state as Record<string, unknown>)
  const t1 = Date.now()

  rehydrateRegistries(gameId)
  const result = await Effect.runPromise(processCycle(gameId, state))
  const next = result.state
  const t2 = Date.now()

  await db()`UPDATE spike_games
    SET state = ${db().json(serializeStateForTransport(next) as never)}, updated_at = now()
    WHERE id = ${gameId}`
  const t3 = Date.now()

  // Per-player fog-filtered payloads to per-player Ably channels — the real
  // broadcast shape (4 players here; 10 in a live 5v5).
  await Promise.all(
    ROSTER.map((p) => {
      const filtered = filterStateForPlayer(next, p.playerId, gameId)
      return ablyPublish(`spike:${gameId}:p:${p.playerId}`, {
        cycle: next.cycle,
        state: filtered,
      })
    }),
  )
  const t4 = Date.now()

  const m: TickMetrics = {
    i,
    cycle: next.cycle,
    ended: next.phase === 'ended',
    alignMs: t0 - target,
    loadMs: t1 - t0,
    cycleMs: t2 - t1,
    saveMs: t3 - t2,
    publishMs: t4 - t3,
    totalMs: t4 - t0,
  }
  console.log(`[gameSpike:${gameId}] ${JSON.stringify(m)}`)
  return m
}

async function logGameSummary(gameId: string, summary: Record<string, unknown>): Promise<void> {
  'use step'
  console.log(`[gameSpike:${gameId}] SUMMARY ${JSON.stringify(summary)}`)
}

export async function tickGameSpike(gameId: string, maxTicks: number) {
  'use workflow'
  const t0 = await initGameStep(gameId)
  const metrics: TickMetrics[] = []
  for (let i = 0; i < maxTicks; i++) {
    const target = t0 + (i + 1) * 4000
    await sleep(new Date(target - 2500))
    const m = await gameTickStep(gameId, i, target)
    metrics.push(m)
    if (m.ended) break
  }

  const pct = (xs: number[], q: number) => {
    const s = [...xs].sort((a, b) => a - b)
    return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0
  }
  const totals = metrics.map((m) => m.totalMs)
  const summary = {
    gameId,
    ticks: metrics.length,
    finalCycle: metrics[metrics.length - 1]?.cycle ?? 0,
    ended: metrics[metrics.length - 1]?.ended ?? false,
    p50: {
      load: pct(
        metrics.map((m) => m.loadMs),
        0.5,
      ),
      cycle: pct(
        metrics.map((m) => m.cycleMs),
        0.5,
      ),
      save: pct(
        metrics.map((m) => m.saveMs),
        0.5,
      ),
      publish: pct(
        metrics.map((m) => m.publishMs),
        0.5,
      ),
      total: pct(totals, 0.5),
    },
    p95: {
      load: pct(
        metrics.map((m) => m.loadMs),
        0.95,
      ),
      cycle: pct(
        metrics.map((m) => m.cycleMs),
        0.95,
      ),
      save: pct(
        metrics.map((m) => m.saveMs),
        0.95,
      ),
      publish: pct(
        metrics.map((m) => m.publishMs),
        0.95,
      ),
      total: pct(totals, 0.95),
    },
    maxTotal: Math.max(...totals, 0),
    alignP95: pct(
      metrics.map((m) => Math.abs(m.alignMs)),
      0.95,
    ),
    totalWithinBudget: pct(totals, 0.95) < 500,
  }
  await logGameSummary(gameId, summary)
  return summary
}
