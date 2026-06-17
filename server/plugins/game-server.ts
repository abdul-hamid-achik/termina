import { Effect, Layer, ManagedRuntime } from 'effect'
import { testHooksEnabled } from '~~/server/utils/testHooks'
import {
  RedisService,
  makeRedisServiceLive,
  type RedisServiceApi,
} from '~~/server/services/RedisService'
import {
  DatabaseService,
  DatabaseServiceLive,
  type DatabaseServiceApi,
} from '~~/server/services/DatabaseService'
import {
  WebSocketService,
  WebSocketServiceLive,
  type WebSocketServiceApi,
} from '~~/server/services/WebSocketService'
import { gameLoggerLive } from '~~/server/utils/logger'
import { gameLog } from '~~/server/utils/log'
import { createInMemoryStateManager } from '~~/server/game/engine/StateManager'
import {
  startGameLoop,
  stopGameLoop,
  runOneTick,
  type GameCallbacks,
} from '~~/server/game/engine/GameLoop'
import {
  deleteSnapshot,
  readSnapshot,
  listSnapshotGameIds,
} from '~~/server/game/engine/StateSnapshot'
import { toGameEvent, type GameEngineEvent } from '~~/server/game/protocol/events'
import {
  calculateVision,
  filterStateForPlayer,
  filterStateForSpectator,
} from '~~/server/game/engine/VisionCalculator'
import { getSpectatorsOfGame, clearGameSpectators } from '~~/server/services/SpectatorRegistry'
import type { TeamId, GameState, GameMode } from '~~/shared/types/game'
import type { PlayerEndStats } from '~~/shared/types/protocol'
import type { NewMatch, NewMatchPlayer } from '~~/server/db/schema'
import { isBot, registerBots, cleanupGame } from '~~/server/game/ai/BotManager'
import { buildTutorialRoster } from '~~/server/game/modes/tutorial'
import {
  sendToPeer,
  setPlayerGame,
  clearPlayerGame,
  hasPeer,
} from '~~/server/services/PeerRegistry'
import { cleanupLobby } from '~~/server/game/matchmaking/lobby'
import { calculateMmrChange, applyMmrChange, teamAverageMmr } from '~~/server/game/matchmaking/elo'
import { HEROES } from '~~/shared/constants/heroes'
import { registerAllHeroes } from '~~/server/game/heroes'
import { applyScenario } from '~~/server/game/dev/scenarios'

/** Check if a game event is visible to a specific player based on vision. */
export function isEventVisibleToPlayer(
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
    case 'item_sold':
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
    case 'teleport_complete': {
      if (event.playerId === playerId) return true
      if (state.players[event.playerId]?.team === playerTeam) return true
      // An enemy teleport is revealed only if you can see where they arrive —
      // otherwise their rotation/gank stays hidden (it leaked to everyone before).
      return visibleZones.has(event.destination)
    }
    case 'teleport_cancelled': {
      if (event.playerId === playerId) return true
      if (state.players[event.playerId]?.team === playerTeam) return true
      // An enemy's interrupted TP only shows if you can actually see them.
      const z = state.players[event.playerId]?.zone
      return !!(z && visibleZones.has(z))
    }
    case 'neutral_killed':
      if (event.playerId === playerId) return true
      if (state.players[event.playerId]?.team === playerTeam) return true
      // An enemy farming the jungle only shows if you can see that camp —
      // otherwise it leaks where they are.
      return visibleZones.has(event.zone)
    case 'talent_selected':
    case 'power_spike':
      // Enemy build/power-spike info is team-private — you learn an enemy spiked
      // by scouting them, not from a broadcast (publicly warning about a spike
      // you have no vision on is a fog leak in disguise). Own + allied spikes
      // stay visible (clarity carve-out); genuinely global events (Aegis) are
      // handled by their own always-visible cases.
      if (event.playerId === playerId) return true
      return state.players[event.playerId]?.team === playerTeam
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
  if (process.env.NODE_ENV === 'production' && !testHooksEnabled()) return false

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

// ── Dev-only seed hooks (see README.md, Testing section) ──────
// Build a REAL game directly, bypassing matchmaking, so BDD/e2e specs can land
// in a known state instead of playing a bot match. The implementation is wired
// from inside the plugin (it shares the same services + buildCallbacks as the
// matchmaking path); these top-level shims forward to it and HARD no-op in
// production. Routes (server/api/test/*) gate again on TERMINA_TEST_HOOKS.

export interface DevGameOpts {
  /** The authenticated session user — becomes the human player. */
  humanId: string
  humanHeroId?: string
  /** Reproducible game id; also reserved for the Phase-B seeded RNG. */
  seed?: number
  /** Named scenario to shape the fresh game into. */
  scenario?: string
  /** Manual-tick mode: no auto-schedule; ticks are driven by advanceDevGame (A3). */
  manualTick?: boolean
  /** Map to run on (default full 5v5). 'one_lane' forces bots to the mid lane. */
  mapId?: string
  /** Game mode (default 'normal'). 'tutorial' uses the small guided roster. */
  mode?: GameMode
}

let _createDevGame: ((opts: DevGameOpts) => Promise<{ gameId: string } | null>) | null = null

/** Dev/test-only: create a real game with no matchmaking. Null in prod / pre-boot. */
export async function createDevGame(opts: DevGameOpts): Promise<{ gameId: string } | null> {
  if (process.env.NODE_ENV === 'production' && !testHooksEnabled()) return null
  return _createDevGame ? _createDevGame(opts) : null
}

/**
 * Production: create a single-player tutorial game — the human plus bots on the
 * one-lane map, in tutorial mode. UNLIKE createDevGame this is a real player
 * feature, so it is NOT gated by test hooks (only by being booted). Returns null
 * before the game server has finished starting.
 */
export async function createTutorialGame(opts: {
  humanId: string
  humanHeroId?: string
}): Promise<{ gameId: string } | null> {
  return _createDevGame
    ? _createDevGame({
        humanId: opts.humanId,
        humanHeroId: opts.humanHeroId,
        mapId: 'one_lane',
        mode: 'tutorial',
      })
    : null
}

/** Dev/test-only: raw GameState snapshot for spec assertions (engine-truth checks). */
export function getDevRawState(gameId: string): GameState | null {
  if (process.env.NODE_ENV === 'production' && !testHooksEnabled()) return null
  const entry = liveGames.get(gameId)
  if (!entry) return null
  try {
    return Effect.runSync(entry.stateManager.getState(gameId))
  } catch {
    return null
  }
}

// Manual-tick dev games (created with manualTick: true) — driven by advanceDevGame
// instead of the fixed-interval loop, so a spec controls time deterministically.
const _devGameLoops = new Map<
  string,
  { stateManager: ReturnType<typeof createInMemoryStateManager>; callbacks: GameCallbacks }
>()
let _advanceDevGame: ((gameId: string, ticks: number) => Promise<number>) | null = null

/** Dev/test-only: advance a manual-tick dev game by N ticks. 0 in prod / unknown game. */
export async function advanceDevGame(gameId: string, ticks: number): Promise<number> {
  if (process.env.NODE_ENV === 'production' && !testHooksEnabled()) return 0
  return _advanceDevGame ? _advanceDevGame(gameId, ticks) : 0
}

/**
 * Dev/test-only: stop + drop a seeded game so it stops ticking. Called from the WS
 * close handler when a dev game's player disconnects with no reconnect (the e2e
 * spec is done). Without this, every non-manual seeded game's loop runs FOREVER —
 * across a suite they pile up and load the single server process until navigations
 * time out. Only touches `dev_` games (which exist only under TERMINA_TEST_HOOKS).
 */
export function stopDevGame(gameId: string): void {
  if (!gameId.startsWith('dev_')) return
  const runtime = _runtime
  if (!runtime) return
  liveGames.delete(gameId)
  _devGameLoops.delete(gameId)
  cleanupGame(gameId)
  // Interrupt the running loop fiber (no-op for manual games / already-stopped).
  void runtime.managedRuntime.runPromise(stopGameLoop(gameId)).catch(() => {})
}

// ── Zombie dev-game reaper ──────────────────────────────────────
// A seeded LIVE (non-manualTick) game auto-starts its loop at /api/test/new-game
// and keeps running the full processTick pipeline + broadcasting every tick even
// when NO browser peer is connected — e.g. the e2e browser failed to connect under
// CI load, or a spec ended without a clean WS close (so the close-handler teardown
// never fired). Those zombies run to natural game-end (~325 ticks at fast-game),
// spamming "No peer found" and burning CPU; under the parallel e2e suite they
// saturate CI cores and blow the watchdog budget. stopDevGame only fires on a WS
// CLOSE, which never comes if the peer never opened — so this reaper catches the
// never-connected case by polling for dev games with no connected human peer.
//
// Grace must exceed the browser's connect time (seed -> cold-start /play nav ->
// WS join can take ~30s in CI), so we reap only after a sustained peerless window.
// Test-hooks-only: dev_ games exist only under TERMINA_TEST_HOOKS=1, so there is
// zero production overhead and real games are never touched.
const DEV_PEERLESS_REAP_MS = 60_000
const _devPeerlessSince = new Map<string, number>()
let _reaperTimer: ReturnType<typeof setInterval> | null = null

function reapPeerlessDevGames(): void {
  const now = Date.now()
  for (const gameId of liveGames.keys()) {
    if (!gameId.startsWith('dev_')) continue
    const state = getDevRawState(gameId)
    if (!state || state.phase === 'ended') {
      _devPeerlessSince.delete(gameId)
      continue
    }
    const humanConnected = Object.values(state.players).some((p) => !isBot(p.id) && hasPeer(p.id))
    if (humanConnected) {
      _devPeerlessSince.delete(gameId)
      continue
    }
    let since = _devPeerlessSince.get(gameId)
    if (since === undefined) {
      since = now
      _devPeerlessSince.set(gameId, now)
    }
    if (now - since >= DEV_PEERLESS_REAP_MS) {
      _devPeerlessSince.delete(gameId)
      gameLog.warn('Reaping peerless dev game (no connected human peer)', {
        gameId,
        peerlessMs: now - since,
      })
      stopDevGame(gameId)
    }
  }
}

export default defineNitroPlugin(async (nitroApp) => {
  // Populate the hero ability/passive registry up front. Each hero module also
  // self-registers on import, but the production bundle tree-shook those
  // side-effect-only imports (see server/game/heroes/index.ts) — leaving an empty
  // registry so every cast failed with "No resolver registered". Calling this
  // from the plugin entry point pins the whole hero chain into the build.
  registerAllHeroes()

  // Loud, unmissable warning if the dev/e2e test hooks are enabled. Their gate is
  // now the explicit TERMINA_TEST_HOOKS=1 opt-in alone (the prod e2e runs against a
  // production build, so NODE_ENV can't gate them) — they bypass auth (login-as
  // mints a session for ANY username) and must NEVER be set in a real deployment.
  if (testHooksEnabled()) {
    console.warn(
      '\n⚠️  TERMINA_TEST_HOOKS=1 — test endpoints (server/api/test/*) are ENABLED.\n' +
        '   They bypass auth and seed/teardown games. NEVER set this in production.\n',
    )
    // Reap peerless seeded games so zombie loops can't pile up across an e2e run.
    if (!_reaperTimer) {
      _reaperTimer = setInterval(reapPeerlessDevGames, 15_000)
      // Don't keep the process alive just for the reaper.
      ;(_reaperTimer as { unref?: () => void }).unref?.()
    }
  }

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
  const { startMatchmakingLoop } = await import('~~/server/game/matchmaking/queue')
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
        let finalState: GameState
        try {
          finalState = await managedRuntime.runPromise(stateManager.getState(gId))
        } catch (err) {
          gameLog.error('Game over: could not read final state', {
            gameId: gId,
            error: String(err),
          })
          return
        }

        const realPlayers = players.filter((p) => !isBot(p.playerId))

        // Build the end-of-game stats (no DB needed) and broadcast game_over
        // FIRST. Players must reach the post-game screen even if DB persistence
        // fails — a database hiccup must never strand everyone in a dead game.
        // Use the shared client-facing type so TS enforces the server's
        // game_over payload matches exactly what the post-game screen reads —
        // no silent server/client drift.
        const endStats: Record<string, PlayerEndStats> = {}
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
          sendToPeer(p.playerId, { type: 'game_over', winner, stats: endStats })
        }

        // Persist the match + MMR separately — failure is logged but never
        // blocks the broadcast above or the cleanup below.
        try {
          const matchRecord: NewMatch = {
            id: gId,
            mode: 'ranked_5v5',
            winner,
            durationTicks: finalState.tick,
            endedAt: new Date(),
          }
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
        } catch (err) {
          gameLog.error('Game over persistence failed', { gameId: gId, error: String(err) })
        }

        // Cleanup always runs, regardless of persistence outcome.
        for (const p of realPlayers) {
          clearPlayerGame(p.playerId)
        }
        cleanupGame(gId)
        clearGameSpectators(gId)
        liveGames.delete(gId)
        // Leave the snapshot + action log behind so PostGame can show a replay
        // link. The Redis TTL (8h) cleans them up; the resume-on-boot path
        // already skips ended-phase snapshots.
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

  // Dev-only direct game creation. Defined here so it shares the same services
  // + buildCallbacks the matchmaking handler uses; the game_ready path is left
  // untouched. Gated by createDevGame() above + the route layer (no-op in prod).
  _createDevGame = async (opts) => {
    const seed = opts.seed ?? Date.now()
    const gameId = `dev_${seed}_${Math.random().toString(36).slice(2, 6)}`

    // Roster. Tutorial = a small guided 2v2 on the one-lane map; otherwise the
    // human (radiant) + 4 radiant bots + 5 dire bots, all distinct heroes.
    const heroIds = Object.keys(HEROES)
    const humanHero = opts.humanHeroId && HEROES[opts.humanHeroId] ? opts.humanHeroId : heroIds[0]!
    let players: StartPlayer[]
    if (opts.mode === 'tutorial') {
      players = buildTutorialRoster(opts.humanId, humanHero, gameId).map((p) => ({
        ...p,
        mmr: 1000,
      }))
    } else {
      const used = new Set<string>([humanHero])
      const nextHero = () => {
        const h = heroIds.find((x) => !used.has(x)) ?? heroIds[0]!
        used.add(h)
        return h
      }
      players = [{ playerId: opts.humanId, team: 'radiant', heroId: humanHero, mmr: 1000 }]
      for (let i = 0; i < 4; i++)
        players.push({
          playerId: `bot_r${i}_${gameId}`,
          team: 'radiant',
          heroId: nextHero(),
          mmr: 1000,
        })
      for (let i = 0; i < 5; i++)
        players.push({
          playerId: `bot_d${i}_${gameId}`,
          team: 'dire',
          heroId: nextHero(),
          mmr: 1000,
        })
    }

    const stateManager = createInMemoryStateManager()
    registerLiveGame(gameId, stateManager)
    const playerSetups = players.map((p) => ({
      id: p.playerId,
      name: p.playerId,
      team: p.team,
      heroId: p.heroId,
    }))
    await managedRuntime.runPromise(
      Effect.gen(function* () {
        yield* stateManager.createGame(gameId, playerSetups, { mapId: opts.mapId, mode: opts.mode })
        yield* stateManager.updateState(gameId, (s) => {
          const playing = { ...s, phase: 'playing' as const }
          return opts.scenario
            ? applyScenario(playing, opts.scenario, { seed, humanId: opts.humanId })
            : playing
        })
      }),
    )
    registerBots(
      gameId,
      players
        .filter((p) => isBot(p.playerId))
        .map((p) => ({ playerId: p.playerId, team: p.team, heroId: p.heroId })),
      // On a subset map the role lanes (top/bot/jungle) don't exist; pin bots to
      // mid so their global-graph pathing can't walk them off the map.
      { forceLane: opts.mapId === 'one_lane' ? 'mid' : undefined },
    )
    setPlayerGame(opts.humanId, gameId)
    const callbacks = buildCallbacks(players, stateManager)
    if (opts.manualTick) {
      // Manual mode: no auto-schedule — ticks are driven by /api/test/advance,
      // so a spec controls time deterministically (never races the 4s loop).
      _devGameLoops.set(gameId, { stateManager, callbacks })
    } else {
      startGameLoop(gameId, stateManager, callbacks, managedRuntime, redis, { players })
    }
    gameLog.info('Dev game created', {
      gameId,
      humanId: opts.humanId,
      scenario: opts.scenario ?? 'fresh',
      manualTick: !!opts.manualTick,
      mode: opts.mode ?? 'normal',
      mapId: opts.mapId ?? 'default_5v5',
    })
    return { gameId }
  }

  _advanceDevGame = async (gameId, ticks) => {
    const g = _devGameLoops.get(gameId)
    if (!g) return 0
    const n = Math.max(0, Math.min(200, Math.floor(ticks)))
    for (let i = 0; i < n; i++) {
      await runOneTick(gameId, g.stateManager, g.callbacks, managedRuntime)
    }
    return n
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
    _createDevGame = null
    _advanceDevGame = null
    _devGameLoops.clear()
    gameLog.info('Game server shut down')
  })
})
