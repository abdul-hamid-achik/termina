import type { ManagedRuntime } from 'effect'
import { Effect, Schedule, Fiber } from 'effect'
import type { GameState, TeamId } from '~~/shared/types/game'
import type { Command } from '~~/shared/types/commands'
import {
  TICK_DURATION_MS,
  RESPAWN_BASE_TICKS,
  RESPAWN_PER_LEVEL_TICKS,
  FOUNTAIN_HEAL_PER_TICK_PERCENT,
  FOUNTAIN_MANA_PER_TICK_PERCENT,
  XP_PER_LEVEL,
  MAX_LEVEL,
  HERO_KILL_XP_BASE,
  HERO_KILL_XP_PER_LEVEL,
  DAY_DURATION_TICKS,
  NIGHT_DURATION_TICKS,
  GLYPH_DURATION_TICKS,
} from '~~/shared/constants/balance'
import type { StateManagerApi } from './StateManager'
import { resolveActions, validateAction, type PlayerAction } from './ActionResolver'
import { distributePassiveGold, awardKill } from './GoldDistributor'
import { runCreepAI, applyCreepActions } from './CreepAI'
import { runTowerAI, applyTowerActions } from './TowerAI'
import { runRoshanAI, processRoshanDamage } from './RoshanAI'
import { removeExpiredRunes, processRuneBuffs } from './RuneAI'
import { spawnCreepWaves, spawnRunes } from '../map/spawner'
import { spawnNeutralCreeps, runNeutralAI, applyNeutralActions } from './NeutralAI'
import { removeExpiredWards } from '../map/zones'
import { filterStateForPlayer } from './VisionCalculator'
import { levelUpHero, processDoTs, tickAllBuffs } from '../heroes/_base'
import { toGameEvent, type GameEngineEvent } from '../protocol/events'
import { getBotPlayerIds, getBotLane } from '../ai/BotManager'
import { decideBotAction } from '../ai/BotAI'
import { engineLog } from '../../utils/log'
import { calculateBuybackCost, buyback } from './BuybackSystem'
import { voteSurrender } from './SurrenderSystem'
import { TALENT_TREES } from '../heroes/talent-trees'
import {
  markPlayerActiveSafe,
  detectAFKPlayers,
  recordLeaverSafe,
} from '../../services/LeaverSystem'

// ── Action queue per game ──────────────────────────────────────

/** Pending actions collected during the action window. */
const gameActionQueues = new Map<string, PlayerAction[]>()

/** Submit an action for the current tick. */
export function submitAction(gameId: string, playerId: string, command: Command): void {
  let queue = gameActionQueues.get(gameId)
  if (!queue) {
    queue = []
    gameActionQueues.set(gameId, queue)
  }
  // Only one action per player per tick
  const existing = queue.findIndex((a) => a.playerId === playerId)
  if (existing >= 0) {
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
}> {
  return Effect.gen(function* () {
    let currentState: GameState = { ...state, tick: state.tick + 1, events: [] }
    const allEvents: GameEngineEvent[] = []
    const rejectedActions: Array<{ playerId: string; reason: string }> = []

    // 0. Run bot AI — inject bot actions before draining
    const botPlayerIds = getBotPlayerIds(gameId)
    for (const botId of botPlayerIds) {
      const bot = currentState.players[botId]
      if (bot && bot.alive) {
        const command = decideBotAction(currentState, bot, getBotLane(gameId, botId))
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
    }

    // 1.5. Handle special commands (buyback, surrender) before validation
    for (const action of actions) {
      if (action.command.type === 'buyback') {
        const buybackResult = buyback(currentState, action.playerId)
        if (buybackResult.success && buybackResult.newState) {
          currentState = buybackResult.newState
          const player = currentState.players[action.playerId]
          if (player) {
            allEvents.push({
              _tag: 'heal',
              tick: currentState.tick,
              sourceId: 'buyback',
              targetId: action.playerId,
              amount: player.maxHp,
            })
            allEvents.push({
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
        if (player && vote) {
          const result = voteSurrender(currentState, action.playerId)
          if (result.success) {
            if (result.surrendered) {
              // Game will end via win condition check
              engineLog.info('Surrender passed', {
                team: player.team,
                votes: result.votes,
              })
            } else {
              // Broadcast vote status
              engineLog.debug('Surrender vote cast', {
                playerId: action.playerId,
                votes: result.votes,
              })
            }
          }
        }
      } else if (action.command.type === 'select_talent') {
        const player = currentState.players[action.playerId]
        if (player && player.heroId) {
          const talentTree = TALENT_TREES[player.heroId]
          if (talentTree) {
            const tierKey = `tier${action.command.tier}` as keyof typeof player.talents
            const selectedTalentId = action.command.talentId

            // Check if talent is valid for this tier
            const tierTalents = talentTree.tiers[action.command.tier]
            const isValidTalent = tierTalents.some((t) => t.id === selectedTalentId)

            // Check if player hasn't already selected a talent for this tier
            const alreadySelected = player.talents[tierKey] !== null

            if (isValidTalent && !alreadySelected && player.level >= action.command.tier) {
              // Apply talent selection
              const updatedPlayers = { ...currentState.players }
              updatedPlayers[action.playerId] = {
                ...player,
                talents: {
                  ...player.talents,
                  [tierKey]: selectedTalentId,
                },
              }
              currentState = { ...currentState, players: updatedPlayers }

              // Emit talent selection event
              const selectedTalent = tierTalents.find((t) => t.id === selectedTalentId)
              allEvents.push({
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

    // 3.5. Track tower kills and update team stats
    currentState = trackTowerKills(currentState, preTowers, allEvents)

    // 3.6. Apply inCombat buffs based on damage events
    currentState = applyInCombatBuffs(currentState, resolved.events)

    // 3.7. Track last seen positions and detect missing enemies
    const lastSeenUpdate = trackLastSeenAndMissing(currentState, allEvents)
    currentState = lastSeenUpdate.state
    allEvents.push(...lastSeenUpdate.events)

    // 3.8. Expire glyph invulnerability
    if (currentState.teams.radiant.glyphUsedTick !== null) {
      if (currentState.tick - currentState.teams.radiant.glyphUsedTick >= GLYPH_DURATION_TICKS) {
        currentState = {
          ...currentState,
          towers: currentState.towers.map((t) =>
            t.team === 'radiant' ? { ...t, invulnerable: false } : t,
          ),
        }
      }
    }
    if (currentState.teams.dire.glyphUsedTick !== null) {
      if (currentState.tick - currentState.teams.dire.glyphUsedTick >= GLYPH_DURATION_TICKS) {
        currentState = {
          ...currentState,
          towers: currentState.towers.map((t) =>
            t.team === 'dire' ? { ...t, invulnerable: false } : t,
          ),
        }
      }
    }

    // 4. Run CreepAI
    const creepActions = runCreepAI(currentState)
    currentState = applyCreepActions(currentState, creepActions)

    // 4.1 Run NeutralAI (neutrals attack heroes in their zone)
    const neutralActions = runNeutralAI(currentState)
    currentState = applyNeutralActions(currentState, neutralActions)

    // 5. Run TowerAI
    const towerActions = runTowerAI(currentState, resolved.heroAttackers)
    currentState = applyTowerActions(currentState, towerActions)

    // 5.5. Run RoshanAI (attacks heroes in roshan-pit)
    const roshanActions = runRoshanAI(currentState)
    for (const action of roshanActions) {
      const target = currentState.players[action.targetId]
      if (target && target.alive) {
        const newHp = Math.max(0, target.hp - action.damage)
        currentState = {
          ...currentState,
          players: {
            ...currentState.players,
            [action.targetId]: { ...target, hp: newHp, alive: newHp > 0 },
          },
        }
        allEvents.push({
          _tag: 'damage',
          tick: currentState.tick,
          sourceId: 'roshan',
          targetId: action.targetId,
          amount: action.damage,
          damageType: 'physical',
        })
      }
    }

    // 5.6. Process Roshan damage and death/respawn
    // Track damage dealt to Roshan from hero attacks
    const roshanDamage = new Map<string, number>()
    for (const event of allEvents) {
      if (event._tag === 'damage' && event.targetId === 'roshan') {
        const current = roshanDamage.get(event.sourceId) ?? 0
        roshanDamage.set(event.sourceId, current + event.amount)
      }
    }
    const roshanResult = processRoshanDamage(currentState, roshanDamage)
    currentState = roshanResult.state
    if (roshanResult.roshanKilled) {
      allEvents.push(...roshanResult.events.filter((e) => e._tag === 'roshan_killed'))
    }

    // 6. Spawn creep waves
    const newCreeps = spawnCreepWaves(currentState.tick)
    if (newCreeps.length > 0) {
      currentState = { ...currentState, creeps: [...currentState.creeps, ...newCreeps] }
    }

    // 6.1 Spawn neutral creeps in jungle camps
    const newNeutrals = spawnNeutralCreeps(currentState.tick)
    if (newNeutrals.length > 0) {
      currentState = {
        ...currentState,
        neutrals: [...(currentState.neutrals ?? []), ...newNeutrals],
      }
    }

    // 6.2 Spawn runes
    const newRunes = spawnRunes(currentState.tick)
    if (newRunes.length > 0) {
      currentState = { ...currentState, runes: [...(currentState.runes ?? []), ...newRunes] }
    }

    // 6.3 Remove expired runes
    currentState = removeExpiredRunes(currentState)

    // 6.4 Process rune buff effects (regen, etc)
    currentState = processRuneBuffs(currentState)

    // 7. Remove expired wards
    const updatedZones = removeExpiredWards(currentState.zones, currentState.tick)
    if (updatedZones !== currentState.zones) {
      currentState = { ...currentState, zones: updatedZones }
    }

    // 8. Distribute passive gold
    currentState = distributePassiveGold(currentState)

    // 9. Handle respawns
    currentState = handleRespawns(currentState)

    // 10. Fountain healing
    currentState = applyFountainHealing(currentState)

    // 10.5. Process DoT damage
    currentState = processDoTs(currentState)

    // 10.6. Tick all buffs (decrement durations, remove expired)
    currentState = tickAllBuffs(currentState)

    // 11. Handle deaths — check for newly dead players, attribute kills
    currentState = handleDeaths(currentState, allEvents, resolved.heroAttackers)

    // 12. Check level ups
    currentState = checkLevelUps(currentState, allEvents)

    // 13. Check win condition
    const winner = checkWinCondition(currentState)
    if (winner) {
      currentState = { ...currentState, phase: 'ended' }
      allEvents.push({
        _tag: 'gold_change',
        tick: currentState.tick,
        playerId: '',
        amount: 0,
        reason: `game_over:${winner}`,
      })
      yield* Effect.logInfo('Win condition met').pipe(Effect.annotateLogs({ gameId, winner }))
    }

    // 13.5. Progress day/night cycle
    let newTimeOfDay = currentState.timeOfDay
    let newDayNightTick = currentState.dayNightTick + 1

    if (currentState.timeOfDay === 'day' && newDayNightTick >= DAY_DURATION_TICKS) {
      newTimeOfDay = 'night'
      newDayNightTick = 0
      allEvents.push({ _tag: 'night_falls', tick: currentState.tick })
    } else if (currentState.timeOfDay === 'night' && newDayNightTick >= NIGHT_DURATION_TICKS) {
      newTimeOfDay = 'day'
      newDayNightTick = 0
      allEvents.push({ _tag: 'day_breaks', tick: currentState.tick })
    }

    currentState = {
      ...currentState,
      timeOfDay: newTimeOfDay,
      dayNightTick: newDayNightTick,
    }

    // 14. Store events on state
    currentState = {
      ...currentState,
      events: allEvents.map(toGameEvent),
    }

    yield* Effect.logDebug('Tick processed').pipe(
      Effect.annotateLogs({ gameId, tick: currentState.tick, actionCount: validActions.length }),
    )

    return { state: currentState, events: allEvents, rejectedActions }
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
): Effect.Effect<void> {
  // Run a single tick with per-tick error recovery so one bad tick
  // doesn't kill the entire game loop.
  const tickLoop = Effect.gen(function* () {
    const currentState = yield* stateManager.getState(gameId)
    if (currentState.phase === 'ended') return yield* Effect.interrupt

    const { state: newState, events, rejectedActions } = yield* processTick(gameId, currentState)
    yield* stateManager.updateState(gameId, () => newState)

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
        recordLeaverSafe(afk.playerId, gameId, newState, 'afk')
        engineLog.warn('AFK player detected', {
          gameId,
          playerId: afk.playerId,
          ticksAFK: afk.ticksAFK,
        })
      }
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

    if (events.length > 0) {
      callbacks.onEvents(gameId, events)
    }

    // Check win — phase is set to 'ended' by processTick when win condition fires
    if (newState.phase === 'ended') {
      const winner = checkWinCondition(newState)
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

  return Effect.gen(function* () {
    yield* stateManager.updateState(gameId, (s) => ({ ...s, phase: 'playing' as const }))
    engineLog.info('Game loop starting', { gameId })
    yield* Effect.repeat(tickLoop, Schedule.fixed(`${TICK_DURATION_MS} millis`))
  }).pipe(
    Effect.catchAll((error) => {
      engineLog.error('Game loop fatal error', { gameId, error: String(error) })
      return Effect.void
    }),
  )
}

/**
 * Start the game loop as a fiber within a ManagedRuntime.
 * The runtime provides all layers (logger, services) to the fiber,
 * ensuring Effect.logInfo/logDebug use the proper game logger.
 * Falls back to Effect.runFork if no runtime is provided.
 */
export function startGameLoop(
  gameId: string,
  stateManager: StateManagerApi,
  callbacks: GameCallbacks,
  runtime?: ManagedRuntime.ManagedRuntime<never, never>,
): void {
  const loop = buildGameLoop(gameId, stateManager, callbacks)
  const fiber = runtime ? runtime.runFork(loop) : Effect.runFork(loop)
  activeGames.set(gameId, fiber)
  engineLog.info('Game loop fiber started', { gameId })
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
      const respawnTicks = RESPAWN_BASE_TICKS + RESPAWN_PER_LEVEL_TICKS * player.level
      const buybackCost = calculateBuybackCost(player)

      players[pid] = {
        ...player,
        respawnTick: state.tick + respawnTicks,
        deaths: alreadyCounted ? player.deaths : player.deaths + 1,
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

      // Determine killer from heroAttackers (who attacked this victim)
      let killerId: string | null = null
      if (heroAttackers) {
        for (const [attackerId, victimId] of heroAttackers.entries()) {
          if (victimId === pid) {
            killerId = attackerId
            break
          }
        }
      }

      if (killerId && players[killerId]) {
        // Award kill gold
        const assisters = heroAttackers
          ? [...heroAttackers.entries()]
              .filter(([aid, vid]) => vid === pid && aid !== killerId)
              .map(([aid]) => aid)
          : []
        const tempState: GameState = { ...state, players }
        const awarded = awardKill(tempState, killerId, pid, assisters)
        players = { ...awarded.players }

        // Increment kill count
        const killer = players[killerId]!
        players[killerId] = { ...killer, kills: killer.kills + 1 }

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

        // Award 50% XP to assisters
        const assistXp = Math.floor(killXp * 0.5)
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

        // Increment team kill counter
        const killerTeam = players[killerId]!.team
        const teamState = teams[killerTeam]
        teams = {
          ...teams,
          [killerTeam]: { ...teamState, kills: teamState.kills + 1 },
        }

        // Emit kill event
        events.push({
          _tag: 'kill',
          tick: state.tick,
          killerId,
          victimId: pid,
          assisters,
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
      if (newLevel === 6 || newLevel === 12 || newLevel === 18) {
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
      buffs.push({ id: 'inCombat', stacks: 1, ticksRemaining: 3, source: 'system' })
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
 * Check if either team's base is destroyed (all 3 T3 towers + base under attack).
 * Simplified: a team wins when all 9 enemy towers are destroyed.
 */
function checkWinCondition(state: GameState): TeamId | null {
  const radiantTowersAlive = state.towers.filter((t) => t.team === 'radiant' && t.alive).length
  const direTowersAlive = state.towers.filter((t) => t.team === 'dire' && t.alive).length

  if (radiantTowersAlive === 0) return 'dire'
  if (direTowersAlive === 0) return 'radiant'

  return null
}

/**
 * Track last seen positions for all players and detect missing enemies
 */
function trackLastSeenAndMissing(
  state: GameState,
  events: GameEngineEvent[],
): { state: GameState; events: GameEngineEvent[] } {
  const updatedLastSeen = { ...state.lastSeen }
  const newEvents: GameEngineEvent[] = []

  // Update last seen for all alive players based on their current zone
  for (const [pid, player] of Object.entries(state.players)) {
    if (player.alive) {
      updatedLastSeen[pid] = {
        zone: player.zone,
        tick: state.tick,
      }
    }
  }

  // Detect missing enemies - if a player hasn't been seen in 2 ticks and was last in lane
  const MISSING_THRESHOLD = 2 // ticks
  for (const [pid, player] of Object.entries(state.players)) {
    if (!player.alive) continue

    const enemyTeam = player.team === 'radiant' ? 'dire' : 'radiant'
    const enemies = Object.values(state.players).filter((p) => p.team === enemyTeam && p.alive)

    for (const enemy of enemies) {
      const lastSeen = state.lastSeen[enemy.id]
      if (!lastSeen) continue

      const ticksSinceSeen = state.tick - lastSeen.tick
      if (ticksSinceSeen >= MISSING_THRESHOLD) {
        // Check if not already reported this tick
        const alreadyReported = events.some(
          (e) => e._tag === 'enemy_missing' && e.playerId === enemy.id && e.tick === state.tick,
        )

        if (!alreadyReported) {
          newEvents.push({
            _tag: 'enemy_missing',
            tick: state.tick,
            playerId: enemy.id,
            lastSeenZone: lastSeen.zone,
            lastSeenTick: lastSeen.tick,
            reportedBy: pid,
          })
        }
      }
    }
  }

  return {
    state: { ...state, lastSeen: updatedLastSeen },
    events: newEvents,
  }
}
