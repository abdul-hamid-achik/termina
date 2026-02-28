import { Effect } from 'effect'
import { getGameRuntime } from '../../plugins/game-server'
import { getQueueSize } from '../../game/matchmaking/queue'
import { getPlayerLobby, getLobby } from '../../game/matchmaking/lobby'
import { getPlayerGame } from '../../services/PeerRegistry'

export default defineEventHandler(async (event) => {
  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  const session = await getUserSession(event)
  const playerId = session?.user?.id as string | undefined

  if (playerId) {
    // Check if a game has already been created for this player
    const gameId = getPlayerGame(playerId)
    if (gameId) {
      return {
        status: 'game_starting' as const,
        gameId,
      }
    }

    // Check if the player has been placed in a lobby
    const lobbyId = getPlayerLobby(playerId)
    if (lobbyId) {
      const lobby = getLobby(lobbyId)
      if (lobby) {
        const player = lobby.players.find((p) => p.playerId === playerId)
        return {
          status: 'lobby' as const,
          lobbyId,
          team: player?.team ?? 'radiant',
          players: lobby.players.map((p) => ({
            playerId: p.playerId,
            team: p.team,
            heroId: p.heroId,
          })),
          phase: lobby.phase,
        }
      }
    }
  }

  const size = await Effect.runPromise(getQueueSize(runtime.redisService))

  return {
    status: 'searching' as const,
    playersInQueue: size,
    estimatedWaitSeconds: Math.max(10, size * 3),
  }
})
