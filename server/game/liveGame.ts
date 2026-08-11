import { Effect } from 'effect'
import { sql } from 'drizzle-orm'
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

  await start(runGame, [gameId])
  return { gameId }
}

/**
 * Whether `playerId` appears in any live_games row's roster — the Neon-path
 * equivalent of PeerRegistry.getPlayerGame (which only tracks DO-era
 * in-process assignments and knows nothing about workflow-driven games).
 * Used by both /api/queue/status-neon (report 'found' once a match's game
 * actually exists) and /api/queue/join-neon (reject a re-join while already
 * in a live game).
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
    .where(
      sql`exists (
        select 1 from jsonb_array_elements(${liveGames.roster}->'players') elem
        where elem->>'playerId' = ${playerId}
      )`,
    )
    .limit(1)
  return rows[0]?.gameId ?? null
}
