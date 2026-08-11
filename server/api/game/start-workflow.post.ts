import { startLiveGame } from '~~/server/game/liveGame'
import type { LiveGameRoster, LiveGameRosterPlayer } from '~~/server/db/schema'
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
 *
 * The live_games-row-creation + start(runGame,[gameId]) logic itself lives
 * in server/game/liveGame.ts's startLiveGame — shared with the tutorial/
 * practice path (practice.post.ts) and the Neon queue's match-formed path
 * (matchmaking/matchStart.ts) rather than reimplemented here.
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

  const players: LiveGameRosterPlayer[] = body.players.map((p) => ({
    playerId: p.playerId,
    team: p.team,
    heroId: p.heroId,
    mmr: p.mmr ?? 1000,
  }))

  const { gameId } = await startLiveGame(players, {
    gameId: body.gameId,
    mode: body.mode ?? 'normal',
    mapId: body.mapId,
    botOptions: body.botOptions,
  })

  return { gameId }
})
