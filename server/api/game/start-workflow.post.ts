import { startLiveGame } from '~~/server/game/liveGame'
import { secretsMatch } from '~~/server/utils/authTokens'
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
 * browser. server/middleware/auth.ts lists this path as public (no session
 * exists for a server-to-server call) precisely because THIS handler fails
 * closed on the key. The key is accepted via the `x-workflow-start-key`
 * header ONLY (never `?key=` — secrets in URLs land in access logs) and is
 * compared in constant time.
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
  const provided = getRequestHeader(event, 'x-workflow-start-key')
  if (!secretsMatch(provided, expected)) {
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
