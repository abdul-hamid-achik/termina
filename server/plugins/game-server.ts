import { Effect, Layer, ManagedRuntime } from 'effect'
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
import { deleteSnapshot, readSnapshot, listSnapshotGameIds } from '../game/engine/StateSnapshot'
import { toGameEvent, type GameEngineEvent } from '../game/protocol/events'
import {
  calculateVision,
  filterStateForPlayer,
  filterStateForSpectator,
} from '../game/engine/VisionCalculator'
import { getSpectatorsOfGame, clearGameSpectators } from '../services/SpectatorRegistry'
import type { TeamId, GameState } from '~~/shared/types/game'
import type { NewMatch, NewMatchPlayer } from '../db/schema'
import { isBot, registerBots, cleanupGame } from '../game/ai/BotManager'
import { sendToPeer, setPlayerGame, clearPlayerGame } from '../services/PeerRegistry'
import { cleanupLobby } from '../game/matchmaking/lobby'
import { calculateMmrChange, applyMmrChange, teamAverageMmr } from '../game/matchmaking/elo'

/** Check if a game event is visible to a specific player based on vision. */
function isEventVisibleToPlayer(
  event: GameEngineEvent,
  playerId: string,
  playerTeam: TeamId | undefined,
  visibleZones: Set<string>,
  state: GameState,
): boolean {
  // Global events always visible
  switch (event._tag) {
    case 'kill':
    case 'death':
    case 'tower_kill':
    case 'roshan_killed':
    case 'level_up':
      return true
  }
  // Check per-event visibility
  switch (event._tag) {
    case 'damage':
    case 'heal': {
      if (event.sourceId === playerId || event.targetId === playerId) return true
      if (state.players[event.sourceId]?.team === playerTeam) return true
      if (state.players[event.targetId]?.team === playerTeam) return true
      const srcZone = state.players[event.sourceId]?.zone
      const tgtZone = state.players[event.targetId]?.zone
      return !!(srcZone && visibleZones.has(srcZone)) || !!(tgtZone && visibleZones.has(tgtZone))
    }
    case 'creep_lasthit':
    case 'gold_change':
    case 'item_purchased':
      if (event.playerId === playerId) return true
      return state.players[event.playerId]?.team === playerTeam
    case 'ability_used': {
      if (event.playerId === playerId) return true
      if (state.players[event.playerId]?.team === playerTeam) return true
      const casterZone = state.players[event.playerId]?.zone
      return !!(casterZone && visibleZones.has(casterZone))
    }
    case 'ward_placed':
      if (event.playerId === playerId) return true
      return event.team === playerTeam || visibleZones.has(event.zone)
    case 'rune_picked':
      if (event.playerId === playerId) return true
      return visibleZones.has(event.zone)
    default:
      return true
  }
}

interface GameRuntime {
  redisService: RedisServiceApi
  wsService: WebSocketServiceApi
  dbService: DatabaseServiceApi
  managedRuntime: ManagedRuntime.ManagedRuntime<never, never>
  matchmakingInterval: ReturnType<typeof setInterval> | null
}

let _runtime: GameRuntime | null = null

// ── Live game registry (reconnect support) ─────────────────────
// Each game's state manager lives in callback closures; this registry gives
// the WS route access to current state + a recent-event ring so reconnecting
// players get an immediate snapshot and the events they missed.

const RECENT_EVENTS_CAP = 300

interface LiveGameEntry {
  stateManager: ReturnType<typeof createInMemoryStateManager>
  recentEvents: GameEngineEvent[]
}

const liveGames = new Map<string, LiveGameEntry>()

function registerLiveGame(
  gameId: string,
  stateManager: ReturnType<typeof createInMemoryStateManager>,
): void {
  liveGames.set(gameId, { stateManager, recentEvents: [] })
}

function recordRecentEvents(gameId: string, events: GameEngineEvent[]): void {
  const entry = liveGames.get(gameId)
  if (!entry) return
  entry.recentEvents.push(...events)
  if (entry.recentEvents.length > RECENT_EVENTS_CAP) {
    entry.recentEvents.splice(0, entry.recentEvents.length - RECENT_EVENTS_CAP)
  }
}

/**
 * Build the payload for a reconnecting player: the current vision-filtered
 * state plus the visible events they missed since `sinceTick` (exclusive).
 * Returns null if the game isn't live on this instance.
 */
export function getReconnectPayload(
  gameId: string,
  playerId: string,
  sinceTick?: number,
): {
  tick: number
  state: ReturnType<typeof filterStateForPlayer>
  events: ReturnType<typeof toGameEvent>[]
} | null {
  const entry = liveGames.get(gameId)
  if (!entry) return null

  let state: GameState
  try {
    state = Effect.runSync(entry.stateManager.getState(gameId))
  } catch {
    return null
  }

  const filteredState = filterStateForPlayer(state, playerId)
  const playerTeam = state.players[playerId]?.team
  const visibleZones = calculateVision(state, playerId)
  const missed = entry.recentEvents.filter(
    (e) =>
      (sinceTick === undefined || e.tick > sinceTick) &&
      isEventVisibleToPlayer(e, playerId, playerTeam, visibleZones, state),
  )

  return { tick: state.tick, state: filteredState, events: missed.map(toGameEvent) }
}

export function getGameRuntime(): GameRuntime | null {
  return _runtime
}

/**
 * Test-only hook: force a live game to end with the given winner.
 *
 * Sets the game's phase to 'ended' + winner via its state manager (mirroring
 * how this plugin already drives `updateState`). The running GameLoop fiber
 * picks this up on its next tick — its win-condition block (GameLoop.ts ~282)
 * sees `phase === 'ended'` with a winner and fires `callbacks.onGameOver`,
 * which persists the match and broadcasts `game_over` to clients. So forcing
 * the state ends the game cleanly, exactly as an Ancient kill would.
 *
 * Returns false if no such live game exists (e.g. on another instance, or
 * already ended). HARD no-op in production — never end real matches.
 *
 * Gated again at the API layer (server/api/test/force-end.post.ts), but the
 * production guard lives here too so no caller can ever reach it in prod.
 */
export function forceEndGame(gameId: string, winner: TeamId): boolean {
  if (process.env.NODE_ENV === 'production') return false

  const entry = liveGames.get(gameId)
  if (!entry) return false

  const runtime = _runtime
  if (!runtime) return false

  try {
    runtime.managedRuntime.runSync(
      entry.stateManager.updateState(gameId, (s) => ({
        ...s,
        phase: 'ended' as const,
        winner,
      })),
    )
    return true
  } catch (err) {
    gameLog.error('forceEndGame failed', { gameId, error: String(err) })
    return false
  }
}

export default defineNitroPlugin(async (nitroApp) => {
  const config = useRuntimeConfig()
  const redisUrl = (config.redis as { url: string }).url

  // Build Effect layers
  const redisLayer = makeRedisServiceLive(redisUrl)
  const mainLayer = Layer.mergeAll(redisLayer, DatabaseServiceLive, WebSocketServiceLive)

  // Create a ManagedRuntime that owns the lifecycle of all services.
  // This provides layers (including the game logger) to all effects run
  // through it, including long-lived game loop fibers.
  const appLayer = Layer.mergeAll(mainLayer, gameLoggerLive)
  const managedRuntime = ManagedRuntime.make(appLayer)

  // Extract service implementations via the managed runtime
  const { redis, db, ws } = await managedRuntime.runPromise(
    Effect.gen(function* () {
      const redis = yield* RedisService
      const db = yield* DatabaseService
      const ws = yield* WebSocketService
      return { redis, db, ws }
    }),
  )

  // Start matchmaking loop
  const { startMatchmakingLoop } = await import('../game/matchmaking/queue')
  const matchmakingInterval = startMatchmakingLoop(redis, ws, db)

  // Build the callbacks for a single game. Captured separately from the
  // game_ready handler so the snapshot-resume path can use the same shape.
  type StartPlayer = { playerId: string; team: TeamId; heroId: string; mmr: number }
  function buildCallbacks(
    players: StartPlayer[],
    stateManager: ReturnType<typeof createInMemoryStateManager>,
  ): GameCallbacks {
    return {
      onTickState: (_gId, playerId, filteredState) => {
        if (isBot(playerId)) return
        sendToPeer(playerId, {
          type: 'tick_state',
          tick: filteredState.tick,
          state: filteredState,
        })
      },

      onSpectatorTick: (gId, fullState) => {
        const watchers = getSpectatorsOfGame(gId)
        if (watchers.length === 0) return
        const fogless = filterStateForSpectator(fullState)
        const payload = JSON.stringify({
          type: 'spectator_tick',
          tick: fogless.tick,
          state: fogless,
        })
        for (const watcher of watchers) {
          try {
            watcher.send(payload)
          } catch (err) {
            gameLog.warn('Spectator send failed', { gameId: gId, error: String(err) })
          }
        }
      },

      onActionRejected: (_gId, playerId, reason) => {
        if (isBot(playerId)) return
        sendToPeer(playerId, {
          type: 'announcement',
          message: reason,
          level: 'warning',
        })
      },

      onEvents: (gId, events) => {
        if (events.length === 0) return

        recordRecentEvents(gId, events)

        let state: GameState | null = null
        try {
          state = Effect.runSync(stateManager.getState(gId))
        } catch {
          // State unavailable — fall back to unfiltered
        }

        for (const p of players) {
          if (isBot(p.playerId)) continue

          if (state) {
            const visibleZones = calculateVision(state, p.playerId)
            const playerTeam = state.players[p.playerId]?.team
            const visibleEvents = events.filter((e) =>
              isEventVisibleToPlayer(e, p.playerId, playerTeam, visibleZones, state!),
            )
            if (visibleEvents.length > 0) {
              sendToPeer(p.playerId, {
                type: 'events' as const,
                tick: visibleEvents[0]?.tick ?? 0,
                events: visibleEvents.map(toGameEvent),
              })
            }
          } else {
            sendToPeer(p.playerId, {
              type: 'events' as const,
              tick: events[0]?.tick ?? 0,
              events: events.map(toGameEvent),
            })
          }
        }
      },

      onGameOver: async (gId, winner) => {
        try {
          const finalState = await managedRuntime.runPromise(stateManager.getState(gId))

          const matchRecord: NewMatch = {
            id: gId,
            mode: 'ranked_5v5',
            winner,
            durationTicks: finalState.tick,
            endedAt: new Date(),
          }

          const realPlayers = players.filter((p) => !isBot(p.playerId))
          // Elo: each player's change is measured against the enemy team's
          // average MMR (bots included — they queue with a real bracket).
          const mmrChanges = new Map<string, number>()
          for (const p of realPlayers) {
            const enemyAvg = teamAverageMmr(
              players.filter((e) => e.team !== p.team).map((e) => e.mmr),
            )
            mmrChanges.set(p.playerId, calculateMmrChange(p.mmr, enemyAvg, p.team === winner))
          }
          const matchPlayerRecords: NewMatchPlayer[] = realPlayers.map((p) => {
            const ps = finalState.players[p.playerId]
            const mmrChange = mmrChanges.get(p.playerId) ?? 0
            return {
              matchId: gId,
              playerId: p.playerId,
              team: p.team,
              heroId: p.heroId,
              kills: ps?.kills ?? 0,
              deaths: ps?.deaths ?? 0,
              assists: ps?.assists ?? 0,
              goldEarned: ps?.gold ?? 0,
              damageDealt: ps?.damageDealt ?? 0,
              healingDone: 0,
              finalItems: (ps?.items ?? []).filter((i): i is string => i !== null),
              finalLevel: ps?.level ?? 1,
              mmrChange,
            }
          })

          await managedRuntime.runPromise(
            Effect.gen(function* () {
              yield* db.recordMatch(matchRecord, matchPlayerRecords)

              for (const p of realPlayers) {
                const isWinner = p.team === winner
                const newMmr = applyMmrChange(p.mmr, mmrChanges.get(p.playerId) ?? 0)
                const ps = finalState.players[p.playerId]

                yield* db.updatePlayerMMR(p.playerId, newMmr)
                yield* db.incrementGamesPlayed(p.playerId)
                if (isWinner) {
                  yield* db.incrementWins(p.playerId)
                }
                yield* db.updateHeroStats(p.playerId, p.heroId, {
                  won: isWinner,
                  kills: ps?.kills ?? 0,
                  deaths: ps?.deaths ?? 0,
                  assists: ps?.assists ?? 0,
                })
              }
            }),
          )

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
          for (const p of players) {
            const ps = finalState.players[p.playerId]
            endStats[p.playerId] = {
              kills: ps?.kills ?? 0,
              deaths: ps?.deaths ?? 0,
              assists: ps?.assists ?? 0,
              gold: ps?.gold ?? 0,
              items: ps?.items ?? [],
              heroDamage: ps?.damageDealt ?? 0,
              towerDamage: ps?.towerDamageDealt ?? 0,
            }
          }

          for (const p of realPlayers) {
            sendToPeer(p.playerId, {
              type: 'game_over',
              winner,
              stats: endStats,
            })
          }

          for (const p of realPlayers) {
            clearPlayerGame(p.playerId)
          }

          cleanupGame(gId)
          clearGameSpectators(gId)
          liveGames.delete(gId)
          // Leave the snapshot + action log behind so PostGame can show a
          // replay link. The Redis TTL (8h) cleans them up eventually, and
          // the resume-on-boot path already skips ended-phase snapshots.
        } catch (err) {
          gameLog.error('Game over persistence failed', { gameId: gId, error: String(err) })
        }
      },
    }
  }

  // Subscribe to game_ready events from lobby
  await managedRuntime.runPromise(
    redis.subscribe('matchmaking:game_ready', async (message) => {
      try {
        const gameData = JSON.parse(message) as {
          lobbyId: string
          players: { playerId: string; team: TeamId; heroId: string; mmr: number }[]
        }

        const gameId = `game_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        gameLog.info('game_ready received', {
          lobbyId: gameData.lobbyId,
          playerCount: gameData.players.length,
        })

        // Create a standalone state manager for this game
        const stateManager = createInMemoryStateManager()
        registerLiveGame(gameId, stateManager)

        // Create player setups
        const playerSetups = gameData.players.map((p) => ({
          id: p.playerId,
          name: p.playerId,
          team: p.team,
          heroId: p.heroId,
        }))

        // Initialise game state in a single Effect pipeline
        await managedRuntime.runPromise(
          Effect.gen(function* () {
            yield* stateManager.createGame(gameId, playerSetups)
            yield* stateManager.updateState(gameId, (s) => ({ ...s, phase: 'playing' as const }))
          }),
        )

        // Register bots for this game (lane assignment, tracking)
        registerBots(
          gameId,
          gameData.players.map((p) => ({ playerId: p.playerId, team: p.team, heroId: p.heroId })),
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

        const callbacks = buildCallbacks(gameData.players, stateManager)

        gameLog.info('Game created — starting loop', {
          gameId,
          playerCount: gameData.players.length,
        })

        // Brief delay to let clients navigate to /play and open game WS
        // before the first tick tries to send data
        await managedRuntime.runPromise(Effect.sleep('2 seconds'))

        // Start the game loop as a fiber within the managed runtime.
        // The snapshot meta lets the resume path rebuild the same callbacks
        // after a process restart.
        startGameLoop(gameId, stateManager, callbacks, managedRuntime, redis, {
          players: gameData.players,
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
    managedRuntime,
    matchmakingInterval,
  }

  // Resume any in-progress games whose snapshots survived a restart.
  // Best-effort: failures are logged and the game is dropped.
  try {
    const gameIds = await managedRuntime.runPromise(listSnapshotGameIds(redis))
    if (gameIds.length > 0) {
      gameLog.info('Found snapshots to resume', { count: gameIds.length })
    }
    for (const gameId of gameIds) {
      const snap = await managedRuntime.runPromise(readSnapshot(redis, gameId))
      if (!snap) continue

      // Snapshots for ended games shouldn't exist (deleteSnapshot runs on
      // game-over) but handle them defensively.
      if (snap.state.phase === 'ended') {
        await managedRuntime.runPromise(deleteSnapshot(redis, gameId))
        continue
      }

      if (!snap.meta) {
        gameLog.warn('Snapshot has no meta — cannot resume', { gameId })
        await managedRuntime.runPromise(deleteSnapshot(redis, gameId))
        continue
      }

      const stateManager = createInMemoryStateManager()
      await managedRuntime.runPromise(stateManager.loadGame(gameId, snap.state))
      registerLiveGame(gameId, stateManager)

      registerBots(
        gameId,
        snap.meta.players.map((p) => ({
          playerId: p.playerId,
          team: p.team,
          heroId: p.heroId,
        })),
      )

      for (const p of snap.meta.players) {
        if (!isBot(p.playerId)) {
          setPlayerGame(p.playerId, gameId)
        }
      }

      const callbacks = buildCallbacks(snap.meta.players, stateManager)
      startGameLoop(gameId, stateManager, callbacks, managedRuntime, redis, {
        players: snap.meta.players,
      })

      gameLog.info('Resumed game from snapshot', {
        gameId,
        tick: snap.state.tick,
        ageMs: Date.now() - snap.savedAt,
      })
    }
  } catch (err) {
    gameLog.error('Snapshot resume failed', { error: String(err) })
  }

  gameLog.info('Game server initialized')

  // Cleanup on shutdown — dispose the managed runtime which cleans up
  // all service layers (Redis connections, etc.)
  nitroApp.hooks.hook('close', async () => {
    if (_runtime?.matchmakingInterval) {
      clearInterval(_runtime.matchmakingInterval)
    }
    await managedRuntime.runPromise(redis.shutdown())
    await managedRuntime.dispose()
    _runtime = null
    gameLog.info('Game server shut down')
  })
})
