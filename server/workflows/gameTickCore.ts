import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq, and } from 'drizzle-orm'
import { Effect } from 'effect'
import * as schema from '~~/server/db/schema'
import {
  liveGames,
  pendingActions,
  type LiveGame,
  type LiveGameRoster,
  type NewMatch,
  type NewMatchPlayer,
} from '~~/server/db/schema'
import {
  DatabaseService,
  DatabaseServiceLive,
  type DatabaseServiceApi,
  type MatchDerivedPlayerStats,
} from '~~/server/services/DatabaseService'
import { processCycle, submitAction } from '~~/server/game/engine/GameLoop'
import { filterStateForPlayer } from '~~/server/game/engine/VisionCalculator'
import { serializeStateForTransport } from '~~/server/game/engine/replayArtifact'
import { registerAllHeroes } from '~~/server/game/heroes'
import { registerBots, isBot } from '~~/server/game/ai/BotManager'
import { playerNetWorth } from '~~/server/game/engine/ScripDistributor'
import { calculateMmrChange, teamAverageMmr } from '~~/server/game/matchmaking/elo'
import { shouldApplyDerivedMatchStats } from '~~/server/game/engine/matchPersistence'
import { isGuestId } from '~~/server/utils/guest'
import { ablyPublishBatch, type AblyBatchSpec } from '~~/server/utils/ablyRest'
import { engineLog } from '~~/server/utils/log'
import type { GameState } from '~~/shared/types/game'
import type { Command } from '~~/shared/types/commands'

/**
 * THE PRODUCTION game-tick workflow (spike/workflow-tick migration).
 *
 * Builds on two proven spikes (server/workflows/tickSpike.ts,
 * server/workflows/tickGameSpike.ts): the absolute-deadline sleep pattern
 * (variant 3 — coarse queue wake + fine in-process alignment, ±2ms measured)
 * and the full per-tick pipeline (Neon row → processCycle → Ably publish,
 * 44-117ms measured). What the spikes explicitly skipped and this module
 * adds:
 *
 *  1. The CAS idempotency guard — every tick's Neon UPDATE is conditioned on
 *     `cycle = loadedCycle`. At-least-once execution (both steps AND whole
 *     runs) means a duplicate can run the same tick; only the execution that
 *     still sees the row at `loadedCycle` may commit it. The loser skips
 *     publishing entirely and reports back whatever the winner left behind —
 *     no double-tick, no double-broadcast.
 *  2. A durable action ingress: POST /api/game/action (server/api/game/
 *     action.post.ts) writes to `pending_actions` since there is no
 *     long-lived WS connection backing a workflow tick. Each tick step
 *     drains this game's rows (one DELETE ... RETURNING) before running
 *     processCycle, mirroring ws.ts's forCycle 'late' semantics.
 *  3. Child-workflow chaining every CHAIN_EVERY_TICKS ticks, to stay well
 *     under Workflow DevKit's ~2,000-event replay-degradation line. Nothing
 *     about *this* run's loop index drives it — chaining is keyed off the
 *     DURABLE cycle number read back from Neon, so a continuation started
 *     fresh (see start-workflow.post.ts) just resumes wherever the row is.
 *  4. Finalization on game-over: persist match history via the existing
 *     DatabaseService (recordMatch/applyMatchDerivedStats), then delete the
 *     live_games + pending_actions rows.
 *
 * TODOs deliberately left for a follow-up (see inline comments at their
 * exact site for the full reasoning):
 *  - Replay archiving (buildReplayArtifact + db.saveMatchReplay) is NOT
 *    wired — it needs a durable action log, which on DO comes from Redis's
 *    8h copy written by the WS ingress. Nothing analogous exists here yet.
 *  - lastHits/burns are reported as 0 in match history: GameLoop's farm
 *    counters (getFarmStats) are an in-process Map that does not survive a
 *    tick landing on a fresh instance, which the task's own truths say WILL
 *    happen. Needs folding farm counters into GameState (persisted jsonb)
 *    before it can be accurate.
 *  - A failed finalization persist is logged and the live_games row is still
 *    deleted (so the workflow doesn't wedge) — unlike game-server.ts's
 *    Redis-backed "finalize:pending" durable-intent + boot sweep, there is no
 *    retry path here yet. Would need a Neon-backed pending-finalize table
 *    (no Redis on the all-Vercel path) to close.
 *  - A duplicate whole-run landing on the exact same chain boundary (cycle %
 *    CHAIN_EVERY_TICKS === 0) can start two continuations. Harmless — both
 *    continuations tick under the same CAS guard — but a `chained_at`
 *    marker column would close it outright.
 */

// ── Durable stores ───────────────────────────────────────────────────
// Raw postgres + drizzle off DATABASE_URL directly, NOT useDb()/
// useRuntimeConfig() — mirrors the spike's choice: a workflow step may not
// be running inside a live h3 request event, so it reaches for the env var
// Nitro also injects rather than Nitro's request-scoped config helper.
// Module-level lazy singleton: reused across invocations on a warm Fluid
// instance, rebuilt for free on a cold one.

let _client: ReturnType<typeof postgres> | null = null
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null

function db(): ReturnType<typeof drizzle<typeof schema>> {
  if (!_db) {
    _client = postgres(process.env.DATABASE_URL!, { prepare: false, max: 5 })
    _db = drizzle(_client, { schema })
  }
  return _db
}

export interface LiveGamesRepo {
  get(gameId: string): Promise<LiveGame | null>
  /** Compare-and-swap the state+cycle. Returns the updated row on success,
   *  null when `loadedCycle` no longer matched (another execution won the
   *  race and already advanced this game). */
  casUpdate(
    gameId: string,
    loadedCycle: number,
    nextState: Record<string, unknown>,
    nextCycle: number,
  ): Promise<LiveGame | null>
  delete(gameId: string): Promise<void>
}

export interface DrainedAction {
  id: number
  playerId: string
  command: Command
  forCycle: number | null
}

export interface PendingActionsRepo {
  /** SELECT-and-DELETE this game's queued actions in one round trip
   *  (DELETE ... RETURNING is atomic — no duplicate execution can observe a
   *  partial drain). */
  drain(gameId: string): Promise<DrainedAction[]>
  deleteAll(gameId: string): Promise<void>
}

export function liveGamesRepo(d: ReturnType<typeof db> = db()): LiveGamesRepo {
  return {
    async get(gameId) {
      const rows = await d.select().from(liveGames).where(eq(liveGames.gameId, gameId)).limit(1)
      return rows[0] ?? null
    },
    async casUpdate(gameId, loadedCycle, nextState, nextCycle) {
      const rows = await d
        .update(liveGames)
        .set({ state: nextState, cycle: nextCycle, updatedAt: new Date() })
        .where(and(eq(liveGames.gameId, gameId), eq(liveGames.cycle, loadedCycle)))
        .returning()
      return rows[0] ?? null
    },
    async delete(gameId) {
      await d.delete(liveGames).where(eq(liveGames.gameId, gameId))
    },
  }
}

export function pendingActionsRepo(d: ReturnType<typeof db> = db()): PendingActionsRepo {
  return {
    async drain(gameId) {
      const rows = await d
        .delete(pendingActions)
        .where(eq(pendingActions.gameId, gameId))
        .returning()
      return rows.map((r) => ({
        id: r.id,
        playerId: r.playerId,
        command: r.command,
        forCycle: r.forCycle,
      }))
    },
    async deleteAll(gameId) {
      await d.delete(pendingActions).where(eq(pendingActions.gameId, gameId))
    },
  }
}

// ── Hydrate / serialize ──────────────────────────────────────────────
// Sets aren't JSON-serializable (serializeStateForTransport converts them to
// arrays on the way OUT); this is the mirror on the way IN.

export function hydrate(raw: Record<string, unknown>): GameState {
  const votes = raw.surrenderVotes as { chaff?: string[]; audit?: string[] } | undefined
  return {
    ...(raw as unknown as GameState),
    surrenderVotes: { chaff: new Set(votes?.chaff ?? []), audit: new Set(votes?.audit ?? []) },
  }
}

/** Rehydrate the per-process registries a fresh instance lacks — every step
 *  invocation may land on a brand new one. */
export function rehydrateRegistries(gameId: string, roster: LiveGameRoster): void {
  registerAllHeroes()
  registerBots(gameId, roster.players, roster.botOptions ?? 'medium')
}

// ── Action drain ──────────────────────────────────────────────────────

/**
 * Apply this tick's drained pending_actions into the in-process queue
 * processCycle drains, mirroring ws.ts's forCycle semantics: an order
 * stamped for a cycle that has already committed by the time it's drained
 * is 'late' and dropped (logged, never silently rolled into this batch —
 * the batch clock's whole promise is that an order lands in the batch the
 * player aimed it at or is told it didn't). Unstamped orders (forCycle
 * null — bots, dev tools) always queue for the open cycle.
 */
export function applyDrainedActions(
  gameId: string,
  loadedCycle: number,
  actions: DrainedAction[],
  submit: (gameId: string, playerId: string, command: Command) => unknown = submitAction,
): { submitted: number; droppedLate: DrainedAction[] } {
  let submitted = 0
  const droppedLate: DrainedAction[] = []
  for (const action of actions) {
    if (action.forCycle != null && action.forCycle < loadedCycle) {
      droppedLate.push(action)
      continue
    }
    submit(gameId, action.playerId, action.command)
    submitted++
  }
  return { submitted, droppedLate }
}

// ── One tick, fully dependency-injected for testability ──────────────

export interface TickDeps {
  liveGamesRepo: LiveGamesRepo
  pendingActionsRepo: PendingActionsRepo
  runCycle: (gameId: string, state: GameState) => Promise<{ state: GameState }>
  publish: (specs: AblyBatchSpec[]) => Promise<void>
  rehydrate: (gameId: string, roster: LiveGameRoster) => void
}

export interface TickResult {
  ended: boolean
  /** The cycle now current for this game — the row's, whether or not THIS
   *  execution was the one that advanced it. -1 when the row is gone. */
  cycle: number
  /** True when this execution did NOT advance the row (lost the CAS race,
   *  or the game had already ended, or the row no longer exists) — no
   *  publish happened. */
  skipped: boolean
  /** True specifically when the row no longer exists — a duplicate run
   *  arriving after another run's finalize+delete already ran. */
  missing?: boolean
}

export function productionTickDeps(): TickDeps {
  return {
    liveGamesRepo: liveGamesRepo(),
    pendingActionsRepo: pendingActionsRepo(),
    runCycle: (gameId, state) => Effect.runPromise(processCycle(gameId, state)),
    publish: ablyPublishBatch,
    rehydrate: rehydrateRegistries,
  }
}

/**
 * Run exactly one game tick. THE IDEMPOTENCY GUARD lives here: the CAS
 * update is conditioned on the cycle this execution loaded, so a duplicate
 * execution that loses the race gets told "skip publishing, here's the
 * current cycle" instead of re-running processCycle's outcome onto the wire
 * a second time.
 */
export async function runOneTick(gameId: string, deps: TickDeps): Promise<TickResult> {
  const row = await deps.liveGamesRepo.get(gameId)
  if (!row) {
    engineLog.debug('[gameTick] tick skipped — live_games row is gone', { gameId })
    return { ended: true, cycle: -1, skipped: true, missing: true }
  }

  const loadedCycle = row.cycle
  const state = hydrate(row.state)
  if (state.phase === 'ended') {
    // Another execution already wrote the ended state (and may already be
    // running finalize). Nothing to do — no re-tick, no re-publish.
    return { ended: true, cycle: loadedCycle, skipped: true }
  }

  const drained = await deps.pendingActionsRepo.drain(gameId)
  const { droppedLate } = applyDrainedActions(gameId, loadedCycle, drained)
  if (droppedLate.length > 0) {
    engineLog.warn('[gameTick] dropped late pending actions (forCycle already committed)', {
      gameId,
      loadedCycle,
      dropped: droppedLate.map((a) => ({ playerId: a.playerId, forCycle: a.forCycle })),
    })
  }

  deps.rehydrate(gameId, row.roster)
  const { state: next } = await deps.runCycle(gameId, state)

  const updated = await deps.liveGamesRepo.casUpdate(
    gameId,
    loadedCycle,
    serializeStateForTransport(next),
    next.cycle,
  )
  if (!updated) {
    // Lost the race: a duplicate execution already advanced this game past
    // `loadedCycle`. SKIP publishing — the winner already did — and report
    // its cycle rather than this execution's (unwritten) `next`.
    const current = await deps.liveGamesRepo.get(gameId)
    if (!current) return { ended: true, cycle: -1, skipped: true, missing: true }
    return { ended: hydrate(current.state).phase === 'ended', cycle: current.cycle, skipped: true }
  }

  const specs: AblyBatchSpec[] = row.roster.players
    .filter((p) => !isBot(p.playerId))
    .map((p) => ({
      channel: `game:${gameId}:p:${p.playerId}`,
      data: { cycle: next.cycle, state: filterStateForPlayer(next, p.playerId, gameId) },
    }))
  await deps.publish(specs)

  return { ended: next.phase === 'ended', cycle: next.cycle, skipped: false }
}

// ── Child-workflow chaining ───────────────────────────────────────────
// CHAIN_EVERY_TICKS + shouldChainAt live in gameTick.ts (the thin workflow
// module): the WORKFLOW BODY calls them, and the workflow body may only
// reference a static scope free of Node-module imports — which this file,
// by design, is not.

// ── Finalization ──────────────────────────────────────────────────────

function isPracticeGame(gameId: string, mode: string): boolean {
  return mode === 'tutorial' || gameId.startsWith('dev_')
}

/** Mirrors game-server.ts's isRankedMatch (kept local, not imported — that
 *  module is the DO-era WS plugin and pulls in Redis/WebSocket service
 *  wiring this workflow has no business depending on). MMR only moves for a
 *  full human-only 5v5; anything bot-filled or smaller is casual/unranked. */
function isRankedMatch(playerCount: number, hasBots: boolean): boolean {
  return playerCount === 10 && !hasBots
}

async function persistMatch(
  gameId: string,
  state: GameState,
  roster: LiveGameRoster,
): Promise<void> {
  const run = <A>(f: (d: DatabaseServiceApi) => Effect.Effect<A>): Promise<A> =>
    Effect.runPromise(Effect.flatMap(DatabaseService, f).pipe(Effect.provide(DatabaseServiceLive)))

  // Bots have no `players` row; guests (isGuestId) never do either — both
  // would violate match_players' FK on players.id. In practice neither ever
  // reaches here because guests only ever play practice/tutorial games
  // (gated out by isPracticeGame above), but this stays defensive rather
  // than relying on that invariant holding forever.
  const realPlayers = roster.players.filter((p) => !isBot(p.playerId) && !isGuestId(p.playerId))
  const hasBots = roster.players.some((p) => isBot(p.playerId))
  const ranked = isRankedMatch(roster.players.length, hasBots)
  const winner = state.winner ?? null

  const teamSize = roster.players.filter((p) => p.team === 'chaff').length
  const matchMode: NewMatch['mode'] = hasBots
    ? 'casual_5v5'
    : teamSize <= 1
      ? '1v1'
      : teamSize <= 3
        ? 'quick_3v3'
        : 'ranked_5v5'

  const season = await run((d) => d.getCurrentSeason())

  const mmrChanges = new Map<string, number>()
  if (ranked && winner) {
    for (const p of realPlayers) {
      const enemyAvg = teamAverageMmr(
        roster.players.filter((e) => e.team !== p.team).map((e) => e.mmr),
      )
      mmrChanges.set(p.playerId, calculateMmrChange(p.mmr, enemyAvg, p.team === winner))
    }
  }

  const matchRecord: NewMatch = {
    id: gameId,
    mode: matchMode,
    winner,
    durationCycles: state.cycle,
    seasonNumber: season.seasonNumber,
    endedAt: new Date(),
  }

  const matchPlayerRecords: NewMatchPlayer[] = realPlayers.map((p) => {
    const ps = state.players[p.playerId]
    return {
      matchId: gameId,
      playerId: p.playerId,
      team: p.team,
      heroId: p.heroId,
      kills: ps?.kills ?? 0,
      deaths: ps?.deaths ?? 0,
      assists: ps?.assists ?? 0,
      finalScrip: ps?.scrip ?? 0,
      netWorth: ps ? playerNetWorth(ps) : 0,
      damageDealt: ps?.damageDealt ?? 0,
      iceDamageDealt: ps?.iceDamageDealt ?? 0,
      // TODO: GameLoop.getFarmStats is an in-process Map accumulated
      // tick-by-tick — it does NOT survive a tick landing on a fresh
      // instance, which is exactly the serverless truth this migration
      // designs for. Reporting 0 rather than a number that quietly
      // undercounts; needs farm counters folded into GameState (persisted
      // jsonb) to fix properly.
      lastHits: 0,
      burns: 0,
      finalItems: (ps?.items ?? []).filter((i): i is string => i !== null),
      finalLevel: ps?.level ?? 1,
      mmrChange: mmrChanges.get(p.playerId) ?? 0,
    }
  })

  const derivedPlayers: MatchDerivedPlayerStats[] = realPlayers.map((p) => {
    const ps = state.players[p.playerId]
    return {
      playerId: p.playerId,
      heroId: p.heroId,
      won: winner != null && p.team === winner,
      ranked,
      mmrChange: mmrChanges.get(p.playerId) ?? 0,
      kills: ps?.kills ?? 0,
      deaths: ps?.deaths ?? 0,
      assists: ps?.assists ?? 0,
    }
  })

  const persisted = await run((d) => d.recordMatch(matchRecord, matchPlayerRecords))
  if (!shouldApplyDerivedMatchStats(persisted)) {
    engineLog.error('[gameTick] match was not persisted; skipping derived stats', {
      gameId,
      persisted,
    })
    return
  }
  await run((d) => d.applyMatchDerivedStats(gameId, derivedPlayers))
}

/**
 * Finalize a finished game: persist match history (unless it's a practice/
 * tutorial game, which is never recorded — see isPracticeGame), then delete
 * the live_games + pending_actions rows so the workflow can't tick it again.
 * Idempotent by construction: a missing row means a duplicate execution
 * already ran this — recordMatch/applyMatchDerivedStats are themselves
 * idempotent (see server/game/engine/matchPersistence.ts), and DELETE on an
 * already-deleted row is a no-op.
 */
export async function finalizeGame(gameId: string): Promise<void> {
  const repo = liveGamesRepo()
  const row = await repo.get(gameId)
  if (!row) return // already finalized by a duplicate execution

  const state = hydrate(row.state)
  if (state.phase !== 'ended') {
    engineLog.warn('[gameTick] finalizeGame called on a non-ended game — skipping', {
      gameId,
      phase: state.phase,
    })
    return
  }

  if (!isPracticeGame(gameId, row.mode)) {
    try {
      await persistMatch(gameId, state, row.roster)
    } catch (err) {
      // Persistence failure must never block cleanup — a stuck live_games
      // row means this game can never tick (or be replaced) again. See the
      // module-level TODO: no durable "pending finalize" retry path exists
      // yet on the all-Vercel side, unlike game-server.ts's Redis-backed one.
      engineLog.error('[gameTick] match finalize persistence failed — record may be lost', {
        gameId,
        error: String(err),
      })
    }
  }

  // TODO: replay archiving (buildReplayArtifact + db.saveMatchReplay) is
  // deliberately not wired here — see the module-level doc comment.

  await pendingActionsRepo().deleteAll(gameId)
  await repo.delete(gameId)
}
