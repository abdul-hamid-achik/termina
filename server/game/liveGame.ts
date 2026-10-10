import { Effect } from 'effect'
import { and, eq, gt, sql, type SQL } from 'drizzle-orm'
import { start } from 'workflow/api'
import { useDb } from '~~/server/db'
import {
  liveGames,
  type LiveGameRoster,
  type LiveGameRosterPlayer,
  type LiveGameBotOptions,
} from '~~/server/db/schema'
import { createInMemoryStateManager } from '~~/server/game/engine/StateManager'
import { serializeStateForTransport } from '~~/server/game/engine/replayArtifact'
import { runGame } from '~~/server/workflows/gameTick'
import { engineLog } from '~~/server/utils/log'
import type { GameMode } from '~~/shared/types/game'

/**
 * Shared "start a live game" primitive for the all-Vercel migration —
 * extracted from server/api/game/start-workflow.post.ts so the tutorial/
 * practice path (server/api/game/practice.post.ts) and the Neon queue's
 * match-formed path (server/game/matchmaking/matchStart.ts) don't each
 * reimplement "create the live_games row + kick off the game's first
 * runGame workflow tick". Behavior is identical to what start-workflow.
 * post.ts did inline: create the in-memory GameState via StateManager, flip
 * it to 'playing', persist it, then start() the workflow.
 */

export interface StartLiveGameOpts {
  /** GameState.mode ('normal' | 'tutorial') — NOT the queue mode
   *  ('ranked_5v5' | 'quick_3v3' | '1v1'), which has no GameState
   *  equivalent. Defaults to 'normal'. */
  mode?: GameMode
  mapId?: string
  /** Explicit gameId (used by start-workflow.post.ts, which lets its caller
   *  pick one). Takes precedence over gameIdPrefix. */
  gameId?: string
  /** Prefix for a generated id (`${prefix}_${Date.now()}_${rand}`) when no
   *  explicit gameId is given. Defaults to 'wf' (start-workflow.post.ts's
   *  original scheme). */
  gameIdPrefix?: string
  botOptions?: LiveGameBotOptions
}

export interface StartLiveGameResult {
  gameId: string
}

export async function startLiveGame(
  players: LiveGameRosterPlayer[],
  opts: StartLiveGameOpts = {},
): Promise<StartLiveGameResult> {
  const gameId =
    opts.gameId ??
    `${opts.gameIdPrefix ?? 'wf'}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const mode = opts.mode ?? 'normal'
  const mapId = opts.mapId

  const roster: LiveGameRoster = {
    players,
    ...(opts.botOptions ? { botOptions: opts.botOptions } : {}),
  }

  const sm = createInMemoryStateManager()
  await Effect.runPromise(
    sm.createGame(
      gameId,
      players.map((p) => ({ id: p.playerId, name: p.playerId, team: p.team, heroId: p.heroId })),
      { mapId, mode },
    ),
  )
  const playing = await Effect.runPromise(
    sm.updateState(gameId, (s) => ({ ...s, phase: 'playing' as const })),
  )

  const db = useDb()
  await db.insert(liveGames).values({
    gameId,
    state: serializeStateForTransport(playing),
    cycle: playing.cycle,
    roster,
    mode,
    mapId: mapId ?? null,
  })

  try {
    await start(runGame, [gameId])
  } catch (err) {
    // The row exists but no run will ever tick it. Left behind it would make
    // findLiveGameForPlayer report these players as "in a live game" forever
    // (blocking queue re-join), so remove it before surfacing the failure.
    try {
      await db.delete(liveGames).where(eq(liveGames.gameId, gameId))
    } catch (cleanupErr) {
      engineLog.error('[liveGame] failed to clean up orphan live_games row', {
        gameId,
        err: String(cleanupErr),
      })
    }
    throw err
  }
  return { gameId }
}

/**
 * A live game whose row has not been written for this long has a dead clock:
 * a healthy run commits (and bumps `updated_at`) every 4s cycle, so five
 * minutes of silence means the workflow run is gone (failed finalize, platform
 * outage, hung chain). Such a row must not pin its players to a dead /play
 * screen or block queue re-join. No schema change: `updated_at` already exists
 * and is written by every tick CAS and by the admin halt.
 */
export const LIVE_GAME_STALE_MS = 5 * 60 * 1000

/**
 * The "this player is in a game that is actually still running" predicate:
 * on the roster, not ended (an ended row is only waiting on finalize — if
 * finalize keeps failing it would otherwise live forever), and clock alive.
 */
export function liveGameForPlayerCondition(playerId: string, now: number = Date.now()): SQL {
  return and(
    sql`exists (
      select 1 from jsonb_array_elements(${liveGames.roster}->'players') elem
      where elem->>'playerId' = ${playerId}
    )`,
    sql`coalesce(${liveGames.state}->>'phase', '') <> 'ended'`,
    gt(liveGames.updatedAt, new Date(now - LIVE_GAME_STALE_MS)),
  )!
}

/**
 * Whether `playerId` appears in a still-running live_games row's roster — the
 * Neon-path equivalent of PeerRegistry.getPlayerGame (which only tracks DO-era
 * in-process assignments and knows nothing about workflow-driven games).
 * Used by both /api/queue/status-neon (report 'found' once a match's game
 * actually exists) and /api/queue/join-neon (reject a re-join while already
 * in a live game). Ended rows and rows with a dead clock (see
 * LIVE_GAME_STALE_MS) are ignored so a game stuck in finalize cannot lock its
 * players out.
 *
 * Pre-launch scale note: there is no players→game index, so this is a
 * seq-scan jsonb containment check over live_games (expected to hold at most
 * a handful of concurrent rows before launch). Revisit with a proper index
 * (or a denormalized player_id lookup table) once concurrent game volume
 * makes that matter.
 */
export async function findLiveGameForPlayer(playerId: string): Promise<string | null> {
  const db = useDb()
  const rows = await db
    .select({ gameId: liveGames.gameId })
    .from(liveGames)
    .where(liveGameForPlayerCondition(playerId))
    .limit(1)
  return rows[0]?.gameId ?? null
}
