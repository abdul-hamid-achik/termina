import { Effect, Layer, ManagedRuntime } from 'effect'
import { testHooksEnabled, isRealProduction } from '~~/server/utils/testHooks'
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
  type GameCallbacks,
  type PlayerFarm,
} from '~~/server/game/engine/GameLoop'
import { playerNetWorth } from '~~/server/game/engine/ScripDistributor'
import { shouldApplyDerivedMatchStats } from '~~/server/game/engine/matchPersistence'
import {
  deleteSnapshot,
  readSnapshot,
  listSnapshotGameIds,
  type SnapshotMeta,
} from '~~/server/game/engine/StateSnapshot'
import { flushFinalSnapshots } from '~~/server/game/engine/gracefulShutdown'
import { toGameEvent, type GameEngineEvent } from '~~/server/game/protocol/events'
import {
  calculateVision,
  filterStateForPlayer,
  filterStateForSpectator,
} from '~~/server/game/engine/VisionCalculator'
import { recordSentState, clearSentState } from '~~/server/game/engine/StateDelta'
import { getSpectatorsOfGame, clearGameSpectators } from '~~/server/services/SpectatorRegistry'
import { clearClientInput } from '~~/server/services/LeaverSystem'
import { clearRejectionEscalation } from '~~/server/game/engine/rejectionEscalation'
import type { TeamId, GameState, GameMode } from '~~/shared/types/game'
import type { PlayerEndStats, ServerMessage } from '~~/shared/types/protocol'
import type { NewMatch, NewMatchPlayer } from '~~/server/db/schema'
import {
  isBot,
  registerBots,
  cleanupGame,
  difficultyForMmr,
  type BotDifficulty,
  type RegisterBotsOptions,
} from '~~/server/game/ai/BotManager'
import { ONE_LANE_MAP_ID, TWO_LANE_MAP_ID, mapIdForMode } from '~~/shared/constants/maps'
import { buildTutorialRoster } from '~~/server/game/modes/tutorial'
import {
  sendToPeer,
  setPlayerGame,
  clearPlayerGame,
  getPlayerGame,
  getGamePlayers,
} from '~~/server/services/PeerRegistry'
import { cleanupLobby } from '~~/server/game/matchmaking/lobby'
import { calculateMmrChange, applyMmrChange, teamAverageMmr } from '~~/server/game/matchmaking/elo'
import { HEROES } from '~~/shared/constants/heroes'
import { registerAllHeroes } from '~~/server/game/heroes'

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
    case 'ice_kill':
    case 'tenant_killed':
    case 'level_up':
      return true
  }
  // Check per-event visibility
  switch (event._tag) {
    // status_applied carries the same sourceId/targetId shape as damage and
    // exposes the same information (who did what to whom, where), so it must
    // obey the same fog rule. Without a case it fell to `default: return true`
    // and announced every disable in the match to all ten players — including
    // ones whose causing `ability_used` was correctly hidden.
    case 'status_applied':
    case 'damage':
    case 'heal': {
      if (event.sourceId === playerId || event.targetId === playerId) return true
      if (state.players[event.sourceId]?.team === playerTeam) return true
      if (state.players[event.targetId]?.team === playerTeam) return true
      const srcZone = state.players[event.sourceId]?.zone
      const tgtZone = state.players[event.targetId]?.zone
      return !!(srcZone && visibleZones.has(srcZone)) || !!(tgtZone && visibleZones.has(tgtZone))
    }
    case 'wave_strip':
    case 'scrip_change':
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
    case 'cache_picked':
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
      // An enemy farming the silt only shows if you can see that camp —
      // otherwise it leaks where they are.
      return visibleZones.has(event.zone)
    case 'talent_selected':
    case 'power_spike':
      // Enemy build/power-spike info is team-private — you learn an enemy spiked
      // by scouting them, not from a broadcast (publicly warning about a spike
      // you have no vision on is a fog leak in disguise). Own + allied spikes
      // stay visible (clarity carve-out); genuinely global events (Backup) are
      // handled by their own always-visible cases.
      if (event.playerId === playerId) return true
      return state.players[event.playerId]?.team === playerTeam
    default:
      return true
  }
}

/**
 * Is this a throwaway practice game whose result must NOT be persisted?
 *
 * Tutorial games now END on graduation and are surrenderable from cycle 0, so
 * they reach onGameOver routinely — including for a player who issued no
 * commands at all, since the tutorial step deadlines carry the flow on their
 * own. Persisting those would write a bogus match row and credit a free win to
 * players.wins + hero_stats, inflating the win rate on the profile and
 * /api/player/stats. Practice is not a result.
 *
 * Both checks matter: `mode` covers a tutorial started through any path, and the
 * `dev_` id prefix covers a practice game whose final state could not be read.
 */
export function isPracticeGame(gameId: string, mode?: GameMode): boolean {
  return mode === 'tutorial' || gameId.startsWith('dev_')
}

/**
 * Deliver a game's message to a player only while they are still assigned to
 * THAT game.
 *
 * Every game callback below routes purely by playerId, and nothing in the
 * client-facing protocol carries a gameId — `cycle_state`, `announcement` and
 * `game_over` are all indistinguishable between matches once they arrive. An
 * abandoned game is not a hypothetical: a practice match keeps ticking with zero
 * input and reaches its own game-over minutes later (the tutorial step deadlines
 * carry the flow), by which time the player may be in a real match. Routing by
 * playerId alone flooded that live match with a second game's board and ended it
 * with a foreign scoreboard.
 */
export function sendToGamePeer(gameId: string, playerId: string, message: ServerMessage): void {
  if (getPlayerGame(playerId) !== gameId) return
  sendToPeer(playerId, message)
}

/**
 * The end-of-game scoreboard payload. Uses the shared client-facing type so TS
 * enforces that the server's game_over matches what the post-game screen reads —
 * no silent drift.
 *
 * `farm` arrives from the loop rather than being read back out of it: the loop
 * interrupts as soon as onGameOver returns and drops its per-game maps.
 */
export function buildEndStats(
  playerIds: string[],
  finalState: GameState,
  farm: Record<string, PlayerFarm>,
): Record<string, PlayerEndStats> {
  const endStats: Record<string, PlayerEndStats> = {}
  for (const playerId of playerIds) {
    const ps = finalState.players[playerId]
    endStats[playerId] = {
      kills: ps?.kills ?? 0,
      deaths: ps?.deaths ?? 0,
      assists: ps?.assists ?? 0,
      scrip: ps?.scrip ?? 0,
      items: ps?.items ?? [],
      heroDamage: ps?.damageDealt ?? 0,
      iceDamage: ps?.iceDamageDealt ?? 0,
      lastHits: farm[playerId]?.lastHits ?? 0,
      burns: farm[playerId]?.burns ?? 0,
      // Gold spent on items is still scrip farmed. Ranking the board by the
      // wallet balance puts the best farmer last, which is the opposite of the
      // lesson the screen is supposed to teach.
      netWorth: ps ? playerNetWorth(ps) : 0,
      level: ps?.level ?? 1,
    }
  }
  return endStats
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
  /** Wall-clock ms of the last cycle broadcast — used by the reaper to detect
   *  zombie games whose loop died without firing onGameOver. */
  lastCycleAt: number
  /** Snapshot meta captured at game start — lets the shutdown hook flush a
   *  faithful final snapshot (the resume path requires meta.players). */
  meta?: SnapshotMeta
}

const liveGames = new Map<string, LiveGameEntry>()

function registerLiveGame(
  gameId: string,
  stateManager: ReturnType<typeof createInMemoryStateManager>,
): void {
  liveGames.set(gameId, { stateManager, recentEvents: [], lastCycleAt: Date.now() })
}

/** Stash the snapshot meta on the live-game entry so the shutdown hook can
 *  flush a faithful final snapshot (resume requires meta.players). */
function setLiveGameMeta(gameId: string, meta: SnapshotMeta): void {
  const entry = liveGames.get(gameId)
  if (entry) entry.meta = meta
}

function recordRecentEvents(gameId: string, events: GameEngineEvent[]): void {
  const entry = liveGames.get(gameId)
  if (!entry) return
  entry.recentEvents.push(...events)
  if (entry.recentEvents.length > RECENT_EVENTS_CAP) {
    entry.recentEvents.splice(0, entry.recentEvents.length - RECENT_EVENTS_CAP)
  }
  entry.lastCycleAt = Date.now()
}

/** Update the lastCycleAt timestamp for a live game. Called from onCycleState
 *  so the reaper doesn't incorrectly kill a game whose ticks produce no events
 *  (both teams AFK in fountain — the loop is alive but onEvents is a no-op). */
function touchLiveGame(gameId: string): void {
  const entry = liveGames.get(gameId)
  if (!entry) return
  entry.lastCycleAt = Date.now()
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
  cycle: number
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

  const filteredState = filterStateForPlayer(state, playerId, gameId)
  // Reconnect sends full state — record it so the next cycle's delta is relative
  // to this snapshot (not stale from before the disconnect).
  recordSentState(gameId, playerId, filteredState)
  const playerTeam = state.players[playerId]?.team
  const visibleZones = calculateVision(state, playerId, gameId)
  const missed = entry.recentEvents.filter(
    (e) =>
      (sinceTick === undefined || e.cycle > sinceTick) &&
      isEventVisibleToPlayer(e, playerId, playerTeam, visibleZones, state),
  )

  return { cycle: state.cycle, state: filteredState, events: missed.map(toGameEvent) }
}

export function getGameRuntime(): GameRuntime | null {
  return _runtime
}

/**
 * Test-only hook: force a live game to end with the given winner.
 *
 * Sets the game's phase to 'ended' + winner via its state manager (mirroring
 * how this plugin already drives `updateState`). The running GameLoop fiber
 * picks this up on its next cycle — its win-condition block (GameLoop.ts ~282)
 * sees `phase === 'ended'` with a winner and fires `callbacks.onGameOver`,
 * which persists the match and broadcasts `game_over` to clients. So forcing
 * the state ends the game cleanly, exactly as a Terminal kill would.
 *
 * Returns false if no such live game exists (e.g. on another instance, or
 * already ended). HARD no-op in production — never end real matches.
 *
 * Currently has no production caller (its /api/test/force-end route was removed);
 * kept as a tested admin/test primitive, guarded by isRealProduction() so it can
 * never end a real match even if a future caller is added.
 */
export function forceEndGame(gameId: string, winner: TeamId): boolean {
  if (isRealProduction()) return false

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

// ── Tutorial game support ─────────────────────────────────────
// Build a REAL game directly, bypassing matchmaking, so the single-player
// tutorial can drop a human into a guided bot match. Wired from inside the plugin
// (it shares the same services + buildCallbacks as the matchmaking path);
// `createTutorialGame` is the only entry point. (The dev/e2e `/api/test/*` seed
// routes that also drove this were removed — e2e drives the real app now.)

/**
 * Bot difficulty for a matchmade game, from the HUMAN players' average MMR (bots
 * inherit that average as their own, so counting them would just dilute it).
 * Every production game used to register bots at registerBots' hardcoded
 * 'medium' default, which is what made `hard` and `unfair` dead config.
 * An all-bot roster falls back to the default seed MMR.
 */
export function botDifficultyForRoster(
  players: { playerId: string; mmr: number }[],
): BotDifficulty {
  const humanMmrs = players.filter((p) => !isBot(p.playerId)).map((p) => p.mmr)
  const averageMmr = humanMmrs.length
    ? humanMmrs.reduce((sum, m) => sum + m, 0) / humanMmrs.length
    : 1000
  return difficultyForMmr(averageMmr)
}

interface DevGameOpts {
  /** The authenticated session user — becomes the human player. */
  humanId: string
  humanHeroId?: string
  /** Map to run on (default full 5v5). 'one_lane' forces bots to the mid lane. */
  mapId?: string
  /** Game mode (default 'normal'). 'tutorial' uses the small guided roster. */
  mode?: GameMode
  /** Bot difficulty. Defaults to 'easy' in tutorial mode, 'medium' otherwise. */
  difficulty?: BotDifficulty
}

let _createDevGame: ((opts: DevGameOpts) => Promise<{ gameId: string } | null>) | null = null

/**
 * Create a single-player tutorial game — the human plus bots on the one-lane map,
 * in tutorial mode. A real player feature, reachable in production; returns null
 * before the game server has finished starting.
 */
export async function createTutorialGame(opts: {
  humanId: string
  humanHeroId?: string
  difficulty?: BotDifficulty
}): Promise<{ gameId: string } | null> {
  return _createDevGame
    ? _createDevGame({
        humanId: opts.humanId,
        humanHeroId: opts.humanHeroId,
        mapId: 'one_lane',
        mode: 'tutorial',
        difficulty: opts.difficulty,
      })
    : null
}

/**
 * Stop + drop a tutorial/dev game so it stops ticking. Called from the WS close
 * handler when a `dev_` game's player disconnects with no reconnect, so the loop
 * doesn't run forever after the human leaves. Only touches `dev_` games.
 */
export function stopDevGame(gameId: string): void {
  if (!gameId.startsWith('dev_')) return
  // Release the player→game assignments, mirroring onGameOver and the reaper.
  // Dropping the liveGames entry without this leaves the player mapped to a game
  // that no longer exists anywhere: `reconnect` passes the ownership check,
  // getReconnectPayload finds nothing to send, and the HUD sits frozen on a board
  // that will never cycle again — with no way out, since queue/join and
  // tutorial.post both read the same assignment. gamePlayers is the reverse index
  // of exactly "still assigned to this game", so a player who has already moved
  // to another match is not touched.
  for (const pid of getGamePlayers(gameId)) {
    clearPlayerGame(pid)
    clearSentState(gameId, pid)
  }
  liveGames.delete(gameId)
  cleanupGame(gameId)
  clearRejectionEscalation(gameId)
  clearClientInput(gameId)
  // Interrupt the running loop fiber (no-op if already stopped, or if the
  // runtime never came up — the bookkeeping above still has to happen).
  void _runtime?.managedRuntime.runPromise(stopGameLoop(gameId)).catch(() => {})
}

// ── Production liveGames reaper ──────────────────────────────────
// A game whose loop dies without firing onGameOver (fiber crash, terminal
// never dies, bug) leaks forever in liveGames + recentEvents + bot combo
// states. The dev reaper only touches dev_* games. This sweep runs every 60s
// and force-cleans entries whose lastCycleAt is stale beyond a grace window.
const LIVE_GAME_STALE_MS = 120_000 // 2 min with no cycle → presumed dead
let _liveGameReaperTimer: ReturnType<typeof setInterval> | null = null

function reapStaleLiveGames(): void {
  const now = Date.now()
  for (const [gameId, entry] of liveGames) {
    // Dev games are handled by the dev reaper above.
    if (gameId.startsWith('dev_')) continue
    if (now - entry.lastCycleAt < LIVE_GAME_STALE_MS) continue
    gameLog.warn('Reaping stale live game (no cycle for >2min)', {
      gameId,
      staleMs: now - entry.lastCycleAt,
    })
    // Best-effort: read the state, mark it ended, clean up. The loop fiber is
    // already presumed dead so there's nothing to interrupt.
    try {
      const state = Effect.runSync(entry.stateManager.getState(gameId))
      if (state.phase !== 'ended') {
        Effect.runSync(
          entry.stateManager.updateState(gameId, () => ({ ...state, phase: 'ended' as const })),
        )
      }
      // Release the player→game assignments too (mirrors onGameOver) —
      // otherwise still-connected clients of the dead game keep passing the
      // "still assigned" guards (e.g. the WS presence stamp) forever. Scoped to
      // players still mapped HERE: a zombie game reaped long after its players
      // moved on must not evict them from the match they are in now.
      for (const pid of Object.keys(state.players)) {
        if (getPlayerGame(pid) === gameId) clearPlayerGame(pid)
        clearSentState(gameId, pid)
      }
    } catch {
      // State manager itself is broken — just drop the entry.
    }
    cleanupGame(gameId)
    clearRejectionEscalation(gameId)
    clearClientInput(gameId)
    liveGames.delete(gameId)
  }
}

export default defineNitroPlugin(async (nitroApp) => {
  // During the build-time prerender pass, Nitro boots the server in-process to
  // SSR the prerendered routes (/terms, /privacy). The game server must NOT run
  // then: it would connect to Redis/Postgres, and with the resilient ioredis
  // retry strategy a missing service (as in CI, where the build job has no
  // database) retries forever — the `await managedRuntime.runPromise` below
  // never resolves and the build hangs. Prerendering only needs the HTTP/SSR
  // layer, so skip the entire game-loop/Redis/DB bring-up here.
  if (import.meta.prerender) return

  // Populate the hero ability/passive registry up front. Each hero module also
  // self-registers on import, but the production bundle tree-shook those
  // side-effect-only imports (see server/game/heroes/index.ts) — leaving an empty
  // registry so every cast failed with "No resolver registered". Calling this
  // from the plugin entry point pins the whole hero chain into the build.
  registerAllHeroes()

  // Loud, unmissable warning if the test-only relaxations are enabled. The gate is
  // the explicit TERMINA_TEST_HOOKS=1 opt-in alone (the prod e2e runs against a
  // production build, so NODE_ENV can't gate it). It enables no endpoints — the
  // /api/test/* seed routes were removed — but it DOES relax the auth rate limit
  // (with TERMINA_DISABLE_RATE_LIMIT) and the cycle accelerator, so it must NEVER
  // be set in a real deployment.
  if (testHooksEnabled()) {
    gameLog.warn(
      '\n⚠️  TERMINA_TEST_HOOKS=1 — test-only relaxations are ENABLED.\n' +
        '   Auth rate-limit escape hatch + fast-game accelerator + DevTools off.\n' +
        '   NEVER set this in production.\n',
    )
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

  const { startMatchmakingLoop } = await import('~~/server/game/matchmaking/queue')
  const matchmakingInterval = startMatchmakingLoop(redis, ws, db)

  // Start the production liveGames reaper — sweeps zombie games whose loop
  // died without firing onGameOver. Unref so it doesn't keep the process alive.
  if (!_liveGameReaperTimer) {
    _liveGameReaperTimer = setInterval(reapStaleLiveGames, 60_000)
    ;(_liveGameReaperTimer as { unref?: () => void }).unref?.()
  }

  // Keep-alive timer: prevent the Node process from exiting during a Redis
  // reconnect window. ioredis auto-reconnects, but while the connection is
  // down the event loop may have no active tasks (if no games are running),
  // causing Node to exit and the Nitro close hook to fire. This 10s interval
  // keeps the event loop alive until Redis reconnects. NOT unref'd — it's
  // cleared on genuine shutdown via the Nitro close hook.
  const _keepAliveTimer = setInterval(() => {}, 10_000)

  // Build the callbacks for a single game. Captured separately from the
  // game_ready handler so the snapshot-resume path can use the same shape.
  type StartPlayer = { playerId: string; team: TeamId; heroId: string; mmr: number }
  function buildCallbacks(
    players: StartPlayer[],
    stateManager: ReturnType<typeof createInMemoryStateManager>,
  ): GameCallbacks {
    return {
      onCycleState: (gId, playerId, filteredState) => {
        // Update lastCycleAt on every cycle (not just on events) so the reaper
        // doesn't kill a live game that happens to produce no events for a while.
        touchLiveGame(gId)
        if (isBot(playerId)) return
        sendToGamePeer(gId, playerId, {
          type: 'cycle_state',
          cycle: filteredState.cycle,
          state: filteredState,
        })
      },

      onSpectatorTick: (gId, fullState) => {
        const watchers = getSpectatorsOfGame(gId)
        if (watchers.length === 0) return
        const fogless = filterStateForSpectator(fullState)
        const payload = JSON.stringify({
          type: 'spectator_tick',
          cycle: fogless.cycle,
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

      onActionRejected: (gId, playerId, reason) => {
        if (isBot(playerId)) return
        sendToGamePeer(gId, playerId, {
          type: 'announcement',
          message: reason,
          level: 'warning',
        })
      },

      onNotice: (gId, playerId, message) => {
        if (isBot(playerId)) return
        sendToGamePeer(gId, playerId, { type: 'announcement', message, level: 'info' })
      },

      onTutorialCompleted: (_gId, playerId) => {
        if (isBot(playerId)) return
        // Persist best-effort: a DB hiccup must never block the game loop. The
        // client funnel degrades gracefully if this never lands (it just keeps
        // offering practice).
        managedRuntime.runPromise(db.markTutorialCompleted(playerId)).catch((err) =>
          gameLog.warn('Failed to persist tutorial completion', {
            playerId,
            error: String(err),
          }),
        )
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
            const visibleZones = calculateVision(state, p.playerId, gId)
            const playerTeam = state.players[p.playerId]?.team
            const visibleEvents = events.filter((e) =>
              isEventVisibleToPlayer(e, p.playerId, playerTeam, visibleZones, state!),
            )
            if (visibleEvents.length > 0) {
              sendToGamePeer(gId, p.playerId, {
                type: 'events' as const,
                cycle: visibleEvents[0]?.cycle ?? 0,
                events: visibleEvents.map(toGameEvent),
              })
            }
          } else {
            sendToGamePeer(gId, p.playerId, {
              type: 'events' as const,
              cycle: events[0]?.cycle ?? 0,
              events: events.map(toGameEvent),
            })
          }
        }
      },

      onGameOver: async (gId, winner, farm) => {
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
        // A match only affects MMR if it contained NO bots. Bot-filled matchmaking
        // and practice games are recorded for history but are NOT ranked — otherwise
        // the leaderboard (ordered by MMR) could be grinded against bots.
        const hasBots = players.some((p) => isBot(p.playerId))
        const isRanked = !hasBots

        // Build the end-of-game stats (no DB needed) and broadcast game_over
        // FIRST. Players must reach the post-game screen even if DB persistence
        // fails — a database hiccup must never strand everyone in a dead game.
        const endStats = buildEndStats(
          players.map((p) => p.playerId),
          finalState,
          farm,
        )

        // Elo change per real player vs the enemy team's average MMR. Computed
        // BEFORE the broadcast so each player sees their own change on the
        // post-game screen; reused for the DB persistence below. Skipped entirely
        // for unranked (bot) games — those report a 0 change and never touch MMR.
        const mmrChanges = new Map<string, number>()
        if (isRanked) {
          for (const p of realPlayers) {
            const enemyAvg = teamAverageMmr(
              players.filter((e) => e.team !== p.team).map((e) => e.mmr),
            )
            mmrChanges.set(p.playerId, calculateMmrChange(p.mmr, enemyAvg, p.team === winner))
          }
        }

        // Scoped to this game (see sendToGamePeer): a late-finishing abandoned
        // match must not shove a stale post-game screen over the live one.
        for (const p of realPlayers) {
          sendToGamePeer(gId, p.playerId, {
            type: 'game_over',
            winner,
            stats: endStats,
            mmrChange: mmrChanges.get(p.playerId) ?? 0,
            ranked: isRanked,
            durationCycles: finalState.cycle,
          })
        }

        const practice = isPracticeGame(gId, finalState.mode)

        // Persist the match + MMR separately — failure is logged but never
        // blocks the broadcast above or the cleanup below.
        if (!practice) {
          try {
            // Label the match by its format. Bot games are 'casual_5v5' (unranked);
            // human games are labelled by team size (this also fixes the old
            // hardcoded 'ranked_5v5' that mislabeled 3v3/1v1 history).
            const teamSize = players.filter((p) => p.team === 'chaff').length
            const matchMode: NewMatch['mode'] = hasBots
              ? 'casual_5v5'
              : teamSize <= 1
                ? '1v1'
                : teamSize <= 3
                  ? 'quick_3v3'
                  : 'ranked_5v5'
            // Tag the match with the active season (creates Season 1 on first use).
            const season = await managedRuntime.runPromise(db.getCurrentSeason())
            const matchRecord: NewMatch = {
              id: gId,
              mode: matchMode,
              winner,
              durationCycles: finalState.cycle,
              seasonNumber: season.seasonNumber,
              endedAt: new Date(),
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
                goldEarned: ps?.scrip ?? 0,
                damageDealt: ps?.damageDealt ?? 0,
                healingDone: 0,
                finalItems: (ps?.items ?? []).filter((i): i is string => i !== null),
                finalLevel: ps?.level ?? 1,
                mmrChange,
              }
            })

            await managedRuntime.runPromise(
              Effect.gen(function* () {
                const matchPersisted = yield* db.recordMatch(matchRecord, matchPlayerRecords)
                if (!shouldApplyDerivedMatchStats(matchPersisted)) {
                  gameLog.error('Match was not persisted; skipping derived stats', { gameId: gId })
                  return
                }

                for (const p of realPlayers) {
                  const isWinner = p.team === winner
                  const ps = finalState.players[p.playerId]

                  // MMR only moves for ranked (no-bot) games — bot games record
                  // history/stats but leave the competitive ladder untouched.
                  if (isRanked) {
                    const mmrChange = mmrChanges.get(p.playerId) ?? 0
                    const newMmr = applyMmrChange(p.mmr, mmrChange)
                    yield* db.updatePlayerMMR(p.playerId, newMmr)
                    // Mirror the change onto the seasonal ladder + seasonal W/L.
                    yield* db.applySeasonMmrChange(p.playerId, mmrChange)
                    yield* db.incrementSeasonGamesPlayed(p.playerId)
                    if (isWinner) {
                      yield* db.incrementSeasonWins(p.playerId)
                    }
                  }
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
        }

        // Cleanup always runs, regardless of persistence outcome. The
        // player->game unmapping is conditional for the same reason as the
        // broadcast above: a late-finishing abandoned game must not evict the
        // player from the game they are actually in now (which would stop
        // presence being stamped, hand their hero to the AFK bot takeover, and
        // make every reconnect answer NOT_ASSIGNED).
        for (const p of realPlayers) {
          if (getPlayerGame(p.playerId) === gId) clearPlayerGame(p.playerId)
          clearSentState(gId, p.playerId)
        }
        cleanupGame(gId)
        clearRejectionEscalation(gId)
        clearClientInput(gId)
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
          mode?: string
          mapId?: string
          players: { playerId: string; team: TeamId; heroId: string; mmr: number }[]
        }

        const gameId = `game_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        // The lobby stamps the queue mode + derived mapId onto game_ready. The
        // mapId drives which zone set the game uses (5v5 → 3 lanes, 3v3 → 2,
        // 1v1 → 1); fall back to deriving it from mode, then to the full map.
        const mapId = gameData.mapId ?? mapIdForMode(gameData.mode) ?? 'default_5v5'
        gameLog.info('game_ready received', {
          lobbyId: gameData.lobbyId,
          playerCount: gameData.players.length,
          mode: gameData.mode ?? 'ranked_5v5',
          mapId,
        })

        // Create a standalone state manager for this game
        const stateManager = createInMemoryStateManager()
        registerLiveGame(gameId, stateManager)

        // Resolve guild tags for in-game display (humans only — bots have none).
        // Best-effort: a DB hiccup just leaves tags undefined, never blocks the game.
        const humanIds = gameData.players.filter((p) => !isBot(p.playerId)).map((p) => p.playerId)
        const guildTags = await managedRuntime
          .runPromise(db.getGuildTagsForPlayers(humanIds))
          .catch(() => ({}) as Record<string, string>)

        // Create player setups
        const playerSetups = gameData.players.map((p) => ({
          id: p.playerId,
          name: p.playerId,
          team: p.team,
          heroId: p.heroId,
          guildTag: guildTags[p.playerId],
        }))

        // Initialise game state in a single Effect pipeline
        await managedRuntime.runPromise(
          Effect.gen(function* () {
            yield* stateManager.createGame(gameId, playerSetups, { mapId })
            yield* stateManager.updateState(gameId, (s) => ({ ...s, phase: 'playing' as const }))
          }),
        )

        // Register bots for this game (lane assignment, tracking). On a subset
        // map the role lanes (top/bot/jungle) may not exist; pin bots to the
        // lanes that do (mid-only for one-lane, top/mid for two-lane) so their
        // global-graph pathing can't walk them off the map.
        const botOpts: RegisterBotsOptions = {
          difficulty: botDifficultyForRoster(gameData.players),
        }
        if (mapId === ONE_LANE_MAP_ID) {
          botOpts.forceLane = 'coldstore'
        } else if (mapId === TWO_LANE_MAP_ID) {
          // 3v3 two-lane map: top + mid only, no bot lane to path into.
          botOpts.availableLanes = ['seawall', 'coldstore']
        }
        registerBots(
          gameId,
          gameData.players.map((p) => ({ playerId: p.playerId, team: p.team, heroId: p.heroId })),
          botOpts,
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
        // before the first cycle tries to send data
        await managedRuntime.runPromise(Effect.sleep('2 seconds'))

        // Start the game loop as a fiber within the managed runtime.
        // The snapshot meta lets the resume path rebuild the same callbacks
        // after a process restart.
        const snapshotMeta: SnapshotMeta = {
          players: gameData.players,
          mapId,
          // Queue modes (ranked_5v5, quick_3v3, 1v1) are not GameMode values;
          // the state itself uses normal/tutorial while mapId carries the map
          // variant. Never persist the queue label as a replay mode.
          mode: gameData.mode === 'tutorial' ? 'tutorial' : 'normal',
        }
        startGameLoop(gameId, stateManager, callbacks, managedRuntime, redis, snapshotMeta)
        setLiveGameMeta(gameId, snapshotMeta)
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
    const seed = Date.now()
    const gameId = `dev_${seed}_${Math.random().toString(36).slice(2, 6)}`

    // Roster. Tutorial = a small guided 2v2 on the one-lane map; otherwise the
    // human (chaff) + 4 chaff bots + 5 audit bots, all distinct heroes.
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
      players = [{ playerId: opts.humanId, team: 'chaff', heroId: humanHero, mmr: 1000 }]
      for (let i = 0; i < 4; i++)
        players.push({
          playerId: `bot_r${i}_${gameId}`,
          team: 'chaff',
          heroId: nextHero(),
          mmr: 1000,
        })
      for (let i = 0; i < 5; i++)
        players.push({
          playerId: `bot_d${i}_${gameId}`,
          team: 'audit',
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
        yield* stateManager.updateState(gameId, (s) => ({ ...s, phase: 'playing' as const }))
      }),
    )
    registerBots(
      gameId,
      players
        .filter((p) => isBot(p.playerId))
        .map((p) => ({ playerId: p.playerId, team: p.team, heroId: p.heroId })),
      {
        // On a subset map the role lanes (top/bot/jungle) don't exist; pin bots to
        // mid so their global-graph pathing can't walk them off the map.
        forceLane: opts.mapId === 'one_lane' ? 'coldstore' : undefined,
        // Tutorial bots play gently by default — 'easy' lowers their cast rate and
        // last-hit accuracy, makes them retreat earlier and slower (reactionDelay),
        // and drops cache/silt/threat awareness — so a new player isn't punished
        // while learning the verbs. An explicit difficulty overrides it.
        difficulty: opts.difficulty ?? (opts.mode === 'tutorial' ? 'easy' : undefined),
      },
    )
    setPlayerGame(opts.humanId, gameId)
    const callbacks = buildCallbacks(players, stateManager)
    const snapshotMeta: SnapshotMeta = {
      players,
      mapId: opts.mapId,
      mode: opts.mode === 'tutorial' ? 'tutorial' : 'normal',
    }
    startGameLoop(gameId, stateManager, callbacks, managedRuntime, redis, snapshotMeta)
    setLiveGameMeta(gameId, snapshotMeta)
    gameLog.info('Dev game created', {
      gameId,
      humanId: opts.humanId,
      mode: opts.mode ?? 'normal',
      mapId: opts.mapId ?? 'default_5v5',
    })
    return { gameId }
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
      const snapshotMeta: SnapshotMeta = {
        players: snap.meta.players,
        mapId: snap.meta.mapId ?? snap.state.mapId,
        mode: snap.meta.mode ?? snap.state.mode,
      }
      startGameLoop(gameId, stateManager, callbacks, managedRuntime, redis, snapshotMeta)
      setLiveGameMeta(gameId, snapshotMeta)

      gameLog.info('Resumed game from snapshot', {
        gameId,
        cycle: snap.state.cycle,
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
    if (_liveGameReaperTimer) {
      clearInterval(_liveGameReaperTimer)
      _liveGameReaperTimer = null
    }
    clearInterval(_keepAliveTimer)

    // Graceful shutdown: flush a final snapshot for each live game + release its
    // Redis ownership so a rolling deploy (App Platform sends SIGTERM) resumes
    // games on the replacement instance with minimal cycle loss. Time-bounded +
    // best-effort so it can NEVER delay the SIGKILL grace window; on timeout or
    // any failure the periodic snapshot (≤60s old) remains the fallback — i.e. no
    // worse than before. Games without captured meta are skipped (resume requires
    // meta.players, so a meta-less snapshot would break resume). Runs before the
    // Redis connection is torn down below.
    if (liveGames.size > 0) {
      // Best-effort + time-bounded (see flushFinalSnapshots): a faithful final
      // snapshot per live game. Falls back to the ≤60s periodic snapshot on any
      // failure.
      await managedRuntime.runPromise(flushFinalSnapshots(liveGames, redis))
    }

    await managedRuntime.runPromise(redis.shutdown())
    await managedRuntime.runPromise(db.shutdown())
    await managedRuntime.dispose()
    _runtime = null
    _createDevGame = null
    gameLog.info('Game server shut down')
  })
})
