import { Effect, Layer } from 'effect'
import { RedisService, makeRedisServiceLive, type RedisServiceApi } from '../services/RedisService'
import {
  DatabaseService,
  DatabaseServiceLive,
  type DatabaseServiceApi,
} from '../services/DatabaseService'
import {
  WebSocketService,
  WebSocketServiceLive,
  type WebSocketServiceApi,
} from '../services/WebSocketService'
import { gameLoggerLive } from '../utils/logger'
import { gameLog } from '../utils/log'
import { createInMemoryStateManager } from '../game/engine/StateManager'
import { startGameLoop, type GameCallbacks } from '../game/engine/GameLoop'
import { toGameEvent } from '../game/protocol/events'
import type { TeamId } from '~~/shared/types/game'
import type { NewMatch, NewMatchPlayer } from '../db/schema'
import { isBot, registerBots, cleanupGame } from '../game/ai/BotManager'
import { sendToPeer, setPlayerGame } from '../services/PeerRegistry'
import { cleanupLobby } from '../game/matchmaking/lobby'

interface GameRuntime {
  redisService: RedisServiceApi
  wsService: WebSocketServiceApi
  dbService: DatabaseServiceApi
  matchmakingInterval: ReturnType<typeof setInterval> | null
}

let _runtime: GameRuntime | null = null

export function getGameRuntime(): GameRuntime | null {
  return _runtime
}

export default defineNitroPlugin(async (nitroApp) => {
  const config = useRuntimeConfig()
  const redisUrl = (config.redis as { url: string }).url

  // Build Effect layers
  const redisLayer = makeRedisServiceLive(redisUrl)
  const mainLayer = Layer.mergeAll(redisLayer, DatabaseServiceLive, WebSocketServiceLive)

  // Extract service implementations by running a simple Effect
  const services = Effect.gen(function* () {
    const redis = yield* RedisService
    const db = yield* DatabaseService
    const ws = yield* WebSocketService
    return { redis, db, ws }
  })

  const { redis, db, ws } = await Effect.runPromise(
    Effect.provide(services, Layer.mergeAll(mainLayer, gameLoggerLive)),
  )

  // Start matchmaking loop
  const { startMatchmakingLoop } = await import('../game/matchmaking/queue')
  const matchmakingInterval = startMatchmakingLoop(redis, ws, db)

  // Subscribe to game_ready events from lobby
  await Effect.runPromise(
    redis.subscribe('matchmaking:game_ready', async (message) => {
      try {
        const gameData = JSON.parse(message) as {
          lobbyId: string
          players: { playerId: string; team: TeamId; heroId: string; mmr: number }[]
        }

        const gameId = `game_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        gameLog.info('game_ready received', { lobbyId: gameData.lobbyId, playerCount: gameData.players.length })

        // Create a standalone state manager for this game
        const stateManager = createInMemoryStateManager()

        // Create player setups
        const playerSetups = gameData.players.map((p) => ({
          id: p.playerId,
          name: p.playerId,
          team: p.team,
          heroId: p.heroId,
        }))

        // Create game
        await Effect.runPromise(stateManager.createGame(gameId, playerSetups))

        // Register bots for this game (lane assignment, tracking)
        registerBots(
          gameId,
          gameData.players.map((p) => ({ playerId: p.playerId, team: p.team })),
        )

        // Set phase to playing
        await Effect.runPromise(
          stateManager.updateState(gameId, (s) => ({ ...s, phase: 'playing' as const })),
        )

        // Notify real players that the game is starting via PeerRegistry
        // (players aren't registered with WebSocketService yet — that happens
        // when they respond with 'join_game')
        for (const p of gameData.players) {
          if (isBot(p.playerId)) continue
          gameLog.debug('Sending game_starting', { playerId: p.playerId, gameId })
          setPlayerGame(p.playerId, gameId)
          sendToPeer(p.playerId, {
            type: 'game_starting',
            gameId,
          })
        }

        // Clean up the lobby now that the game is created
        cleanupLobby(gameData.lobbyId)

        // Start game loop with callbacks
        const callbacks: GameCallbacks = {
          onTickState: (gId, playerId, filteredState) => {
            if (isBot(playerId)) return
            sendToPeer(playerId, {
              type: 'tick_state',
              tick: filteredState.tick,
              state: filteredState,
            })
          },

          onEvents: (gId, events) => {
            const msg = {
              type: 'events' as const,
              tick: events[0]?.tick ?? 0,
              events: events.map(toGameEvent),
            }
            for (const p of gameData.players) {
              if (isBot(p.playerId)) continue
              sendToPeer(p.playerId, msg)
            }
          },

          onGameOver: async (gId, winner) => {
            try {
              // Get final game state
              const finalState = await Effect.runPromise(stateManager.getState(gId))

              // Build match record
              const matchRecord: NewMatch = {
                id: gId,
                mode: 'ranked_5v5',
                winner,
                durationTicks: finalState.tick,
                endedAt: new Date(),
              }

              // Build match player records (real players only)
              const realPlayers = gameData.players.filter((p) => !isBot(p.playerId))
              const matchPlayerRecords: NewMatchPlayer[] = realPlayers.map((p) => {
                const ps = finalState.players[p.playerId]
                const isWinner = p.team === winner
                const mmrChange = isWinner ? 25 : -25
                return {
                  matchId: gId,
                  playerId: p.playerId,
                  team: p.team,
                  heroId: p.heroId,
                  kills: ps?.kills ?? 0,
                  deaths: ps?.deaths ?? 0,
                  assists: ps?.assists ?? 0,
                  goldEarned: ps?.gold ?? 0,
                  damageDealt: 0,
                  healingDone: 0,
                  finalItems: (ps?.items ?? []).filter((i): i is string => i !== null),
                  finalLevel: ps?.level ?? 1,
                  mmrChange,
                }
              })

              // Record match to DB
              await Effect.runPromise(db.recordMatch(matchRecord, matchPlayerRecords))

              // Update player stats (real players only)
              for (const p of realPlayers) {
                const isWinner = p.team === winner
                const newMmr = p.mmr + (isWinner ? 25 : -25)
                const ps = finalState.players[p.playerId]

                await Effect.runPromise(db.updatePlayerMMR(p.playerId, newMmr))
                await Effect.runPromise(db.incrementGamesPlayed(p.playerId))
                if (isWinner) {
                  await Effect.runPromise(db.incrementWins(p.playerId))
                }
                await Effect.runPromise(
                  db.updateHeroStats(p.playerId, p.heroId, {
                    won: isWinner,
                    kills: ps?.kills ?? 0,
                    deaths: ps?.deaths ?? 0,
                    assists: ps?.assists ?? 0,
                  }),
                )
              }

              // Build end stats for clients
              const endStats: Record<
                string,
                {
                  kills: number
                  deaths: number
                  assists: number
                  gold: number
                  items: (string | null)[]
                  heroDamage: number
                  towerDamage: number
                }
              > = {}
              for (const p of gameData.players) {
                const ps = finalState.players[p.playerId]
                endStats[p.playerId] = {
                  kills: ps?.kills ?? 0,
                  deaths: ps?.deaths ?? 0,
                  assists: ps?.assists ?? 0,
                  gold: ps?.gold ?? 0,
                  items: ps?.items ?? [],
                  heroDamage: 0,
                  towerDamage: 0,
                }
              }

              // Broadcast game over to all real players
              for (const p of realPlayers) {
                sendToPeer(p.playerId, {
                  type: 'game_over',
                  winner,
                  stats: endStats,
                })
              }

              // Cleanup bot tracking
              cleanupGame(gId)
            } catch (err) {
              Effect.runPromise(
                Effect.logError('Game over persistence failed').pipe(
                  Effect.annotateLogs({ gameId: gId, error: String(err) }),
                  Effect.withLogSpan('game_over_persist'),
                  Effect.provide(gameLoggerLive),
                ),
              )
            }
          },
        }

        gameLog.info('Game created — starting loop', { gameId, playerCount: gameData.players.length })

        // Brief delay to let clients navigate to /play and open game WS
        // before the first tick tries to send data
        await Effect.runPromise(Effect.sleep('2 seconds'))

        // Start the game loop (runs asynchronously via forkDaemon)
        Effect.runPromise(startGameLoop(gameId, stateManager, callbacks)).catch((err) => {
          Effect.runPromise(
            Effect.logError('Game loop error').pipe(
              Effect.annotateLogs({ gameId, error: String(err) }),
              Effect.provide(gameLoggerLive),
            ),
          )
        })

      } catch (err) {
        gameLog.error('Failed to process game_ready event', { error: String(err) })
      }
    }),
  )

  _runtime = {
    redisService: redis,
    wsService: ws,
    dbService: db,
    matchmakingInterval,
  }

  await Effect.runPromise(
    Effect.logInfo('Game server initialized').pipe(Effect.provide(gameLoggerLive)),
  )

  // Cleanup on shutdown
  nitroApp.hooks.hook('close', async () => {
    if (_runtime?.matchmakingInterval) {
      clearInterval(_runtime.matchmakingInterval)
    }
    await Effect.runPromise(redis.shutdown())
    _runtime = null
    await Effect.runPromise(
      Effect.logInfo('Game server shut down').pipe(Effect.provide(gameLoggerLive)),
    )
  })
})
