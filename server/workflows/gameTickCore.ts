import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq, and, inArray, sql } from 'drizzle-orm'
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
import {
  buildReplayArtifact,
  serializeStateForTransport,
  type SnapshotMeta,
} from '~~/server/game/engine/replayArtifact'
import { registerAllHeroes } from '~~/server/game/heroes'
import { registerBots, isBot } from '~~/server/game/ai/BotManager'
import { TUTORIAL_STEP_COUNT, tutorialMasteryAchieved } from '~~/server/game/modes/tutorial'
import { playerNetWorth } from '~~/server/game/engine/ScripDistributor'
import { calculateMmrChange, teamAverageMmr } from '~~/server/game/matchmaking/elo'
import { shouldApplyDerivedMatchStats } from '~~/server/game/engine/matchPersistence'
import { isGuestId } from '~~/server/utils/guest'
import { ablyPublishBatch, ablyPresence, type AblyBatchSpec } from '~~/server/utils/ablyRest'
import {
  isAfkCheckCycle,
  presenceCandidates,
  withPresenceSample,
} from '~~/server/services/LeaverSystem'
import { engineLog } from '~~/server/utils/log'
import { gameLoggerLive } from '~~/server/utils/logger'
import type { GameMode, GameState } from '~~/shared/types/game'
import type { Command } from '~~/shared/types/commands'
import type { PlayerEndStats } from '~~/shared/types/protocol'

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
 *     `cycle = loadedCycle` AND on the run epoch (below). At-least-once
 *     execution (both steps AND whole runs) means a duplicate can run the same
 *     tick; only the execution that still sees the row at `loadedCycle` may
 *     commit it. The loser skips publishing entirely and reports back whatever
 *     the winner left behind — no double-tick, no double-broadcast.
 *     RUN EPOCH: the CAS alone cannot stop a duplicate WHOLE RUN — it reloads
 *     the current row each tick, so it just CASes the next cycle on its own
 *     (offset) t0 clock and the game ticks twice per 4s. So each run claims
 *     the game at start (claimRun) by stamping its workflow run id as `runEpoch` into the
 *     `state` jsonb (no schema column), every tick carries it, and the CAS is
 *     conditioned on it: a newer claim fences every older run, which sees
 *     `stale` and exits.
 *  2. A durable action ingress: POST /api/game/action (server/api/game/
 *     action.post.ts) writes to `pending_actions` since there is no
 *     long-lived WS connection backing a workflow tick. Each tick step
 *     reads this game's rows before running processCycle and deletes exactly
 *     the rows it read ONLY AFTER its CAS wins (a CAS loser must not eat the
 *     winner's orders), mirroring ws.ts's forCycle 'late' semantics.
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
 *  - A duplicate whole-run landing on the exact same chain boundary (cycle %
 *    CHAIN_EVERY_TICKS === 0) can start two continuations. NOT harmless on
 *    its own — but the run epoch fences it: each continuation claims the game
 *    on start, the later claim wins, and the earlier run exits as stale on its
 *    next tick.
 *
 * AFK presence: on an AFK-check cycle only, the tick asks Ably REST (one batch
 * GET) which idle humans are still present and stamps the answer into the
 * state before processCycle — see stampPresence below and LeaverSystem.ts.
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
    /** When set, the update additionally requires `state.runEpoch` to still
     *  equal this (the run that loaded the row still owns the game). */
    epoch?: string,
  ): Promise<LiveGame | null>
  /** Stamp `epoch` as the owning run's epoch in the state jsonb. Returns false
   *  when the row does not exist. Does NOT touch `cycle`, so it never races the
   *  tick CAS on the compare column — it fences it via the epoch instead. */
  claimRun(gameId: string, epoch: string): Promise<boolean>
  delete(gameId: string): Promise<void>
}

export interface DrainedAction {
  id: number
  playerId: string
  command: Command
  forCycle: number | null
}

export interface PendingActionsRepo {
  /** Read this game's queued actions (oldest first) WITHOUT deleting them —
   *  a tick execution that then loses the CAS must leave them for the winner.
   *  Rows are removed by `deleteByIds` only once the tick that consumed them
   *  has committed. */
  read(gameId: string): Promise<DrainedAction[]>
  /** Delete exactly these rows (anything inserted since `read` survives). */
  deleteByIds(gameId: string, ids: number[]): Promise<void>
  deleteAll(gameId: string): Promise<void>
}

export function liveGamesRepo(d: ReturnType<typeof db> = db()): LiveGamesRepo {
  return {
    async get(gameId) {
      const rows = await d.select().from(liveGames).where(eq(liveGames.gameId, gameId)).limit(1)
      return rows[0] ?? null
    },
    async casUpdate(gameId, loadedCycle, nextState, nextCycle, epoch) {
      const rows = await d
        .update(liveGames)
        .set({ state: nextState, cycle: nextCycle, updatedAt: new Date() })
        .where(
          and(
            eq(liveGames.gameId, gameId),
            eq(liveGames.cycle, loadedCycle),
            ...(epoch !== undefined ? [sql`${liveGames.state}->>'runEpoch' = ${epoch}`] : []),
          ),
        )
        .returning()
      return rows[0] ?? null
    },
    async claimRun(gameId, epoch) {
      const rows = await d
        .update(liveGames)
        .set({
          state: sql`jsonb_set(${liveGames.state}, '{runEpoch}', to_jsonb(${epoch}::text))`,
        })
        .where(eq(liveGames.gameId, gameId))
        .returning({ gameId: liveGames.gameId })
      return rows.length > 0
    },
    async delete(gameId) {
      await d.delete(liveGames).where(eq(liveGames.gameId, gameId))
    },
  }
}

export function pendingActionsRepo(d: ReturnType<typeof db> = db()): PendingActionsRepo {
  return {
    async read(gameId) {
      const rows = await d
        .select()
        .from(pendingActions)
        .where(eq(pendingActions.gameId, gameId))
        .orderBy(pendingActions.id)
      return rows.map((r) => ({
        id: r.id,
        playerId: r.playerId,
        command: r.command,
        forCycle: r.forCycle,
      }))
    },
    async deleteByIds(gameId, ids) {
      if (ids.length === 0) return
      await d
        .delete(pendingActions)
        .where(and(eq(pendingActions.gameId, gameId), inArray(pendingActions.id, ids)))
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
export function rehydrateRegistries(
  gameId: string,
  roster: LiveGameRoster,
  state?: GameState,
): void {
  registerAllHeroes()
  // Bot membership is derived from the `bot_` id prefix, which a human that an
  // AFK takeover converted (GameLoop.convertToBot + player.aiControlled) does
  // not have — so a rebuilt registry would hand the slot back to nobody (the
  // human is still idle, LeaverSystem skips aiControlled, the client blocks
  // their input). The durable truth is `aiControlled` on the persisted state:
  // re-register those slots as bots every tick.
  const aiControlled = Object.values(state?.players ?? {})
    .filter((p) => p.aiControlled && !isBot(p.id))
    .map((p) => ({ playerId: p.id, team: p.team, heroId: p.heroId, zone: p.zone }))
  registerBots(gameId, roster.players, { ...roster.botOptions, aiControlled })
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
  /** One processCycle. `rejectedActions`/`notices` are the per-player
   *  feedback published as `announcement`s (optional so test doubles that only
   *  care about state can omit them). */
  runCycle: (gameId: string, state: GameState) => Promise<CycleOutcome>
  publish: (specs: AblyBatchSpec[]) => Promise<void>
  rehydrate: (gameId: string, roster: LiveGameRoster, state?: GameState) => void
  /** Persist tutorial completion for these players. Called best-effort right
   *  BEFORE the final cycle_state/game_over is published so the post-game
   *  screen's `/api/player/me` refresh sees it; finalizeGame repeats it
   *  durably (idempotent). Optional: omitted in tests that don't care. */
  markTutorialComplete?: (playerIds: string[]) => Promise<void>
  /** Base delay (ms) between inline retries of the FINAL tick's publish.
   *  Tests set 0. */
  publishRetryDelayMs?: number
  /** Ably presence lookup (channel → present clientIds; null = unknown), used
   *  only on AFK-check cycles. Omitted ⇒ no lookup ⇒ everyone counts as
   *  connected. Production: ablyRest.ablyPresence. */
  presence?: (channels: string[]) => Promise<Map<string, Set<string>> | null>
}

/** The per-player channel a client enters presence on (useGameChannel). */
function playerChannel(gameId: string, playerId: string): string {
  return `game:${gameId}:p:${playerId}`
}

/**
 * Stamp the AFK presence sample into `state` BEFORE processCycle runs, so the
 * engine reads connection as data (deterministic, no network inside the
 * engine). Only when the cycle about to run is an AFK check, and only for
 * humans who could be flagged — so a game whose humans keep issuing orders
 * never calls Ably at all. A player is recorded offline ONLY when Ably answered
 * for their channel and they are not in it; no key, a failed/slow lookup, or a
 * per-channel error all leave the state untouched (⇒ connected). Never throws.
 */
export async function stampPresence(
  gameId: string,
  state: GameState,
  lookup: TickDeps['presence'],
): Promise<GameState> {
  const checkCycle = state.cycle + 1 // processCycle increments before the AFK block
  if (!lookup || !isAfkCheckCycle(checkCycle)) return state
  const candidates = presenceCandidates(state, checkCycle)
  if (candidates.length === 0) return state
  let present: Map<string, Set<string>> | null
  try {
    present = await lookup(candidates.map((id) => playerChannel(gameId, id)))
  } catch (err) {
    engineLog.warn('[gameTick] presence lookup failed — treating everyone as connected', {
      gameId,
      err: String(err),
    })
    return state
  }
  if (!present) return state
  const answered = present
  const offline = candidates.filter((id) => {
    const members = answered.get(playerChannel(gameId, id))
    return members !== undefined && !members.has(id)
  })
  return withPresenceSample(state, checkCycle, offline)
}

/** What runOneTick needs back from one processCycle. */
export interface CycleOutcome {
  state: GameState
  /** Orders that failed validation/resolution — "why didn't my order happen". */
  rejectedActions?: ReadonlyArray<{ playerId: string; reason: string }>
  /** Coaching lines for one player (tutorial guidance). */
  notices?: ReadonlyArray<{ playerId: string; message: string }>
}

/**
 * The per-player feedback a committed tick owes its humans, as `announcement`
 * messages on each player's own channel — never another player's, never a
 * bot's, never an AFK-converted slot (that slot's orders are the bot's; its
 * failures are not the absent human's business). Identical lines to one player
 * in one cycle collapse to one (a main + item order failing for the same
 * reason). Rejections read as warnings; notices as info.
 */
export function feedbackSpecs(
  gameId: string,
  next: GameState,
  humans: ReadonlyArray<{ playerId: string }>,
  outcome: Omit<CycleOutcome, 'state'>,
  droppedLate: ReadonlyArray<DrainedAction> = [],
): AblyBatchSpec[] {
  const specs: AblyBatchSpec[] = []
  for (const { playerId } of humans) {
    if (isBot(playerId) || next.players[playerId]?.aiControlled) continue
    const lines: Array<{ message: string; level: 'warning' | 'info' }> = []
    const seen = new Set<string>()
    const add = (message: string, level: 'warning' | 'info') => {
      if (!message || seen.has(message)) return
      seen.add(message)
      lines.push({ message, level })
    }
    for (const late of droppedLate) {
      if (late.playerId !== playerId) continue
      add(
        `[CYCLE] Your ${late.command.type} order reached the server after cycle ${late.forCycle} committed — it was dropped, retype it`,
        'warning',
      )
    }
    for (const r of outcome.rejectedActions ?? []) {
      if (r.playerId === playerId) add(r.reason, 'warning')
    }
    for (const n of outcome.notices ?? []) {
      if (n.playerId === playerId) add(n.message, 'info')
    }
    for (const line of lines) {
      specs.push({ channel: `game:${gameId}:p:${playerId}`, name: 'announcement', data: line })
    }
  }
  return specs
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
  /** True when another run has claimed this game since this run did (a newer
   *  runEpoch) — this run must exit instead of ticking. */
  stale?: boolean
}

export function productionTickDeps(): TickDeps {
  return {
    liveGamesRepo: liveGamesRepo(),
    pendingActionsRepo: pendingActionsRepo(),
    // gameLoggerLive formats processCycle's Effect.logInfo/logDebug calls
    // (pretty in dev, structured JSON in prod) — the same layer the DO-era
    // game-server.ts's ManagedRuntime used to provide to every game loop
    // fiber. Provided per-tick here since a workflow step has no long-lived
    // runtime to attach it to once.
    runCycle: (gameId, state) =>
      Effect.runPromise(Effect.provide(processCycle(gameId, state), gameLoggerLive)),
    publish: ablyPublishBatch,
    presence: (channels) => ablyPresence(channels),
    rehydrate: rehydrateRegistries,
    markTutorialComplete: (ids) => markTutorialCompleted(ids, productionDbRunner),
  }
}

/**
 * Run exactly one game tick. THE IDEMPOTENCY GUARD lives here: the CAS
 * update is conditioned on the cycle this execution loaded, so a duplicate
 * execution that loses the race gets told "skip publishing, here's the
 * current cycle" instead of re-running processCycle's outcome onto the wire
 * a second time.
 */
export async function runOneTick(
  gameId: string,
  deps: TickDeps,
  /** The run epoch this execution was started with (claimRun). Undefined only
   *  for legacy callers — then no ownership fence is applied. */
  epoch?: string,
): Promise<TickResult> {
  const row = await deps.liveGamesRepo.get(gameId)
  if (!row) {
    engineLog.debug('[gameTick] tick skipped — live_games row is gone', { gameId })
    return { ended: true, cycle: -1, skipped: true, missing: true }
  }

  const loadedCycle = row.cycle
  if (epoch !== undefined && row.state.runEpoch !== epoch) {
    engineLog.warn('[gameTick] stale run — another run has claimed this game; exiting', {
      gameId,
      epoch,
      ownerEpoch: row.state.runEpoch ?? null,
    })
    return { ended: false, cycle: loadedCycle, skipped: true, stale: true }
  }
  const state = hydrate(row.state)
  if (state.phase === 'ended') {
    // Another execution already wrote the ended state (and may already be
    // running finalize). Nothing to do — no re-tick, no re-publish.
    return { ended: true, cycle: loadedCycle, skipped: true }
  }

  // READ, don't drain: the rows are deleted only after the CAS below wins. A
  // CAS loser used to have already deleted the winner's orders from under it.
  // (Re-submitting after an error retry is safe — the in-process queue holds
  // one command per slot, so a repeat just replaces itself.)
  // Rows an earlier tick already consumed (recorded in the CAS-written state)
  // are skipped even if their cleanup DELETE failed — otherwise an un-stamped
  // order would execute twice and a stamped one would be misreported "late".
  // A set (not a high-water id): serial ids can COMMIT out of order, so "id >
  // highest consumed" could skip a slower, lower-id insert forever.
  const priorConsumed = new Set(consumedActionIds(row.state))
  const everything = await deps.pendingActionsRepo.read(gameId)
  const leftover = everything.filter((a) => priorConsumed.has(a.id)).map((a) => a.id)
  const queued = everything.filter((a) => !priorConsumed.has(a.id))
  const consumedNow = [...leftover, ...queued.map((a) => a.id)]
  const { droppedLate } = applyDrainedActions(gameId, loadedCycle, queued)
  if (droppedLate.length > 0) {
    engineLog.warn('[gameTick] dropped late pending actions (forCycle already committed)', {
      gameId,
      loadedCycle,
      dropped: droppedLate.map((a) => ({ playerId: a.playerId, forCycle: a.forCycle })),
    })
  }

  deps.rehydrate(gameId, row.roster, state)
  const input = await stampPresence(gameId, state, deps.presence)
  const outcome = await deps.runCycle(gameId, input)
  const next = outcome.state

  const runEpoch = epoch ?? (row.state.runEpoch as string | undefined)
  const nextRow = {
    ...serializeStateForTransport(next),
    consumedActionIds: consumedNow,
    ...(runEpoch !== undefined ? { runEpoch } : {}),
  }
  const updated = await deps.liveGamesRepo.casUpdate(
    gameId,
    loadedCycle,
    nextRow,
    next.cycle,
    epoch,
  )
  if (!updated) {
    // Lost the race: a duplicate execution already advanced this game past
    // `loadedCycle` (or a newer run claimed it). SKIP publishing — the winner
    // already did — and report its cycle rather than this execution's
    // (unwritten) `next`. The queued orders are left in place for the winner.
    const current = await deps.liveGamesRepo.get(gameId)
    if (!current) return { ended: true, cycle: -1, skipped: true, missing: true }
    if (epoch !== undefined && current.state.runEpoch !== epoch) {
      return { ended: false, cycle: current.cycle, skipped: true, stale: true }
    }
    return { ended: hydrate(current.state).phase === 'ended', cycle: current.cycle, skipped: true }
  }

  // This execution committed the cycle, so the orders it read are spent (and
  // the late ones were logged above). Delete exactly those rows; orders that
  // arrived mid-tick stay for the next one. This is only CLEANUP now — the
  // consumed ids are already durable in the state the CAS just wrote, so a
  // failure here cannot replay them. Best-effort: throwing would make the step
  // retry, lose the CAS, and never publish this cycle.
  try {
    await deps.pendingActionsRepo.deleteByIds(gameId, consumedNow)
  } catch (err) {
    engineLog.error('[gameTick] failed to delete consumed pending actions', {
      gameId,
      loadedCycle,
      err: String(err),
    })
  }

  // Tutorial graduation: persist completion BEFORE the game_over/final state
  // goes out, so the post-game screen's /api/player/me refresh can't beat it.
  // Best-effort here (see TickDeps.markTutorialComplete); finalizeGame is the
  // durable, retried path.
  const graduates = tutorialGraduates(next, row.mode, row.roster)
  if (graduates.length > 0 && deps.markTutorialComplete) {
    try {
      await deps.markTutorialComplete(graduates)
    } catch (err) {
      engineLog.error('[gameTick] pre-publish tutorial completion failed; finalize will retry', {
        gameId,
        err: String(err),
      })
    }
  }

  const humans = row.roster.players.filter((p) => !isBot(p.playerId))
  const specs: AblyBatchSpec[] = humans.map((p) => ({
    channel: playerChannel(gameId, p.playerId),
    data: { cycle: next.cycle, state: filterStateForPlayer(next, p.playerId, gameId) },
  }))
  // Why an order failed / what the tutorial wants next — only ever built past
  // the CAS above, so a losing duplicate publishes none of it (the winner did).
  specs.push(...feedbackSpecs(gameId, next, humans, outcome, droppedLate))

  // The game just ended on this tick: ride an explicit game_over message in
  // the SAME batch as the final cycle_state. The client's post-game screen is
  // driven by this message (winner + end-of-match scoreboard); the final
  // cycle_state also carries phase+winner as a fallback, but only game_over
  // has the full stats. mmrChange is intentionally absent — MMR is computed
  // at finalize time and no ranked (10-human) games exist on this path yet.
  if (next.phase === 'ended' && next.winner) {
    const hasBots = row.roster.players.some((p) => isBot(p.playerId))
    const stats: Record<string, PlayerEndStats> = {}
    for (const [id, ps] of Object.entries(next.players)) {
      stats[id] = {
        kills: ps.kills,
        deaths: ps.deaths,
        assists: ps.assists,
        scrip: ps.scrip,
        items: ps.items,
        heroDamage: ps.damageDealt,
        iceDamage: ps.iceDamageDealt,
        netWorth: playerNetWorth(ps),
        level: ps.level,
        lastHits: ps.lastHits ?? 0,
        burns: ps.burns ?? 0,
      }
    }
    for (const p of humans) {
      specs.push({
        channel: `game:${gameId}:p:${p.playerId}`,
        name: 'game_over',
        data: {
          winner: next.winner,
          stats,
          ranked: isRankedMatch(row.roster.players.length, hasBots),
          durationCycles: next.cycle,
        },
      })
    }
  }
  await publishCommitted(deps, gameId, next.cycle, specs, next.phase === 'ended')

  return { ended: next.phase === 'ended', cycle: next.cycle, skipped: false }
}

/** Attempts (and base backoff) for publishing the FINAL tick's batch. */
const ENDED_PUBLISH_ATTEMPTS = 3
const ENDED_PUBLISH_BASE_DELAY_MS = 250

/**
 * Publish a cycle the CAS already committed. A failure here must NOT throw out
 * of the step: the Workflow retry would reload the row, find cycle N+1, and run
 * an extra off-grid cycle (or, on the final tick, see `ended` and skip, so
 * game_over never reaches clients). Mid-game a lost publish is harmless — the
 * next tick sends the full vision-filtered state again. The ENDED tick has no
 * next tick, so it is retried inline a few times before giving up (loudly).
 */
async function publishCommitted(
  deps: TickDeps,
  gameId: string,
  cycle: number,
  specs: AblyBatchSpec[],
  isFinal: boolean,
): Promise<void> {
  const attempts = isFinal ? ENDED_PUBLISH_ATTEMPTS : 1
  const baseDelay = deps.publishRetryDelayMs ?? ENDED_PUBLISH_BASE_DELAY_MS
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await deps.publish(specs)
      return
    } catch (err) {
      const last = attempt === attempts
      engineLog[last ? 'error' : 'warn'](
        last
          ? '[gameTick] publish failed after the cycle committed — clients miss this cycle'
          : '[gameTick] publish failed after the cycle committed — retrying',
        { gameId, cycle, attempt, isFinal, err: String(err) },
      )
      if (!last) await new Promise((resolve) => setTimeout(resolve, baseDelay * attempt))
    }
  }
}

/** The pending_actions ids earlier ticks consumed, as recorded in the state. */
function consumedActionIds(state: Record<string, unknown>): number[] {
  const raw = state.consumedActionIds
  return Array.isArray(raw) ? raw.filter((n): n is number => typeof n === 'number') : []
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

/** Runs one DatabaseService call. Injectable so finalize/persist are testable
 *  without a database. */
export type DbRunner = <A>(f: (d: DatabaseServiceApi) => Effect.Effect<A>) => Promise<A>

const productionDbRunner: DbRunner = (f) =>
  Effect.runPromise(Effect.flatMap(DatabaseService, f).pipe(Effect.provide(DatabaseServiceLive)))

/** Who graduates the tutorial when `state` is the final state of a game: only
 *  a `tutorial`-mode game that reached the end of the drill flow with EVERY
 *  drill genuinely performed (no timed-out skips), won by the human's team —
 *  never bots, never guests (no `players` row to update). Practice games must
 *  still bank no match/wins/hero_stats; this only flips `tutorial_completed`. */
export function tutorialGraduates(
  state: GameState,
  mode: string,
  roster: LiveGameRoster,
): string[] {
  if (mode !== 'tutorial' || state.phase !== 'ended' || !state.winner) return []
  if ((state.tutorialStep ?? 0) < TUTORIAL_STEP_COUNT || !tutorialMasteryAchieved(state)) return []
  return roster.players
    .filter((p) => !isBot(p.playerId) && !isGuestId(p.playerId) && p.team === state.winner)
    .map((p) => p.playerId)
}

async function markTutorialCompleted(playerIds: string[], run: DbRunner): Promise<void> {
  for (const id of playerIds) await run((d) => d.markTutorialCompleted(id))
}

export async function persistMatch(
  gameId: string,
  state: GameState,
  roster: LiveGameRoster,
  run: DbRunner = productionDbRunner,
): Promise<void> {
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
      lastHits: ps?.lastHits ?? 0,
      burns: ps?.burns ?? 0,
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
    // THROW (see finalizeGame's contract): the Workflow step retries, and the
    // live_games row survives until the match is durable. Returning here used
    // to let finalize delete the row — losing the match forever.
    engineLog.error('[gameTick] match was not persisted; failing finalize for retry', {
      gameId,
      persisted,
    })
    throw new Error(`[gameTick] match persistence failed for ${gameId} (${persisted})`)
  }
  await run((d) => d.applyMatchDerivedStats(gameId, derivedPlayers))
}

/** Roster + map + mode → the SnapshotMeta reconstructReplay needs. */
export function snapshotMetaFromRoster(
  roster: LiveGameRoster,
  mapId: string | null | undefined,
  mode: string,
  presenceOffline?: GameState['presenceOffline'],
): SnapshotMeta {
  return {
    players: roster.players.map((p) => ({
      playerId: p.playerId,
      team: p.team,
      heroId: p.heroId,
      mmr: p.mmr,
    })),
    ...(mapId ? { mapId } : {}),
    ...(mode === 'tutorial' || mode === 'normal' ? { mode: mode as GameMode } : {}),
    ...(presenceOffline && Object.keys(presenceOffline).length > 0 ? { presenceOffline } : {}),
  }
}

/**
 * Finalize a finished game: persist match history + archive the replay
 * (unless it's a practice/tutorial game, which is never recorded — see
 * isPracticeGame), then delete the live_games + pending_actions rows so the
 * workflow can't tick it again.
 *
 * Failures THROW so the Workflow step retries: persistMatch and
 * saveMatchReplay are both idempotent (first-write-wins), and the live_games
 * row stays until both succeed. A swallowed error used to delete the row and
 * lose the match + the only copy of actionLog.
 *
 * Idempotent by construction: a missing row means a duplicate execution
 * already ran this — recordMatch/applyMatchDerivedStats are themselves
 * idempotent (see server/game/engine/matchPersistence.ts), and DELETE on an
 * already-deleted row is a no-op.
 */
export interface FinalizeDeps {
  liveGamesRepo: LiveGamesRepo
  pendingActionsRepo: PendingActionsRepo
  run: DbRunner
}

export async function finalizeGame(
  gameId: string,
  deps: FinalizeDeps = {
    liveGamesRepo: liveGamesRepo(),
    pendingActionsRepo: pendingActionsRepo(),
    run: productionDbRunner,
  },
): Promise<void> {
  const repo = deps.liveGamesRepo
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

  if (isPracticeGame(gameId, row.mode)) {
    // Practice banks no match/wins/hero_stats — but graduating the tutorial
    // must stick, or the new-player funnel re-offers it forever (this call
    // used to have no caller after the WS era). Idempotent. BEST-EFFORT: the
    // tick already tried it before game_over went out, and a flaky write must
    // never keep the row alive (it would pin the players to a dead game).
    for (const id of tutorialGraduates(state, row.mode, row.roster)) {
      try {
        await markTutorialCompleted([id], deps.run)
      } catch (err) {
        engineLog.error('[gameTick] tutorial completion could not be written; not blocking', {
          gameId,
          playerId: id,
          err: String(err),
        })
      }
    }
  } else {
    await persistMatch(gameId, state, row.roster, deps.run)

    const artifact = buildReplayArtifact(
      gameId,
      state,
      snapshotMetaFromRoster(row.roster, row.mapId, row.mode, state.presenceOffline),
      state.actionLog ?? [],
    )
    const archived = await deps.run((d) => d.saveMatchReplay(artifact))
    if (!archived) {
      throw new Error(`[gameTick] replay archive write failed for ${gameId}`)
    }
  }

  await deps.pendingActionsRepo.deleteAll(gameId)
  await repo.delete(gameId)
}

/**
 * Last resort when finalizeGame keeps failing (a Neon outage longer than the
 * step retries, or a permanent error such as an FK violation or an oversized
 * replay): drop the live_games + pending_actions rows WITHOUT recording the
 * match, so the game cannot sit at phase 'ended' forever. The match history for
 * this game is lost — hence the loud log, which is the only trace.
 */
export async function forceDeleteGame(
  gameId: string,
  deps: Pick<FinalizeDeps, 'liveGamesRepo' | 'pendingActionsRepo'> = {
    liveGamesRepo: liveGamesRepo(),
    pendingActionsRepo: pendingActionsRepo(),
  },
): Promise<void> {
  engineLog.error(
    '[gameTick] FINALIZE FAILED PERMANENTLY — deleting the game WITHOUT recording it',
    {
      gameId,
    },
  )
  await deps.pendingActionsRepo.deleteAll(gameId)
  await deps.liveGamesRepo.delete(gameId)
}

/**
 * Claim `gameId` for a run: stamp `epoch` into the state jsonb and return it
 * (null when the row is gone). The epoch is the Workflow RUN ID, not a random
 * value: the claim step is at-least-once, and a hung-then-retried claim must
 * write the SAME value rather than racing itself with a fresh one. Every later
 * tick of this run passes the epoch to runOneTick; a newer claim by any other
 * run (different run id) fences this one out (its CAS fails and it reports
 * `stale`).
 */
export async function claimRun(
  gameId: string,
  epoch: string,
  repo: LiveGamesRepo = liveGamesRepo(),
): Promise<string | null> {
  return (await repo.claimRun(gameId, epoch)) ? epoch : null
}
