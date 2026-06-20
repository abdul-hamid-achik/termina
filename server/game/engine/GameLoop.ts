import type { ManagedRuntime } from 'effect'
import { Effect, Schedule, Fiber } from 'effect'
import type { GameEvent, GameState, TeamId } from '~~/shared/types/game'
import type { Command } from '~~/shared/types/commands'
import {
  TICK_DURATION_MS,
  RESPAWN_BASE_TICKS,
  RESPAWN_PER_LEVEL_TICKS,
  RESPAWN_FREE_LEVELS,
  FOUNTAIN_HEAL_PER_TICK_PERCENT,
  FOUNTAIN_MANA_PER_TICK_PERCENT,
  XP_PER_LEVEL,
  MAX_LEVEL,
  HERO_KILL_XP_BASE,
  HERO_KILL_XP_PER_LEVEL,
  ASSIST_XP_RATIO,
  POWER_SPIKE_LEVELS,
  IN_COMBAT_BUFF_DURATION,
  DAY_DURATION_TICKS,
  NIGHT_DURATION_TICKS,
  GLYPH_DURATION_TICKS,
} from '~~/shared/constants/balance'
import type { StateManagerApi } from './StateManager'
import { scaledTickIntervalMs, scaledRespawnTicks, fastGameFactor } from './fastGame'
import { resolveActions, validateAction, type PlayerAction } from './ActionResolver'
import { advanceTutorialAfterTick } from '~~/server/game/modes/tutorial'
import { distributePassiveGold, awardKill } from './GoldDistributor'
import { runCreepAI, applyCreepActions, enforceCreepZoneCap } from './CreepAI'
import { ensureAncients, updateAncientVulnerability, checkAncientWin } from './AncientSystem'
import { runTowerAI, applyTowerActions } from './TowerAI'
import { runRoshanAI, processRoshanDamage } from './RoshanAI'
import { removeExpiredRunes, processRuneBuffs } from './RuneAI'
import { processTraps } from './TrapSystem'
import { resolvePhysicalHit } from './CombatResolver'
import { spawnCreepWaves, spawnRunes } from '~~/server/game/map/spawner'
import { spawnNeutralCreeps, runNeutralAI, applyNeutralActions } from './NeutralAI'
import { removeExpiredWards } from '~~/server/game/map/zones'
import { filterStateForPlayer } from './VisionCalculator'
// Importing from '~~/server/game/heroes' (not '../heroes/_base') guarantees every hero's
// registerHero() side effect has run before the first tick resolves a cast.
import {
  levelUpHero,
  processDoTs,
  tickAllBuffs,
  resolvePassive,
  TALENT_TREES,
} from '~~/server/game/heroes'
import { toGameEvent, type GameEngineEvent } from '~~/server/game/protocol/events'
import { getBotPlayerIds, getBotLane } from '~~/server/game/ai/BotManager'
import { decideBotAction } from '~~/server/game/ai/BotAI'
import { engineLog } from '~~/server/utils/log'
import { calculateBuybackCost, buyback } from './BuybackSystem'
import { voteSurrender, removeSurrenderVote } from './SurrenderSystem'
import {
  markPlayerActiveSafe,
  detectAFKPlayers,
  recordLeaverSafe,
} from '~~/server/services/LeaverSystem'
import { writeSnapshot, SNAPSHOT_EVERY_N_TICKS, type SnapshotMeta } from './StateSnapshot'
import { appendActions } from './ActionLog'
import type { RedisServiceApi } from '~~/server/services/RedisService'

// ── Action queue per game ──────────────────────────────────────

/** Pending actions collected during the action window. */
const gameActionQueues = new Map<string, PlayerAction[]>()

// ── Assist tracking ────────────────────────────────────────────
// Kill/assist credit comes from actual damage dealt within a recent window,
// not just attack commands — so DoTs, abilities, and item procs count.

const ASSIST_WINDOW_TICKS = 5

/** gameId -> victimId -> attackerId -> tick of last damage dealt */
const recentHeroDamage = new Map<string, Map<string, Map<string, number>>>()

function trackHeroDamage(gameId: string, state: GameState, events: GameEngineEvent[]): void {
  let game = recentHeroDamage.get(gameId)
  if (!game) {
    game = new Map()
    recentHeroDamage.set(gameId, game)
  }
  for (const e of events) {
    if (e._tag !== 'damage') continue
    const src = state.players[e.sourceId]
    const tgt = state.players[e.targetId]
    if (!src || !tgt || src.team === tgt.team) continue
    let victimMap = game.get(e.targetId)
    if (!victimMap) {
      victimMap = new Map()
      game.set(e.targetId, victimMap)
    }
    victimMap.set(e.sourceId, state.tick)
  }
  // Prune contributions older than the window
  for (const [victimId, victimMap] of game) {
    for (const [attackerId, tick] of victimMap) {
      if (state.tick - tick > ASSIST_WINDOW_TICKS) victimMap.delete(attackerId)
    }
    if (victimMap.size === 0) game.delete(victimId)
  }
}

function getDamageContributors(gameId: string, victimId: string): string[] {
  return [...(recentHeroDamage.get(gameId)?.get(victimId)?.keys() ?? [])]
}

/** Submit an action for the current tick. */
export function submitAction(gameId: string, playerId: string, command: Command): void {
  let queue = gameActionQueues.get(gameId)
  if (!queue) {
    queue = []
    gameActionQueues.set(gameId, queue)
  }
  // Only one action per player per tick — second submissions overwrite the
  // first. Log the loss so it's observable instead of silent.
  const existing = queue.findIndex((a) => a.playerId === playerId)
  if (existing >= 0) {
    const dropped = queue[existing]!.command.type
    engineLog.debug('Action overwritten in same tick', {
      gameId,
      playerId,
      dropped,
      replacedWith: command.type,
    })
    queue[existing] = { playerId, command }
  } else {
    queue.push({ playerId, command })
  }
}

/** Drain all queued actions for a game. */
function drainActions(gameId: string): PlayerAction[] {
  const queue = gameActionQueues.get(gameId) ?? []
  gameActionQueues.set(gameId, [])
  return queue
}

// ── Tick processing ────────────────────────────────────────────

/**
 * Process a single game tick.
 * This is the core of the game loop extracted as a pure function for testability.
 */
export function processTick(
  gameId: string,
  state: GameState,
): Effect.Effect<{
  state: GameState
  events: GameEngineEvent[]
  rejectedActions: Array<{ playerId: string; reason: string }>
  /** All actions drained this tick — exposed so callers can persist them. */
  actions: PlayerAction[]
}> {
  return Effect.gen(function* () {
    // ensureAncients backfills `ancients` on states created before the
    // Ancient existed (resumed snapshots, older fixtures).
    let currentState: GameState = ensureAncients({ ...state, tick: state.tick + 1, events: [] })
    const allEvents: GameEngineEvent[] = []
    const rejectedActions: Array<{ playerId: string; reason: string }> = []

    // Zone snapshot for the passive hook's synthesized 'move' events (step
    // 11.5) — diffing covers normal moves AND resolver teleports, and
    // correctly excludes slow-cancelled moves.
    const preTickZones = new Map<string, string>()
    for (const [pid, p] of Object.entries(currentState.players)) {
      preTickZones.set(pid, p.zone)
    }

    // 0. Run bot AI — inject bot actions before draining
    const botPlayerIds = getBotPlayerIds(gameId)
    for (const botId of botPlayerIds) {
      const bot = currentState.players[botId]
      if (bot && bot.alive) {
        const command = decideBotAction(currentState, bot, getBotLane(gameId, botId), gameId)
        if (command) {
          submitAction(gameId, botId, command)
        }
      }
    }

    // 1. Collect all player actions from queue
    const actions = drainActions(gameId)

    // 1.2. Mark players as active when they take actions
    for (const action of actions) {
      markPlayerActiveSafe(gameId, action.playerId)
      const actor = currentState.players[action.playerId]
      if (actor) {
        currentState = {
          ...currentState,
          players: {
            ...currentState.players,
            [action.playerId]: { ...actor, lastActionTick: currentState.tick },
          },
        }
      }
    }

    // 1.5. Handle special commands (buyback, surrender, talent) before validation
    const specialResult = processSpecialActions(currentState, actions)
    currentState = specialResult.state
    allEvents.push(...specialResult.events)
    rejectedActions.push(...specialResult.rejectedActions)

    // 2. Validate actions against current state (filter out already-handled commands)
    const validActions: PlayerAction[] = []
    for (const action of actions) {
      if (action.command.type === 'buyback' || action.command.type === 'surrender') {
        continue // Already handled
      }
      const error = validateAction(currentState, action)
      if (error === null) {
        validActions.push(action)
      } else {
        rejectedActions.push({ playerId: action.playerId, reason: error })
      }
    }

    // 3. Resolve actions via ActionResolver
    const preTowers = currentState.towers
    const resolved = yield* resolveActions(currentState, validActions)
    currentState = resolved.state
    allEvents.push(...resolved.events)
    // Casts/moves that failed inside resolution (mana, bad target, slow)
    // reach onActionRejected player feedback through the same channel as
    // validation failures.
    rejectedActions.push(...resolved.rejected)

    // 3.4. Advance the tutorial if the human performed the verb this step
    // teaches (no-op in normal games). Uses validation-accepted actions minus
    // any the resolver then rejected, so a failed cast doesn't count.
    currentState = advanceTutorialAfterTick(currentState, validActions, resolved.rejected)

    // 3.5. Track tower kills and update team stats
    currentState = trackTowerKills(currentState, preTowers, allEvents)

    // 3.6. Apply inCombat buffs based on damage events
    currentState = applyInCombatBuffs(currentState, resolved.events)

    // 3.65. Detonate Socket traps on enemies now standing in trapped zones
    // (after movement resolved). Damage events feed kill/assist credit below.
    const trapResult = processTraps(currentState)
    currentState = trapResult.state
    allEvents.push(...trapResult.events)

    // 3.7. Expire glyph invulnerability
    currentState = expireGlyph(currentState)

    // 4–5.6. NPC AI (creeps, neutrals, towers, Roshan)
    const npcResult = runNPCAI(currentState, {
      heroAttackers: resolved.heroAttackers,
      priorEvents: allEvents,
    })
    currentState = npcResult.state
    allEvents.push(...npcResult.events)

    // 5.7. Recompute Ancient vulnerability after all tower damage this tick
    // (hero attacks in resolveActions + creep attacks in NPC AI).
    currentState = updateAncientVulnerability(currentState)

    // 6–7. Spawn waves / neutrals / runes; expire runes + wards
    currentState = runSpawning(currentState)

    // 8. Distribute passive gold
    currentState = distributePassiveGold(currentState)

    // 9. Handle respawns
    currentState = handleRespawns(currentState)

    // 10. Fountain healing
    currentState = applyFountainHealing(currentState)

    // 10.5. Process DoT damage — emitted damage events feed kill/assist
    // credit (trackHeroDamage below) and the passive hook's damage_taken.
    const dotResult = processDoTs(currentState)
    currentState = dotResult.state
    allEvents.push(...dotResult.events)

    // 10.6. Tick all buffs (decrement durations, remove expired)
    const eventsBeforeBuffTick = currentState.events.length
    currentState = tickAllBuffs(currentState)
    // tickAllBuffs authors teleport_complete as a wire-format event on
    // state.events, which the client never reads (updateFromTick ignores it).
    // Bridge those into the _tag/allEvents channel so a completed teleport
    // actually reaches the combat log — mirroring teleport_cancelled, which is
    // already authored as a _tag event in the resolver.
    for (const e of currentState.events.slice(eventsBeforeBuffTick)) {
      if (e.type !== 'teleport_complete') continue
      allEvents.push({
        _tag: 'teleport_complete',
        tick: e.tick,
        playerId: e.payload.playerId as string,
        destination: e.payload.destination as string,
        ...(e.payload.source ? { source: e.payload.source as 'return' | 'next_hop' } : {}),
      })
    }

    // 11. Handle deaths — check for newly dead players, attribute kills.
    // Damage dealt this tick (attacks, abilities, DoTs) feeds assist credit.
    trackHeroDamage(gameId, currentState, allEvents)
    currentState = handleDeaths(gameId, currentState, allEvents, resolved.heroAttackers)

    // 11.5. Hero passives — after handleDeaths (so kill events exist for
    // null_ref's Void Drain), before level ups. Actions rejected during
    // resolution don't trigger action-based passives.
    const succeededActions = validActions.filter(
      (a) => !resolved.rejected.some((r) => r.playerId === a.playerId),
    )
    currentState = runHeroPassives(currentState, succeededActions, allEvents, preTickZones)

    // 12. Check level ups
    currentState = checkLevelUps(currentState, allEvents)

    // 13. Check win condition (phase may already be 'ended' via surrender)
    const winner =
      currentState.phase === 'ended'
        ? (currentState.winner ?? null)
        : checkWinCondition(currentState)
    if (winner) {
      currentState = { ...currentState, phase: 'ended', winner }
      allEvents.push({
        _tag: 'gold_change',
        tick: currentState.tick,
        playerId: '',
        amount: 0,
        reason: `game_over:${winner}`,
      })
      yield* Effect.logInfo('Win condition met').pipe(Effect.annotateLogs({ gameId, winner }))
    }

    // 13.1. Test-mode progress monitor. Only when the fast-game hook is active
    // (dev/test, never production) and every 25 ticks, log how the game is
    // converging toward an Ancient kill — towers standing per team and Ancient
    // HP/vulnerability — so a watcher can see whether games end on time.
    if (fastGameFactor() > 1 && currentState.tick % 25 === 0) {
      const towersUp = (team: string) =>
        currentState.towers.filter((t) => t.team === team && t.alive).length
      const anc = currentState.ancients
      engineLog.info('📊 Game progress', {
        gameId,
        tick: currentState.tick,
        towers: `R${towersUp('radiant')}:D${towersUp('dire')}`,
        radiantAncient: `${anc?.radiant.hp ?? '?'}${anc?.radiant.vulnerable ? '!' : ''}`,
        direAncient: `${anc?.dire.hp ?? '?'}${anc?.dire.vulnerable ? '!' : ''}`,
        winner: winner ?? 'none',
      })
    }

    // 13.5. Progress day/night cycle
    const dayNight = progressDayNight(currentState)
    currentState = dayNight.state
    allEvents.push(...dayNight.events)

    // 14. Store events on state — merge instead of overwrite so wire-format
    // events pushed directly onto state during the tick (e.g. tickAllBuffs'
    // teleport_complete) aren't dropped.
    currentState = {
      ...currentState,
      events: [...currentState.events, ...allEvents.map(toGameEvent)],
    }

    yield* Effect.logDebug('Tick processed').pipe(
      Effect.annotateLogs({ gameId, tick: currentState.tick, actionCount: validActions.length }),
    )

    return { state: currentState, events: allEvents, rejectedActions, actions }
  })
}

// ── Game lifecycle ─────────────────────────────────────────────

export interface GameCallbacks {
  onTickState: (
    gameId: string,
    playerId: string,
    state: ReturnType<typeof filterStateForPlayer>,
  ) => void
  onEvents: (gameId: string, events: GameEngineEvent[]) => void
  onGameOver: (gameId: string, winner: TeamId) => void
  onActionRejected?: (gameId: string, playerId: string, reason: string) => void
  /**
   * Fires once per tick with the unfiltered (fogless) state. Optional —
   * implemented by the plugin to broadcast to spectators. Skipped if not set.
   */
  onSpectatorTick?: (gameId: string, state: GameState) => void
}

/** Active game fibers, keyed by gameId. */
const activeGames = new Map<string, Fiber.RuntimeFiber<void, never>>()

/**
 * Build the game loop Effect for a given game.
 * The returned Effect runs the tick loop directly (no forking) — it stays
 * alive for the entire game duration. The caller is responsible for
 * running it (typically via Effect.runFork for a root-level fiber).
 */
function buildGameLoop(
  gameId: string,
  stateManager: StateManagerApi,
  callbacks: GameCallbacks,
  redis?: RedisServiceApi,
  snapshotMeta?: SnapshotMeta,
): Effect.Effect<void> {
  // Run a single tick with per-tick error recovery so one bad tick
  // doesn't kill the entire game loop.
  const tickLoop = Effect.gen(function* () {
    const currentState = yield* stateManager.getState(gameId)
    if (currentState.phase === 'ended') {
      // The game can be ended out-of-band — the test-only force-end hook, or a
      // resumed already-finished snapshot — without processTick having fired
      // the game-over broadcast below. If a winner is set, fire onGameOver once
      // so the client receives game_over and renders the post-game screen, then
      // stop. (A normal in-tick end fires onGameOver at the bottom of this loop
      // and interrupts, so it never re-reaches this branch — no double fire.)
      const winner = currentState.winner ?? checkWinCondition(currentState)
      if (winner) {
        try {
          callbacks.onGameOver(gameId, winner)
        } catch (err) {
          engineLog.warn('onGameOver (out-of-band end) failed', { gameId, error: String(err) })
        }
      }
      return yield* Effect.interrupt
    }

    const {
      state: newState,
      events,
      rejectedActions,
      actions,
    } = yield* processTick(gameId, currentState)
    yield* stateManager.updateState(gameId, () => newState)

    // Persist this tick's actions for replay/debugging. Forked so a slow
    // Redis write never blocks the broadcast.
    if (redis && actions.length > 0) {
      yield* Effect.forkDaemon(
        appendActions(
          redis,
          gameId,
          actions.map((a) => ({ tick: newState.tick, playerId: a.playerId, command: a.command })),
        ),
      )
    }

    // Send feedback for rejected player actions
    if (callbacks.onActionRejected) {
      for (const rejected of rejectedActions) {
        try {
          callbacks.onActionRejected(gameId, rejected.playerId, rejected.reason)
        } catch {
          // Non-critical — don't let feedback failures affect the game loop
        }
      }
    }

    // Log every 10th tick to verify loop is alive
    if (newState.tick % 10 === 0) {
      engineLog.debug('Tick', { gameId, tick: newState.tick })
    }

    // Check for AFK players every 60 ticks and record leavers
    if (newState.tick % 60 === 0) {
      const afkPlayers = detectAFKPlayers(newState)
      for (const afk of afkPlayers) {
        recordLeaverSafe(afk.playerId, gameId, newState, 'afk', redis)
        engineLog.warn('AFK player detected', {
          gameId,
          playerId: afk.playerId,
          ticksAFK: afk.ticksAFK,
        })
      }
    }

    // Periodic state snapshot (best-effort; failures don't break the loop).
    // Forked so a slow Redis write doesn't block tick broadcast.
    if (redis && newState.tick % SNAPSHOT_EVERY_N_TICKS === 0) {
      yield* Effect.forkDaemon(writeSnapshot(redis, gameId, newState, snapshotMeta))
    }

    // Broadcast filtered state to each player
    for (const playerId of Object.keys(newState.players)) {
      const visibleState = filterStateForPlayer(newState, playerId)
      try {
        callbacks.onTickState(gameId, playerId, visibleState)
      } catch (err) {
        engineLog.warn('Failed to send tick_state', { gameId, playerId, error: String(err) })
      }
    }

    // Spectator tick — fogless full state. Fired once regardless of how many
    // spectators are watching; the plugin fans out to each one.
    if (callbacks.onSpectatorTick) {
      try {
        callbacks.onSpectatorTick(gameId, newState)
      } catch (err) {
        engineLog.warn('Failed to broadcast spectator_tick', { gameId, error: String(err) })
      }
    }

    if (events.length > 0) {
      callbacks.onEvents(gameId, events)
    }

    // Check win — phase is set to 'ended' by processTick (towers or surrender)
    if (newState.phase === 'ended') {
      const winner = newState.winner ?? checkWinCondition(newState)
      if (winner) callbacks.onGameOver(gameId, winner)
      return yield* Effect.interrupt
    }
  }).pipe(
    // Recover from individual tick failures so the loop keeps running
    Effect.catchAll((error) => {
      engineLog.error('Tick error (recovering)', { gameId, error: String(error) })
      return Effect.void
    }),
  )

  // scaledTickIntervalMs is a no-op (returns TICK_DURATION_MS) unless the
  // dev/test-only TERMINA_TEST_FAST_GAME accelerator is active — fastGame.ts.
  const tickIntervalMs = scaledTickIntervalMs(TICK_DURATION_MS)
  return Effect.gen(function* () {
    yield* stateManager.updateState(gameId, (s) => ({ ...s, phase: 'playing' as const }))
    engineLog.info('Game loop starting', { gameId, tickIntervalMs })
    yield* Effect.repeat(tickLoop, Schedule.fixed(`${tickIntervalMs} millis`))
  }).pipe(
    Effect.catchAll((error) => {
      engineLog.error('Game loop fatal error', { gameId, error: String(error) })
      return Effect.void
    }),
    // Guarantee per-game maps are cleaned up no matter how the loop ends
    // (natural win, crash, interrupt). Without this, gameActionQueues leaks
    // entries for any game that ends without an explicit stopGameLoop call.
    Effect.ensuring(
      Effect.sync(() => {
        gameActionQueues.delete(gameId)
        activeGames.delete(gameId)
        recentHeroDamage.delete(gameId)
      }),
    ),
  )
}

/**
 * Start the game loop as a fiber within a ManagedRuntime.
 * The runtime provides all layers (logger, services) to the fiber,
 * ensuring Effect.logInfo/logDebug use the proper game logger.
 * Falls back to Effect.runFork if no runtime is provided.
 *
 * EFFECT POSTURE (why we keep Effect-TS — see the modernization audit): this
 * loop is the ONE load-bearing use of Effect. Each game is a supervised,
 * cancellable fiber — Schedule.fixed + Effect.repeat drive the fixed-interval
 * tick, runFork/forkDaemon spawn it, ManagedRuntime owns the service layers, and
 * Effect.interrupt (via stopGameLoop) cleanly tears a game down. Replacing this
 * with raw setInterval + manual cancellation/lifecycle would be a real
 * regression in correctness. The other ~50 server files use Effect only as a
 * thin Promise wrapper for typed errors; that's stylistic, not essential — but
 * rewriting them buys nothing and loses the typed-error ergonomics, so we keep
 * Effect on 3.x project-wide. (v4 is beta-only; do not adopt.)
 */
export function startGameLoop(
  gameId: string,
  stateManager: StateManagerApi,
  callbacks: GameCallbacks,
  runtime?: ManagedRuntime.ManagedRuntime<never, never>,
  redis?: RedisServiceApi,
  snapshotMeta?: SnapshotMeta,
): void {
  const loop = buildGameLoop(gameId, stateManager, callbacks, redis, snapshotMeta)
  const fiber = runtime ? runtime.runFork(loop) : Effect.runFork(loop)
  activeGames.set(gameId, fiber)
  engineLog.info('Game loop fiber started', { gameId })
}

/**
 * Dev/test-only: run a SINGLE tick out-of-band (manual stepping via the
 * /api/test/advance hook). Mirrors the core of buildGameLoop's tickLoop —
 * processTick → persist → broadcast — minus the periodic snapshot / AFK /
 * action-log bookkeeping that manual dev steps don't need. Only used by games
 * created in manual-tick mode (no auto-schedule), so it never races the
 * fixed-interval loop. No-op in production.
 */
export async function runOneTick(
  gameId: string,
  stateManager: StateManagerApi,
  callbacks: GameCallbacks,
  runtime: ManagedRuntime.ManagedRuntime<never, never>,
): Promise<void> {
  if (process.env.NODE_ENV === 'production' && process.env.TERMINA_TEST_HOOKS !== '1') return
  await runtime.runPromiseExit(
    Effect.gen(function* () {
      const current = yield* stateManager.getState(gameId)
      if (current.phase === 'ended') return
      const { state: newState, events } = yield* processTick(gameId, current)
      yield* stateManager.updateState(gameId, () => newState)
      for (const playerId of Object.keys(newState.players)) {
        try {
          callbacks.onTickState(gameId, playerId, filterStateForPlayer(newState, playerId))
        } catch (err) {
          engineLog.warn('runOneTick: tick_state send failed', {
            gameId,
            playerId,
            error: String(err),
          })
        }
      }
      if (callbacks.onSpectatorTick) {
        try {
          callbacks.onSpectatorTick(gameId, newState)
        } catch {
          /* non-critical */
        }
      }
      if (events.length > 0) callbacks.onEvents(gameId, events)
    }).pipe(Effect.catchAll(() => Effect.void)),
  )
}

/** Stop a running game loop. */
export function stopGameLoop(gameId: string): Effect.Effect<void> {
  return Effect.gen(function* () {
    const fiber = activeGames.get(gameId)
    if (fiber) {
      activeGames.delete(gameId)
      yield* Fiber.interrupt(fiber)
    }
    gameActionQueues.delete(gameId)
  })
}

// ── Tick phases (extracted for testability) ───────────────────

/**
 * Handle special commands (buyback, surrender, select_talent) that bypass
 * the normal action-resolution path. Mutates state for buyback/talent,
 * records votes for surrender, and pushes events + rejection reasons.
 *
 * Returns the updated state plus events/rejections to merge into the tick.
 * Pure (no I/O, no Effect) — easy to test in isolation.
 */
export function processSpecialActions(
  state: GameState,
  actions: PlayerAction[],
): {
  state: GameState
  events: GameEngineEvent[]
  rejectedActions: Array<{ playerId: string; reason: string }>
} {
  let currentState = state
  const events: GameEngineEvent[] = []
  const rejectedActions: Array<{ playerId: string; reason: string }> = []

  for (const action of actions) {
    if (action.command.type === 'buyback') {
      const buybackResult = buyback(currentState, action.playerId)
      if (buybackResult.success && buybackResult.newState) {
        currentState = buybackResult.newState
        const player = currentState.players[action.playerId]
        if (player) {
          events.push({
            _tag: 'heal',
            tick: currentState.tick,
            sourceId: 'buyback',
            targetId: action.playerId,
            amount: player.maxHp,
          })
          events.push({
            _tag: 'power_spike',
            tick: currentState.tick,
            playerId: action.playerId,
            spikeType: 'core_item',
            itemId: 'buyback',
            message: `${player.name} used buyback!`,
          })
        }
      } else {
        rejectedActions.push({
          playerId: action.playerId,
          reason: buybackResult.reason || 'Buyback failed',
        })
      }
    } else if (action.command.type === 'surrender') {
      const vote = action.command.vote === 'yes'
      const player = currentState.players[action.playerId]
      if (player && !vote) {
        currentState = removeSurrenderVote(currentState, action.playerId)
      } else if (player && vote) {
        const result = voteSurrender(currentState, action.playerId)
        if (result.success) {
          currentState = result.state
          events.push({
            _tag: 'surrender_vote',
            tick: currentState.tick,
            playerId: action.playerId,
            team: player.team,
            votesFor: result.votes?.for ?? 0,
            votesNeeded: result.votes?.needed ?? 0,
          })
          if (result.surrendered) {
            const winner = player.team === 'radiant' ? 'dire' : 'radiant'
            currentState = { ...currentState, phase: 'ended', winner }
            events.push({
              _tag: 'surrendered',
              tick: currentState.tick,
              team: player.team,
              winner,
            })
            engineLog.info('Surrender passed', {
              team: player.team,
              votes: result.votes,
            })
          } else {
            engineLog.debug('Surrender vote cast', {
              playerId: action.playerId,
              votes: result.votes,
            })
          }
        } else {
          rejectedActions.push({
            playerId: action.playerId,
            reason: result.reason || 'Surrender vote failed',
          })
        }
      }
    } else if (action.command.type === 'select_talent') {
      const player = currentState.players[action.playerId]
      if (player && player.heroId) {
        const talentTree = TALENT_TREES[player.heroId]
        if (talentTree) {
          const tierKey = `tier${action.command.tier}` as keyof typeof player.talents
          const selectedTalentId = action.command.talentId

          const tierTalents = talentTree.tiers[action.command.tier]
          const isValidTalent = tierTalents.some((t) => t.id === selectedTalentId)
          const alreadySelected = player.talents[tierKey] !== null

          if (isValidTalent && !alreadySelected && player.level >= action.command.tier) {
            const updatedPlayers = { ...currentState.players }
            updatedPlayers[action.playerId] = {
              ...player,
              talents: { ...player.talents, [tierKey]: selectedTalentId },
            }
            currentState = { ...currentState, players: updatedPlayers }

            const selectedTalent = tierTalents.find((t) => t.id === selectedTalentId)
            events.push({
              _tag: 'talent_selected',
              tick: currentState.tick,
              playerId: action.playerId,
              talentId: selectedTalentId,
              tier: action.command.tier,
              talentName: selectedTalent?.name || 'Unknown',
            })
          } else {
            rejectedActions.push({
              playerId: action.playerId,
              reason: alreadySelected
                ? 'Talent already selected for this tier'
                : isValidTalent
                  ? 'Level requirement not met'
                  : 'Invalid talent',
            })
          }
        }
      }
    }
  }

  return { state: currentState, events, rejectedActions }
}

/**
 * Hero passive hook (processTick step 11.5). Synthesizes the wire-format
 * GameEvent stream the 18 hero passives were written against and folds
 * `resolvePassive` over every alive hero player for each event.
 *
 * Full trigger vocabulary used across the hero files:
 *   attack (cipher/echo/ping/thread/socket), ability_cast (lambda/regex/
 *   daemon), item_used (daemon), damage_taken (cache/firewall),
 *   move (mutex/traceroute), kill (null_ref), tick_end (cron/mutex/daemon).
 *
 * Keep the synthesized list lean (no per-creep events) — the fold is
 * O(players x events) immutable state copies per tick.
 */
export function runHeroPassives(
  state: GameState,
  validActions: PlayerAction[],
  allEvents: GameEngineEvent[],
  preTickZones: Map<string, string>,
): GameState {
  const synthesized: GameEvent[] = []

  const resolveHeroTarget = (name: string): string | undefined => {
    const needle = name.toLowerCase()
    for (const [id, p] of Object.entries(state.players)) {
      if (
        p.id.toLowerCase() === needle ||
        p.name.toLowerCase() === needle ||
        p.heroId?.toLowerCase() === needle
      ) {
        return id
      }
    }
    return undefined
  }

  for (const action of validActions) {
    const cmd = action.command
    if (cmd.type === 'attack') {
      const targetId = cmd.target.kind === 'hero' ? resolveHeroTarget(cmd.target.name) : undefined
      const dmgEvent = targetId
        ? allEvents.find(
            (e) => e._tag === 'damage' && e.sourceId === action.playerId && e.targetId === targetId,
          )
        : undefined
      synthesized.push({
        tick: state.tick,
        type: 'attack',
        payload: {
          attackerId: action.playerId,
          ...(targetId ? { targetId } : {}),
          ...(dmgEvent?._tag === 'damage' ? { damage: dmgEvent.amount } : {}),
        },
      })
    } else if (cmd.type === 'cast') {
      const targetId = cmd.target?.kind === 'hero' ? resolveHeroTarget(cmd.target.name) : undefined
      const dmgEvent = targetId
        ? allEvents.find(
            (e) => e._tag === 'damage' && e.sourceId === action.playerId && e.targetId === targetId,
          )
        : undefined
      synthesized.push({
        tick: state.tick,
        type: 'ability_cast',
        payload: {
          playerId: action.playerId,
          ability: cmd.ability,
          ...(targetId ? { targetId } : {}),
          ...(dmgEvent?._tag === 'damage' ? { damage: dmgEvent.amount } : {}),
        },
      })
    } else if (cmd.type === 'use') {
      synthesized.push({
        tick: state.tick,
        type: 'item_used',
        payload: { playerId: action.playerId },
      })
    }
  }

  // Zone diff: covers normal moves and resolver/item teleports; excludes
  // slow-cancelled moves (their zone never changed).
  for (const [pid, zone] of preTickZones) {
    const player = state.players[pid]
    if (player && player.zone !== zone) {
      synthesized.push({ tick: state.tick, type: 'move', payload: { playerId: pid } })
    }
  }

  for (const e of allEvents) {
    if (e._tag === 'damage' && state.players[e.targetId]) {
      synthesized.push({
        tick: state.tick,
        type: 'damage_taken',
        payload: {
          targetId: e.targetId,
          attackerId: e.sourceId,
          sourceId: e.sourceId,
          damage: e.amount,
          amount: e.amount,
        },
      })
    } else if (e._tag === 'kill') {
      synthesized.push({
        tick: state.tick,
        type: 'kill',
        payload: { killerId: e.killerId, victimId: e.victimId },
      })
    }
  }

  synthesized.push({ tick: state.tick, type: 'tick_end', payload: {} })

  let updated = state
  for (const event of synthesized) {
    for (const pid of Object.keys(updated.players)) {
      // resolvePassive no-ops for dead/heroless/unregistered players
      updated = resolvePassive(updated, pid, event)
    }
  }
  return updated
}

/**
 * Run all NPC AIs (creeps, neutrals, towers, Roshan) and apply their actions.
 *
 * Tower AI needs `heroAttackers` from the prior `resolveActions` step so it
 * can prioritize heroes that recently attacked allies. Roshan damage is
 * tallied by scanning the events emitted earlier in the tick.
 */
export function runNPCAI(
  state: GameState,
  ctx: { heroAttackers: Map<string, string>; priorEvents: GameEngineEvent[] },
): { state: GameState; events: GameEngineEvent[] } {
  let s = state
  const events: GameEngineEvent[] = []

  // Creeps (may damage/destroy the enemy Ancient — events carry that)
  const creepResult = applyCreepActions(s, runCreepAI(s))
  s = creepResult.state
  events.push(...creepResult.events)

  // Neutrals
  s = applyNeutralActions(s, runNeutralAI(s))

  // Towers — priorEvents lets towers aggro heroes that attacked them this tick
  s = applyTowerActions(s, runTowerAI(s, ctx.heroAttackers, ctx.priorEvents))

  // Roshan attacks
  for (const action of runRoshanAI(s)) {
    const target = s.players[action.targetId]
    if (target && target.alive) {
      // Route through the shared mitigation chain so Roshan hits honor item
      // defense, vuln amps, Kernel 'hardened', shields, and Echo phaseShift —
      // previously the inline path skipped everything but immunity and emitted
      // the RAW attack value as the damage amount.
      const hit = resolvePhysicalHit(target, action.damage)
      if (hit.immune || hit.damageDealt === 0) continue
      s = {
        ...s,
        players: {
          ...s.players,
          [action.targetId]: hit.player,
        },
      }
      events.push({
        _tag: 'damage',
        tick: s.tick,
        sourceId: 'roshan',
        targetId: action.targetId,
        amount: hit.damageDealt,
        damageType: 'physical',
      })
    }
  }

  // Roshan damage tally — sum hero damage on roshan from prior + new events.
  const roshanDamage = new Map<string, number>()
  for (const event of [...ctx.priorEvents, ...events]) {
    if (event._tag === 'damage' && event.targetId === 'roshan') {
      roshanDamage.set(event.sourceId, (roshanDamage.get(event.sourceId) ?? 0) + event.amount)
    }
  }
  const roshanResult = processRoshanDamage(s, roshanDamage)
  s = roshanResult.state
  if (roshanResult.roshanKilled) {
    events.push(...roshanResult.events.filter((e) => e._tag === 'roshan_killed'))
  }

  return { state: s, events }
}

/**
 * Spawn periodic content for the tick: creep waves, jungle neutrals, runes;
 * and clean up expired runes and wards. Pure: same state object if nothing
 * spawned and nothing expired.
 */
export function runSpawning(state: GameState): GameState {
  let s = state
  // Gate creep/neutral/rune spawning to the zones THIS game's map actually has,
  // so subset maps (one-lane) don't spawn into uninitialized top/bot/jungle zones.
  const hasZone = (zoneId: string) => zoneId in s.zones

  const newCreeps = spawnCreepWaves(s.tick, hasZone)
  if (newCreeps.length > 0) {
    s = { ...s, creeps: [...s.creeps, ...newCreeps] }
  }

  // Defensive cap: never let creeps stack unboundedly in a zone
  s = enforceCreepZoneCap(s)

  const newNeutrals = spawnNeutralCreeps(s.tick, hasZone)
  if (newNeutrals.length > 0) {
    s = { ...s, neutrals: [...(s.neutrals ?? []), ...newNeutrals] }
  }

  const newRunes = spawnRunes(s.tick, hasZone)
  if (newRunes.length > 0) {
    s = { ...s, runes: [...(s.runes ?? []), ...newRunes] }
  }

  s = removeExpiredRunes(s)
  s = processRuneBuffs(s)

  const updatedZones = removeExpiredWards(s.zones, s.tick)
  if (updatedZones !== s.zones) {
    s = { ...s, zones: updatedZones }
  }

  return s
}

/**
 * Drop tower invulnerability for any team whose glyph effect has expired.
 * Pure: returns a new state if anything changed, the same state otherwise.
 */
export function expireGlyph(state: GameState): GameState {
  const radiantUsed = state.teams.radiant.glyphUsedTick
  const direUsed = state.teams.dire.glyphUsedTick
  const radiantExpired = radiantUsed !== null && state.tick - radiantUsed >= GLYPH_DURATION_TICKS
  const direExpired = direUsed !== null && state.tick - direUsed >= GLYPH_DURATION_TICKS

  if (!radiantExpired && !direExpired) return state

  return {
    ...state,
    towers: state.towers.map((t) => {
      if (t.team === 'radiant' && radiantExpired) return { ...t, invulnerable: false }
      if (t.team === 'dire' && direExpired) return { ...t, invulnerable: false }
      return t
    }),
  }
}

/**
 * Progress the day/night counter and emit a transition event when the cycle
 * flips. Returns the updated state and any emitted events.
 */
export function progressDayNight(state: GameState): {
  state: GameState
  events: GameEngineEvent[]
} {
  const events: GameEngineEvent[] = []
  let timeOfDay = state.timeOfDay
  let dayNightTick = state.dayNightTick + 1

  if (timeOfDay === 'day' && dayNightTick >= DAY_DURATION_TICKS) {
    timeOfDay = 'night'
    dayNightTick = 0
    events.push({ _tag: 'night_falls', tick: state.tick })
  } else if (timeOfDay === 'night' && dayNightTick >= NIGHT_DURATION_TICKS) {
    timeOfDay = 'day'
    dayNightTick = 0
    events.push({ _tag: 'day_breaks', tick: state.tick })
  }

  return {
    state: { ...state, timeOfDay, dayNightTick },
    events,
  }
}

// ── Helper functions ───────────────────────────────────────────

/** Handle player respawns: set alive if respawnTick has been reached. */
function handleRespawns(state: GameState): GameState {
  const players = { ...state.players }
  let changed = false

  for (const [pid, player] of Object.entries(players)) {
    if (!player.alive && player.respawnTick !== null && state.tick >= player.respawnTick) {
      const spawnZone = player.team === 'radiant' ? 'radiant-fountain' : 'dire-fountain'
      players[pid] = {
        ...player,
        alive: true,
        hp: player.maxHp,
        mp: player.maxMp,
        zone: spawnZone,
        respawnTick: null,
      }
      changed = true
    }
  }

  return changed ? { ...state, players } : state
}

/** Apply fountain healing to heroes standing in their fountain. */
function applyFountainHealing(state: GameState): GameState {
  const players = { ...state.players }
  let changed = false

  for (const [pid, player] of Object.entries(players)) {
    if (!player.alive) continue

    const isInFountain =
      (player.team === 'radiant' && player.zone === 'radiant-fountain') ||
      (player.team === 'dire' && player.zone === 'dire-fountain')

    // Skip healing if player is in combat (soft check — full combat tracking would need a separate system)
    const inCombat = player.buffs.some((b) => b.id === 'inCombat')
    if (isInFountain && !inCombat) {
      const hpHeal = Math.floor((player.maxHp * FOUNTAIN_HEAL_PER_TICK_PERCENT) / 100)
      const mpHeal = Math.floor((player.maxMp * FOUNTAIN_MANA_PER_TICK_PERCENT) / 100)
      players[pid] = {
        ...player,
        hp: Math.min(player.maxHp, player.hp + hpHeal),
        mp: Math.min(player.maxMp, player.mp + mpHeal),
      }
      changed = true
    }
  }

  return changed ? { ...state, players } : state
}

/** Handle newly dead players — set respawn timers, attribute kills/assists, award gold/XP. */
function handleDeaths(
  gameId: string,
  state: GameState,
  events: GameEngineEvent[],
  heroAttackers?: Map<string, string>,
): GameState {
  let players = { ...state.players }
  let teams = { ...state.teams }
  let changed = false

  for (const [pid, player] of Object.entries(players)) {
    if (!player.alive && player.respawnTick === null) {
      if (player.buffs.some((b) => b.id === 'aegis')) {
        players[pid] = {
          ...player,
          alive: true,
          hp: player.maxHp,
          mp: player.maxMp,
          buffs: player.buffs.filter((b) => b.id !== 'aegis'),
        }
        events.push({
          _tag: 'aegis_used',
          tick: state.tick,
          playerId: pid,
        })
        changed = true
        continue
      }

      const alreadyCounted = events.some((e) => e._tag === 'death' && e.playerId === pid)
      const scaledLevels = Math.max(0, player.level - RESPAWN_FREE_LEVELS)
      // scaledRespawnTicks keeps wall-clock respawn time at production pace
      // when the TERMINA_TEST_FAST_GAME accelerator is active (no-op otherwise).
      const respawnTicks = scaledRespawnTicks(
        RESPAWN_BASE_TICKS + RESPAWN_PER_LEVEL_TICKS * scaledLevels,
      )
      const newDeaths = alreadyCounted ? player.deaths : player.deaths + 1
      // Compute from the post-death death count so the displayed buyback cost
      // matches what buyback() actually charges (both use deaths * 10).
      const buybackCost = calculateBuybackCost({ ...player, deaths: newDeaths })

      players[pid] = {
        ...player,
        respawnTick: state.tick + respawnTicks,
        deaths: newDeaths,
        killStreak: 0,
        buybackCost,
      }
      if (!alreadyCounted) {
        events.push({
          _tag: 'death',
          tick: state.tick,
          playerId: pid,
          respawnTick: state.tick + respawnTicks,
        })
      }

      // Everyone who damaged the victim recently shares credit — direct
      // attackers from this tick plus DoT/ability/item damage in the window.
      const contributors = new Set(getDamageContributors(gameId, pid))
      if (heroAttackers) {
        for (const [attackerId, victimId] of heroAttackers.entries()) {
          if (victimId === pid) contributors.add(attackerId)
        }
      }
      contributors.delete(pid)

      // Killer preference: a direct attacker this tick, else any recent contributor
      let killerId: string | null = null
      if (heroAttackers) {
        for (const [attackerId, victimId] of heroAttackers.entries()) {
          if (victimId === pid && players[attackerId]) {
            killerId = attackerId
            break
          }
        }
      }
      if (!killerId) {
        killerId = [...contributors].find((id) => players[id]) ?? null
      }

      // The victim's damage record is spent — a future death starts fresh
      recentHeroDamage.get(gameId)?.delete(pid)

      if (killerId && players[killerId]) {
        // Award kill gold
        const assisters = [...contributors].filter((id) => id !== killerId && players[id])
        const tempState: GameState = { ...state, players }
        // `player` is the loop's original victim — its killStreak still holds the
        // pre-death value (players[pid] was reset to 0 above). Pass it so the
        // shutdown bounty actually scales with how fed the victim was.
        const awarded = awardKill(tempState, killerId, pid, assisters, player.killStreak)
        players = { ...awarded.players }

        // Increment kill count + streak
        const killer = players[killerId]!
        players[killerId] = {
          ...killer,
          kills: killer.kills + 1,
          killStreak: (killer.killStreak ?? 0) + 1,
        }

        // Increment assist counts
        for (const assistId of assisters) {
          const assister = players[assistId]
          if (assister) {
            players[assistId] = { ...assister, assists: assister.assists + 1 }
          }
        }

        // Award XP for hero kill to killer
        const victim = players[pid]!
        const killXp = HERO_KILL_XP_BASE + HERO_KILL_XP_PER_LEVEL * victim.level
        const killerForXp = players[killerId]!
        players[killerId] = { ...killerForXp, xp: killerForXp.xp + killXp }

        // Award assisters a fraction of the kill XP (ASSIST_XP_RATIO)
        const assistXp = Math.floor(killXp * ASSIST_XP_RATIO)
        for (const assistId of assisters) {
          const assister = players[assistId]
          if (assister) {
            players[assistId] = { ...assister, xp: assister.xp + assistXp }
          }
        }

        // Segfault Blade passive: reset all cooldowns on hero kill
        const killerAfterXp = players[killerId]!
        if (killerAfterXp.items.includes('segfault_blade')) {
          players[killerId] = {
            ...killerAfterXp,
            cooldowns: { q: 0, w: 0, e: 0, r: 0 },
          }
        }

        // Divine Rapier passive: "Drops on death." The victim's Rapier(s) are
        // claimed by the killer (its defining high-risk drawback — feeding a hero
        // hands them +100 attack). No ground-pickup system: if the killer has no
        // free slot the Rapier is destroyed, but the victim loses it either way.
        const rapierVictim = players[pid]!
        if (rapierVictim.items.includes('divine_rapier')) {
          const victimItems = [...rapierVictim.items]
          const killerItems = [...players[killerId]!.items]
          for (let i = 0; i < victimItems.length; i++) {
            if (victimItems[i] !== 'divine_rapier') continue
            victimItems[i] = null
            const freeSlot = killerItems.indexOf(null)
            if (freeSlot !== -1) killerItems[freeSlot] = 'divine_rapier'
          }
          players[pid] = { ...rapierVictim, items: victimItems }
          players[killerId] = { ...players[killerId]!, items: killerItems }
        }

        // Increment team kill counter
        const killerTeam = players[killerId]!.team
        const teamState = teams[killerTeam]
        teams = {
          ...teams,
          [killerTeam]: { ...teamState, kills: teamState.kills + 1 },
        }

        // Emit kill event. `player` is the original victim (pre-reset), so its
        // killStreak is how fed they were; the killer's streak was just bumped.
        events.push({
          _tag: 'kill',
          tick: state.tick,
          killerId,
          victimId: pid,
          assisters,
          victimStreak: player.killStreak ?? 0,
          killerStreak: players[killerId]?.killStreak ?? 0,
        } as GameEngineEvent)
      }

      changed = true
    }
  }

  return changed ? { ...state, players, teams } : state
}

/** Check XP thresholds and level up players. */
function checkLevelUps(state: GameState, events: GameEngineEvent[]): GameState {
  const players = { ...state.players }
  let changed = false

  for (const [pid, player] of Object.entries(players)) {
    if (player.level >= MAX_LEVEL) continue

    const nextLevelXp = XP_PER_LEVEL[player.level + 1]
    if (nextLevelXp !== undefined && player.xp >= nextLevelXp) {
      const newLevel = player.level + 1
      players[pid] = levelUpHero(player)
      events.push({
        _tag: 'level_up',
        tick: state.tick,
        playerId: pid,
        newLevel,
      })

      // Power spike notifications for key levels
      if ((POWER_SPIKE_LEVELS as readonly number[]).includes(newLevel)) {
        events.push({
          _tag: 'power_spike',
          tick: state.tick,
          playerId: pid,
          spikeType: `level_${newLevel}` as 'level_6' | 'level_12' | 'level_18',
          message: `${player.name} reached level ${newLevel}! Ultimate powers online.`,
        })
      }

      changed = true
    }
  }

  return changed ? { ...state, players } : state
}

/** Apply inCombat buff to players who dealt or received hero damage this tick. */
function applyInCombatBuffs(state: GameState, events: GameEngineEvent[]): GameState {
  const combatPlayers = new Set<string>()
  for (const event of events) {
    if (event._tag === 'damage') {
      if (state.players[event.sourceId]) {
        combatPlayers.add(event.sourceId)
      }
      if (state.players[event.targetId]) {
        combatPlayers.add(event.targetId)
      }
    }
  }

  if (combatPlayers.size === 0) return state

  let players = { ...state.players }
  for (const pid of combatPlayers) {
    const player = players[pid]
    if (!player || !player.alive) continue

    const existing = player.buffs.findIndex((b) => b.id === 'inCombat')
    const buffs = [...player.buffs]
    if (existing >= 0) {
      buffs[existing] = { ...buffs[existing]!, ticksRemaining: 3 }
    } else {
      buffs.push({
        id: 'inCombat',
        stacks: 1,
        ticksRemaining: IN_COMBAT_BUFF_DURATION,
        source: 'system',
      })
    }
    players = { ...players, [pid]: { ...player, buffs } }
  }

  return { ...state, players }
}

/** Track tower kills by comparing pre-tick and post-tick tower state. */
function trackTowerKills(
  state: GameState,
  preTowers: GameState['towers'],
  events: GameEngineEvent[],
): GameState {
  let teams = { ...state.teams }
  let changed = false

  for (let i = 0; i < state.towers.length; i++) {
    const before = preTowers[i]
    const after = state.towers[i]
    if (before && after && before.alive && !after.alive) {
      // Tower was destroyed — the killing team is the opposing team
      const killerTeam = after.team === 'radiant' ? 'dire' : 'radiant'
      const teamState = teams[killerTeam]
      teams = {
        ...teams,
        [killerTeam]: { ...teamState, towerKills: teamState.towerKills + 1 },
      }

      events.push({
        _tag: 'tower_kill',
        tick: state.tick,
        zone: after.zone,
        team: after.team,
        killerTeam,
      })

      changed = true
    }
  }

  return changed ? { ...state, teams } : state
}

/**
 * A team wins by destroying the enemy Ancient ("the Mainframe"). The
 * Ancient becomes attackable once any of its team's T3 towers is down —
 * see AncientSystem for the vulnerability/attack rules.
 */
function checkWinCondition(state: GameState): TeamId | null {
  return checkAncientWin(state)
}

// NOTE: the server used to maintain a global `state.lastSeen` here (and auto-emit
// `enemy_missing`), but that was dead-and-wrong — a single un-fogged global field
// can't model the per-viewer/fog-aware "last seen" concept, which the CLIENT does
// correctly in store.lastSeen. Both the writer and the GameState field are gone;
// player-initiated enemy-missing callouts go through the `missing` command.
