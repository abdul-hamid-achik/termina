import { Effect } from 'effect'
import { start } from 'workflow/api'
import { useDb } from '~~/server/db'
import { liveGames, type LiveGameRoster } from '~~/server/db/schema'
import { createInMemoryStateManager } from '~~/server/game/engine/StateManager'
import { serializeStateForTransport } from '~~/server/game/engine/replayArtifact'
import { runGame } from '~~/server/workflows/gameTick'
import type { GameMode, TeamId } from '~~/shared/types/game'

interface StartWorkflowBody {
  gameId?: string
  players: { playerId: string; team: TeamId; heroId: string; mmr?: number }[]
  mapId?: string
  mode?: GameMode
  botOptions?: LiveGameRoster['botOptions']
}

/**
 * Internal trigger: create the live_games row for a new game and kick off
 * its runGame workflow (server/workflows/gameTick.ts). Gated behind
 * WORKFLOW_START_KEY rather than session auth — this is meant to be called
 * server-side from the matchmaking/lobby handoff, not directly by a
 * browser. Mirrors the spike routes' `?key=` gate
 * (server/routes/spike-workflow.*.ts) for now; a real service-to-service
 * call (or folding this into the lobby → game-ready path) is follow-up work
 * once that handoff is built for the all-Vercel cutover.
 */
export default defineEventHandler(async (event) => {
  const expected = process.env.WORKFLOW_START_KEY
  if (!expected) {
    throw createError({ statusCode: 503, message: 'WORKFLOW_START_KEY not configured' })
  }
  const provided = getRequestHeader(event, 'x-workflow-start-key') ?? getQuery(event).key
  if (provided !== expected) {
    throw createError({ statusCode: 403, message: 'workflow start key required' })
  }

  const body = await readBody<StartWorkflowBody>(event)
  if (!body?.players?.length) {
    throw createError({ statusCode: 400, message: 'players are required' })
  }
  for (const p of body.players) {
    if (!p.playerId || !p.team || !p.heroId) {
      throw createError({
        statusCode: 400,
        message: 'each player needs playerId, team and heroId',
      })
    }
  }

  const gameId = body.gameId ?? `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const mode = body.mode ?? 'normal'
  const mapId = body.mapId

  const roster: LiveGameRoster = {
    players: body.players.map((p) => ({
      playerId: p.playerId,
      team: p.team,
      heroId: p.heroId,
      mmr: p.mmr ?? 1000,
    })),
    ...(body.botOptions ? { botOptions: body.botOptions } : {}),
  }

  const sm = createInMemoryStateManager()
  await Effect.runPromise(
    sm.createGame(
      gameId,
      roster.players.map((p) => ({
        id: p.playerId,
        name: p.playerId,
        team: p.team,
        heroId: p.heroId,
      })),
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

  const run = await start(runGame, [gameId])
  return { gameId, run }
})
