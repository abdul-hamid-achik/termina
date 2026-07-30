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
  HARDEN_DURATION_TICKS,
} from '~~/shared/constants/balance'
import type { StateManagerApi } from './StateManager'
import { scaledTickIntervalMs, scaledRespawnTicks, fastGameFactor } from './fastGame'
import { resolveActions, validateAction, type PlayerAction } from './ActionResolver'
import { advanceTutorialAfterTick, TUTORIAL_STEP_COUNT } from '~~/server/game/modes/tutorial'
import { distributePassiveGold, awardKill, xpComebackMultiplier } from './GoldDistributor'
import { runCreepAI, applyCreepActions, enforceCreepZoneCap } from './CreepAI'
import { ensureAncients, updateAncientVulnerability, checkAncientWin } from './AncientSystem'
import { runIceAI, applyIceActions } from './IceAI'
import { runTenantAI, processTenantDamage } from './TenantAI'
import { removeExpiredCaches, processCacheBuffs } from './CacheAI'
import { processTraps } from './TrapSystem'
import { resolvePhysicalHit } from './CombatResolver'
import { spawnCreepWaves, spawnCaches } from '~~/server/game/map/spawner'
import { spawnNeutralCreeps, runNeutralAI, applyNeutralActions } from './NeutralAI'
import { removeExpiredWards } from '~~/server/game/map/zones'
import { filterStateForPlayer } from './VisionCalculator'
import { computeDelta, recordSentState, clearGameSentStates, getSentState } from './StateDelta'
// Importing from '~~/server/game/heroes' (not '../heroes/_base') guarantees every hero's
// registerHero() side effect has run before the first tick resolves a cast.
import {
  levelUpHero,
  processDoTs,
  tickAllBuffs,
  resolvePassive,
  getTalentTree,
} from '~~/server/game/heroes'
import { talentUnlockLevel } from '~~/shared/constants/talents'
import { toGameEvent, type GameEngineEvent } from '~~/server/game/protocol/events'
import { getBotPlayerIds, getBotLane, isBot, convertToBot } from '~~/server/game/ai/BotManager'
import { decideBotAction } from '~~/server/game/ai/BotAI'
import { engineLog } from '~~/server/utils/log'
import { calculateBuybackCost, buyback } from './BuybackSystem'
import { voteSurrender, removeSurrenderVote } from './SurrenderSystem'
import {
  markPlayerActiveSafe,
  detectAFKPlayers,
  shouldConvertAFK,
  msSinceClientInput,
  recordLeaverSafe,
} from '~~/server/services/LeaverSystem'
import { getPeer } from '~~/server/services/PeerRegistry'
import { writeSnapshot, SNAPSHOT_EVERY_N_TICKS, type SnapshotMeta } from './StateSnapshot'
import { appendActions } from './ActionLog'
import type { RedisServiceApi } from '~~/server/services/RedisService'

// ── Action queue per game ──────────────────────────────────────

/** Command verbs that do NOT cancel an in-progress auto-path walk: a new move
 *  replaces the destination in the resolver, and the out-of-band verbs resolve
 *  without expressing a new positional intent. */
const KEEPS_AUTOPATH = new Set(['move', 'surrender', 'select_talent', 'buyback'])

/** Command verbs that do NOT cancel a standing attack order: a new attack
 *  replaces the target in the resolver, an item active is a free action from
 *  its own slot, and the out-of-band verbs express no new target intent.
 *  Keeping `attack` here is also what lets a last hit interrupt a siege without
 *  ending it — a creep swing sets no order of its own, so the ice you were
 *  hitting is still the one you resume on. */
const KEEPS_ATTACK = new Set(['attack', 'use', 'surrender', 'select_talent', 'buyback'])

/**
 * Which per-player queue slot a command competes for. Three independent slots,
 * so the tick's single "main" decision is never silently eaten:
 *  - 'item': item actives, resolved in their own phase ahead of the ability
 *    they set up (see resolveItemActivesPhase) — this is what makes
 *    blink→stun→nuke reachable inside one 4s tick.
 *  - the out-of-band verbs, one slot each: picking a talent used to overwrite a
 *    queued cast, because everything shared a single latest-wins slot.
 *  - 'main': move/attack/cast/buy/… — still exactly one per tick.
 */
function actionSlot(command: Command): string {
  if (command.type === 'use') return 'item'
  if (
    command.type === 'buyback' ||
    command.type === 'surrender' ||
    command.type === 'select_talent'
  ) {
    return command.type
  }
  return 'main'
}

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

// ── Farm tracking ──────────────────────────────────────────────
// Last hits and denies — the two numbers a new MOBA player watches improve, and
// the only scoreboard columns the engine never produced.

export interface PlayerFarm {
  lastHits: number
  denies: number
}

/** gameId -> playerId -> farm tally for the whole match. */
const gameFarm = new Map<string, Map<string, PlayerFarm>>()

/**
 * Tally farm off the emitted events rather than off a counter beside the gold
 * award. The two `creep_*` events fire exactly where the reward lands (past the
 * resolver's HP window, team and index checks), so a tally derived from them
 * cannot disagree with the "+38g last-hit" lines the player actually watched go
 * by — which is the whole point of showing them the number.
 */
function tallyFarm(gameId: string, events: GameEngineEvent[]): void {
  let game = gameFarm.get(gameId)
  for (const e of events) {
    if (e._tag !== 'creep_lasthit' && e._tag !== 'creep_deny') continue
    if (!game) {
      game = new Map()
      gameFarm.set(gameId, game)
    }
    let farm = game.get(e.playerId)
    if (!farm) {
      farm = { lastHits: 0, denies: 0 }
      game.set(e.playerId, farm)
    }
    if (e._tag === 'creep_lasthit') farm.lastHits++
    else farm.denies++
  }
}

/** Match-to-date farm for every player who has landed one, keyed by playerId. */
export function getFarmStats(gameId: string): Record<string, PlayerFarm> {
  const out: Record<string, PlayerFarm> = {}
  for (const [playerId, farm] of gameFarm.get(gameId) ?? []) {
    out[playerId] = { ...farm }
  }
  return out
}

/** Submit an action for the current tick (single-instance, in-process queue). */
export function submitAction(gameId: string, playerId: string, command: Command): void {
  let queue = gameActionQueues.get(gameId)
  if (!queue) {
    queue = []
    gameActionQueues.set(gameId, queue)
  }
  const slot = actionSlot(command)
  const existing = queue.findIndex((a) => a.playerId === playerId && actionSlot(a.command) === slot)
  if (existing >= 0) {
    const dropped = queue[existing]!.command.type
    engineLog.debug('Action overwritten in same tick', {
      gameId,
      playerId,
      slot,
      dropped,
      replacedWith: command.type,
    })
    queue[existing] = { playerId, command }
  } else {
    queue.push({ playerId, command })
  }
}

/** Whether a player already has a command of this type queued for the tick. */
function hasQueuedCommand(gameId: string, playerId: string, type: Command['type']): boolean {
  return (
    gameActionQueues.get(gameId)?.some((a) => a.playerId === playerId && a.command.type === type) ??
    false
  )
}

/** Drain all queued actions for a game (single-instance, in-process queue). */
function drainActions(gameId: string): PlayerAction[] {
  const local = gameActionQueues.get(gameId) ?? []
  gameActionQueues.set(gameId, [])
  return local
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
  /** Coaching lines to push to a player this tick (tutorial guidance). */
  notices: Array<{ playerId: string; message: string }>
  /** All actions drained this tick — exposed so callers can persist them. */
  actions: PlayerAction[]
}> {
  return Effect.gen(function* () {
    // ensureAncients backfills `ancients` on states created before the
    // Ancient existed (resumed snapshots, older fixtures).
    let currentState: GameState = ensureAncients({ ...state, tick: state.tick + 1, events: [] })
    const allEvents: GameEngineEvent[] = []
    const rejectedActions: Array<{ playerId: string; reason: string }> = []
    const notices: Array<{ playerId: string; message: string }> = []

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
        // An AFK-converted human may have queued a surrender vote via WS this
        // tick. The vote now holds its own queue slot, but the bot decision is
        // still skipped: a hero being driven by AI while its human is voting to
        // end the match should not also be charging into a fight.
        if (hasQueuedCommand(gameId, botId, 'surrender')) continue
        const command = decideBotAction(currentState, bot, getBotLane(gameId, botId), gameId)
        if (command) {
          submitAction(gameId, botId, command)
        }
      }
    }

    // 1. Collect all player actions from queue
    const actions = drainActions(gameId)

    // 1.2. Mark players as active when they take actions. A deliberate
    // non-move order also cancels any queued auto-path walk (a new intent
    // replaces the old one); moves replace the destination inside the
    // resolver, and out-of-band verbs (surrender vote, talent pick, buyback)
    // don't interrupt walking. The standing attack order is dropped by the same
    // rule, against its own exception set.
    for (const action of actions) {
      markPlayerActiveSafe(gameId, action.playerId)
      const actor = currentState.players[action.playerId]
      if (actor) {
        const cancelsWalk = !KEEPS_AUTOPATH.has(action.command.type) && actor.moveTarget != null
        const cancelsAttack = !KEEPS_ATTACK.has(action.command.type) && actor.attackTarget != null
        currentState = {
          ...currentState,
          players: {
            ...currentState.players,
            [action.playerId]: {
              ...actor,
              lastActionTick: currentState.tick,
              ...(cancelsWalk ? { moveTarget: null } : {}),
              ...(cancelsAttack ? { attackTarget: null } : {}),
            },
          },
        }
      }
    }

    // 1.3. Standing-order continuation — players with a queued destination or
    // attack target and no explicit order this tick keep walking / keep
    // swinging, through the normal validate/resolve pipeline (so root, stun and
    // taunt still gate them). Added AFTER the activity stamping above: a
    // continuation is not player activity, and AFK detection must still see an
    // idle human as idle.
    //
    // An item active does NOT count as having acted: it resolves from its own
    // slot, so spending it must not silently cost the walk or the auto-attack
    // it was bought to enable.
    const actedThisTick = new Set(
      actions.filter((a) => a.command.type !== 'use').map((a) => a.playerId),
    )
    for (const [pid, p] of Object.entries(currentState.players)) {
      if (!p.alive || !p.moveTarget || actedThisTick.has(pid)) continue
      actions.push({
        playerId: pid,
        command: { type: 'move', zone: p.moveTarget },
        synthesized: true,
      })
      actedThisTick.add(pid)
    }
    // Walking wins over swinging: a hero mid-route is not standing in the zone
    // its old target was in (and the two orders are mutually exclusive anyway —
    // each cancels the other in 1.2).
    for (const [pid, p] of Object.entries(currentState.players)) {
      if (!p.alive || !p.attackTarget || actedThisTick.has(pid)) continue
      actions.push({
        playerId: pid,
        command: { type: 'attack', target: p.attackTarget },
        synthesized: true,
      })
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
      } else if (!action.synthesized) {
        // Synthesized auto-path continuations fail silently: a rooted walker
        // would otherwise get "Cannot move while rooted" warnings every tick
        // for an order they issued long ago. The walk resumes when the
        // disable expires (moveTarget persists).
        rejectedActions.push({ playerId: action.playerId, reason: error })
      }
    }

    // 3. Resolve actions via ActionResolver
    const preIce = currentState.ice
    const resolved = yield* resolveActions(currentState, validActions)
    currentState = resolved.state
    allEvents.push(...resolved.events)
    // Casts/moves that failed inside resolution (mana, bad target, slow)
    // reach onActionRejected player feedback through the same channel as
    // validation failures.
    rejectedActions.push(...resolved.rejected)

    // 3.4. Advance the tutorial if the human performed the verb this step
    // teaches, or if the step outlasted its deadline (no-op in normal games).
    // Uses validation-accepted actions minus any the resolver then rejected, so
    // a failed cast doesn't count.
    {
      const advanced = advanceTutorialAfterTick(currentState, validActions, resolved.rejected)
      const graduated =
        currentState.mode === 'tutorial' &&
        (currentState.tutorialStep ?? 0) < TUTORIAL_STEP_COUNT &&
        (advanced.state.tutorialStep ?? 0) >= TUTORIAL_STEP_COUNT
      currentState = advanced.state
      const humanId = Object.keys(currentState.players).find((id) => !isBot(id))
      if (advanced.notice && humanId) {
        notices.push({ playerId: humanId, message: advanced.notice })
      }
      // Graduating used to drop the player into the app's worst state: the
      // scripted hints stop, the banner says "you're in free play", and they are
      // left in an endless 2v2 with no menu and — because SURRENDER_MIN_TICK is
      // 225 (15 min) and the tutorial ends around tick 60 — no way to quit for
      // another ~11 minutes. Closing the tab was the only real option. End the
      // game on graduation instead: the win block below preserves an
      // already-set winner, so onGameOver fires exactly as an Ancient kill
      // would and the player lands on the post-game screen.
      const team = humanId ? currentState.players[humanId]?.team : undefined
      if (graduated && team) {
        currentState = { ...currentState, phase: 'ended', winner: team }
        if (humanId) {
          notices.push({
            playerId: humanId,
            message: "🎓 That's the basics — practice complete. Here's how it went.",
          })
        }
      }
    }

    // 3.5. Track ice kills and update team stats
    currentState = trackIceKills(currentState, preIce, allEvents)

    // 3.6. Apply inCombat buffs based on damage events
    currentState = applyInCombatBuffs(currentState, resolved.events)

    // 3.65. Detonate Socket traps on enemies now standing in trapped zones
    // (after movement resolved). Damage events feed kill/assist credit below.
    const trapResult = processTraps(currentState)
    currentState = trapResult.state
    allEvents.push(...trapResult.events)

    // 3.7. Expire harden invulnerability
    currentState = expireGlyph(currentState)

    // 4–5.6. NPC AI (creeps, neutrals, ice, Tenant)
    const npcResult = runNPCAI(currentState, {
      heroAttackers: resolved.heroAttackers,
      priorEvents: allEvents,
    })
    currentState = npcResult.state
    allEvents.push(...npcResult.events)

    // 5.65. Being shot by a ice, a creep wave or a jungle camp is combat too —
    // it must gate fountain regen and the "out of combat" item passives exactly
    // as a hero attack does. Runs a second time (step 3.6 only sees the hero
    // phase, which resolves before NPCs act); the buff refresh is idempotent.
    currentState = applyInCombatBuffs(currentState, npcResult.events)

    // 5.7. Recompute Ancient vulnerability after all ice damage this tick
    // (hero attacks in resolveActions + creep attacks in NPC AI).
    currentState = updateAncientVulnerability(currentState)

    // 6–7. Spawn waves / neutrals / caches; expire caches + wards
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
      if (e.type === 'teleport_complete') {
        allEvents.push({
          _tag: 'teleport_complete',
          tick: e.tick,
          playerId: e.payload.playerId as string,
          destination: e.payload.destination as string,
          ...(e.payload.source ? { source: e.payload.source as 'return' | 'next_hop' } : {}),
        })
      } else if (e.type === 'ability_used' && e.payload.effect === 'dmz_explosion') {
        // Firewall DMZ explosion mutates enemy HP inside tickAllBuffs but only
        // authors a wire ability_used event. Bridge its per-victim HP loss into
        // the _tag/allEvents damage channel (BEFORE trackHeroDamage/handleDeaths
        // below) so the blast yields kill credit, assists, bounty, and triggers
        // the victims' damage_taken passives — same as any other damage source.
        const casterId = e.payload.playerId as string
        const victims = (e.payload.victims as { id: string; amount: number }[] | undefined) ?? []
        for (const v of victims) {
          if (v.amount > 0) {
            allEvents.push({
              _tag: 'damage',
              tick: e.tick,
              sourceId: casterId,
              targetId: v.id,
              amount: v.amount,
              damageType: 'magical',
            })
          }
        }
      }
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
      yield* Effect.logInfo('Win condition met').pipe(Effect.annotateLogs({ gameId, winner }))
    }

    // 13.1. Test-mode progress monitor. Only when the fast-game hook is active
    // (dev/test, never production) and every 25 ticks, log how the game is
    // converging toward an Ancient kill — ice standing per team and Ancient
    // HP/vulnerability — so a watcher can see whether games end on time.
    if (fastGameFactor() > 1 && currentState.tick % 25 === 0) {
      const iceUp = (team: string) =>
        currentState.ice.filter((t) => t.team === team && t.alive).length
      const anc = currentState.ancients
      engineLog.info('📊 Game progress', {
        gameId,
        tick: currentState.tick,
        ice: `R${iceUp('chaff')}:D${iceUp('audit')}`,
        chaffAncient: `${anc?.chaff.hp ?? '?'}${anc?.chaff.vulnerable ? '!' : ''}`,
        auditAncient: `${anc?.audit.hp ?? '?'}${anc?.audit.vulnerable ? '!' : ''}`,
        winner: winner ?? 'none',
      })
    }

    // 13.5. Progress day/night cycle
    const dayNight = progressDayNight(currentState)
    currentState = dayNight.state
    allEvents.push(...dayNight.events)

    // 13.5. AFK takeover — every 60 ticks, replace any human who has stopped
    // acting (past the AFK threshold) with a bot so their team isn't left a
    // player down. convertToBot adds them to the bot roster, so the driver at
    // the top of this pipeline issues their actions from next tick; we flag the
    // slot `aiControlled` for the UI and emit an afk_takeover event. No-reclaim:
    // the WS action path drops a reconnecting human's input via isGameBot, and
    // detectAFKPlayers skips aiControlled slots so this fires exactly once.
    if (currentState.tick % 60 === 0) {
      for (const afk of detectAFKPlayers(currentState)) {
        const player = currentState.players[afk.playerId]
        if (!player) continue
        // Presence gate: "no game action for 2 min" alone false-positives on a
        // player who is at the screen but between actions (reading the shop,
        // watching a fight). A connected player is only converted after the
        // longer silence window, and only when a human teammate benefits.
        const convert = shouldConvertAFK(currentState, afk.playerId, {
          isConnected: getPeer(afk.playerId) !== undefined,
          msSinceInput: msSinceClientInput(gameId, afk.playerId),
        })
        if (!convert || !convertToBot(gameId, afk.playerId)) continue
        currentState = {
          ...currentState,
          players: {
            ...currentState.players,
            [afk.playerId]: { ...player, aiControlled: true },
          },
        }
        allEvents.push({
          _tag: 'afk_takeover',
          tick: currentState.tick,
          playerId: afk.playerId,
          heroId: player.heroId,
          team: player.team,
          message: 'went AFK — a bot has taken over',
        })
      }
    }

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

    tallyFarm(gameId, allEvents)

    return { state: currentState, events: allEvents, rejectedActions, notices, actions }
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
  /**
   * `farm` is handed over rather than looked up by the callback: the loop
   * interrupts (and its finalizer drops the per-game maps) the moment this
   * returns, so an async consumer that read it after its first `await` would
   * find nothing.
   */
  onGameOver: (gameId: string, winner: TeamId, farm: Record<string, PlayerFarm>) => void
  onActionRejected?: (gameId: string, playerId: string, reason: string) => void
  /**
   * Coaching line for one player — currently tutorial guidance (a step timing
   * out, or a step not yet satisfied). Distinct from onActionRejected: nothing
   * went wrong, the game is teaching. Optional.
   */
  onNotice?: (gameId: string, playerId: string, message: string) => void
  /**
   * Fires once when the human player finishes the last tutorial step. Optional —
   * the plugin persists it (players.tutorialCompleted) so the client funnel can
   * stop routing returning players to practice. Skipped if not set.
   */
  onTutorialCompleted?: (gameId: string, playerId: string) => void
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
          clearGameSentStates(gameId)
          callbacks.onGameOver(gameId, winner, getFarmStats(gameId))
        } catch (err) {
          engineLog.warn('onGameOver (out-of-band end) failed', { gameId, error: String(err) })
        }
      }
      return yield* Effect.interrupt
    }

    const tickStart = performance.now()
    const {
      state: newState,
      events,
      rejectedActions,
      notices,
      actions,
    } = yield* processTick(gameId, currentState)
    // Observability: warn when a tick's engine work eats into the schedule
    // budget (>50% of the interval). Sustained breaches are what push
    // Schedule.fixed into its running-behind regime (a slowed game clock) — this
    // is the early signal that the "~N games per instance" ceiling is being hit.
    const tickMs = performance.now() - tickStart
    if (tickMs > TICK_DURATION_MS * 0.5) {
      engineLog.warn('Slow tick', {
        gameId,
        tick: currentState.tick,
        tickMs: Math.round(tickMs),
        budgetMs: TICK_DURATION_MS,
        players: Object.keys(currentState.players).length,
      })
    }
    yield* stateManager.updateState(gameId, () => newState)

    // Tutorial completion: processTick advanced the human past the last scripted
    // step → fire the callback (the plugin persists players.tutorialCompleted) so
    // the client funnel stops routing this player to practice. Detected here, not
    // in processTick, because only the loop fiber holds the callbacks handle.
    if (
      callbacks.onTutorialCompleted &&
      (currentState.tutorialStep ?? 0) < TUTORIAL_STEP_COUNT &&
      (newState.tutorialStep ?? 0) >= TUTORIAL_STEP_COUNT
    ) {
      const humanId = Object.keys(newState.players).find((id) => !isBot(id))
      if (humanId) {
        try {
          callbacks.onTutorialCompleted(gameId, humanId)
        } catch {
          // Non-critical — a persistence failure just leaves the funnel as-is.
        }
      }
    }

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

    // Send tutorial coaching lines
    if (callbacks.onNotice) {
      for (const notice of notices) {
        try {
          callbacks.onNotice(gameId, notice.playerId, notice.message)
        } catch {
          // Non-critical — don't let feedback failures affect the game loop
        }
      }
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

    // Persist a leaver record (best-effort, Redis) for each AFK takeover this
    // tick performed. Driven off the emitted event so it fires exactly once per
    // player: processTick owns the detection + bot swap; the fiber owns the
    // Redis write (processTick has no Redis handle).
    for (const event of events) {
      if (event._tag !== 'afk_takeover') continue
      recordLeaverSafe(event.playerId, gameId, newState, 'afk', redis)
      engineLog.warn('AFK player replaced by bot', { gameId, playerId: event.playerId })
    }

    // Periodic state snapshot (best-effort; failures don't break the loop).
    // Forked so a slow Redis write doesn't block tick broadcast.
    if (redis && newState.tick % SNAPSHOT_EVERY_N_TICKS === 0) {
      yield* Effect.forkDaemon(writeSnapshot(redis, gameId, newState, snapshotMeta))
    }

    // Broadcast filtered state to each player — delta-compressed: only fields
    // that changed since the last tick are sent (saves ~60% WS bandwidth on
    // idle ticks where only `tick` + `players` change).
    for (const playerId of Object.keys(newState.players)) {
      if (isBot(playerId)) continue
      const fullState = filterStateForPlayer(newState, playerId, gameId)
      const delta = computeDelta(fullState, getSentState(gameId, playerId))
      try {
        callbacks.onTickState(gameId, playerId, delta as PlayerVisibleState)
        recordSentState(gameId, playerId, fullState)
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

    // Check win — phase is set to 'ended' by processTick (ice or surrender)
    if (newState.phase === 'ended') {
      const winner = newState.winner ?? checkWinCondition(newState)
      if (winner) {
        // Close the replay out. Snapshots are periodic, so 14 games in 15 ended
        // between writes and the replay endpoint — which requires a snapshot
        // with `phase === 'ended'` — 403'd on the [WATCH REPLAY] link this
        // screen is about to offer. Awaited, not forked: the fiber is
        // interrupted two lines down, and writeSnapshot swallows its own errors.
        if (redis && newState.tick % SNAPSHOT_EVERY_N_TICKS !== 0) {
          yield* writeSnapshot(redis, gameId, newState, snapshotMeta)
        }
        clearGameSentStates(gameId)
        callbacks.onGameOver(gameId, winner, getFarmStats(gameId))
      }
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
        gameFarm.delete(gameId)
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

/** Stop a running game loop. */
export function stopGameLoop(gameId: string): Effect.Effect<void> {
  return Effect.gen(function* () {
    const fiber = activeGames.get(gameId)
    if (fiber) {
      activeGames.delete(gameId)
      yield* Fiber.interrupt(fiber)
    }
    gameActionQueues.delete(gameId)
    recentHeroDamage.delete(gameId)
    gameFarm.delete(gameId)
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
            const winner = player.team === 'chaff' ? 'audit' : 'chaff'
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
        const talentTree = getTalentTree(player.heroId)
        if (talentTree) {
          const tierKey = `tier${action.command.tier}` as keyof typeof player.talents
          const selectedTalentId = action.command.talentId

          const tierTalents = talentTree.tiers[action.command.tier]
          const isValidTalent = tierTalents.some((t) => t.id === selectedTalentId)
          const alreadySelected = player.talents[tierKey] !== null
          // The tier NUMBER is an identity, not a level requirement — read the
          // unlock level from the balance table (see TALENT_UNLOCK_LEVEL).
          const requiredLevel = talentUnlockLevel(action.command.tier)

          if (isValidTalent && !alreadySelected && player.level >= requiredLevel) {
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
                  ? `Requires level ${requiredLevel}`
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
 *   daemon), item_used (daemon), damage_taken (cache/firewall/proxy),
 *   move (mutex/traceroute), kill (null_ref),
 *   tick_end (cron/mutex/daemon/kernel/malloc/sentry/firewall/proxy).
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
 * Run all NPC AIs (creeps, neutrals, ice, Tenant) and apply their actions.
 *
 * Ice AI needs `heroAttackers` from the prior `resolveActions` step so it
 * can prioritize heroes that recently attacked allies. Tenant damage is
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
  const neutralResult = applyNeutralActions(s, runNeutralAI(s))
  s = neutralResult.state
  events.push(...neutralResult.events)

  // ICE — priorEvents lets ice aggro heroes that attacked them this tick
  const iceResult = applyIceActions(s, runIceAI(s, ctx.heroAttackers, ctx.priorEvents))
  s = iceResult.state
  events.push(...iceResult.events)

  // Tenant attacks
  for (const action of runTenantAI(s)) {
    const target = s.players[action.targetId]
    if (target && target.alive) {
      // Route through the shared mitigation chain so Tenant hits honor item
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
        sourceId: 'tenant',
        targetId: action.targetId,
        amount: hit.damageDealt,
        damageType: 'physical',
      })
    }
  }

  // Tenant damage tally — sum hero damage on tenant from prior + new events.
  const tenantDamage = new Map<string, number>()
  for (const event of [...ctx.priorEvents, ...events]) {
    if (event._tag === 'damage' && event.targetId === 'tenant') {
      tenantDamage.set(event.sourceId, (tenantDamage.get(event.sourceId) ?? 0) + event.amount)
    }
  }
  const tenantResult = processTenantDamage(s, tenantDamage)
  s = tenantResult.state
  // processTenantDamage keeps events OFF state.events — merge them here so they
  // flow into allEvents via runNPCAI's return (single-source, no state.events
  // mutation, no as-unknown-as casts).
  events.push(...tenantResult.events)

  return { state: s, events }
}

/**
 * Spawn periodic content for the tick: creep waves, jungle neutrals, caches;
 * and clean up expired caches and wards. Pure: same state object if nothing
 * spawned and nothing expired.
 */
export function runSpawning(state: GameState): GameState {
  let s = state
  // Gate creep/neutral/cache spawning to the zones THIS game's map actually has,
  // so subset maps (one-lane) don't spawn into uninitialized top/bot/jungle zones.
  const hasZone = (zoneId: string) => zoneId in s.zones

  const newCreeps = spawnCreepWaves(s.tick, hasZone)
  if (newCreeps.length > 0) {
    s = { ...s, creeps: [...s.creeps, ...newCreeps] }
  }

  // Defensive cap: never let creeps stack unboundedly in a zone
  s = enforceCreepZoneCap(s)

  const newNeutrals = spawnNeutralCreeps(s.tick, hasZone, s.neutrals ?? [])
  if (newNeutrals.length > 0) {
    s = { ...s, neutrals: [...(s.neutrals ?? []), ...newNeutrals] }
  }

  const activeCacheZones = new Set<string>((s.caches ?? []).map((r) => r.zone))
  const newCaches = spawnCaches(s.tick, hasZone, activeCacheZones)
  if (newCaches.length > 0) {
    s = { ...s, caches: [...(s.caches ?? []), ...newCaches] }
  }

  s = removeExpiredCaches(s)
  s = processCacheBuffs(s)

  const updatedZones = removeExpiredWards(s.zones, s.tick)
  if (updatedZones !== s.zones) {
    s = { ...s, zones: updatedZones }
  }

  return s
}

/**
 * Drop ice invulnerability for any team whose harden effect has expired.
 * Pure: returns a new state if anything changed, the same state otherwise.
 */
export function expireGlyph(state: GameState): GameState {
  const chaffUsed = state.teams.chaff.hardenUsedTick
  const auditUsed = state.teams.audit.hardenUsedTick
  const chaffExpired = chaffUsed !== null && state.tick - chaffUsed >= HARDEN_DURATION_TICKS
  const auditExpired = auditUsed !== null && state.tick - auditUsed >= HARDEN_DURATION_TICKS

  if (!chaffExpired && !auditExpired) return state

  return {
    ...state,
    ice: state.ice.map((t) => {
      if (t.team === 'chaff' && chaffExpired) return { ...t, invulnerable: false }
      if (t.team === 'audit' && auditExpired) return { ...t, invulnerable: false }
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
      const spawnZone = player.team === 'chaff' ? 'chaff-fountain' : 'audit-fountain'
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
      (player.team === 'chaff' && player.zone === 'chaff-fountain') ||
      (player.team === 'audit' && player.zone === 'audit-fountain')

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
      if (player.buffs.some((b) => b.id === 'backup')) {
        players[pid] = {
          ...player,
          alive: true,
          hp: player.maxHp,
          mp: player.maxMp,
          buffs: player.buffs.filter((b) => b.id !== 'backup'),
          // Death cancels the standing orders on this branch too — an backup
          // revive must not resume marching into, or swinging at, whoever just
          // killed you.
          moveTarget: null,
          attackTarget: null,
        }
        events.push({
          _tag: 'backup_used',
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
        // Death cancels any queued standing order — respawning at the fountain
        // with a stale destination would march the hero straight back out, and
        // a stale attack target would re-open the fight that just killed them.
        moveTarget: null,
        attackTarget: null,
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
        // The bounty is streak- and comeback-scaled, and the assist share is
        // split N ways — so the reported amounts are read back off the gold diff
        // rather than recomputed here, where they could drift from awardKill.
        const goldBefore = new Map<string, number>(
          [killerId, ...assisters].map((id): [string, number] => [id, players[id]?.gold ?? 0]),
        )
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

        // Award XP for hero kill to killer. The killer's team earns a comeback
        // multiplier from the average team level gap (xpComebackMultiplier), so a
        // team behind in levels catches up instead of snowballing further — the
        // XP mirror of the gold comeback bounty applied in awardKill above.
        const victim = players[pid]!
        const killerForXp = players[killerId]!
        const xpMult = xpComebackMultiplier({ ...state, players }, killerForXp.team)
        const killXp = Math.round(
          (HERO_KILL_XP_BASE + HERO_KILL_XP_PER_LEVEL * victim.level) * xpMult,
        )
        players[killerId] = { ...killerForXp, xp: killerForXp.xp + killXp }

        // Award assisters a fraction of the kill XP (ASSIST_XP_RATIO). Derived
        // from the already-adjusted killXp, so assisters share the comeback too.
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

        // …and what it paid. Pushed after the kill line so the feed reads
        // "X terminated Y" then "You earned 240g". These reasons deliberately
        // avoid the words the client suppresses as farming noise.
        for (const [id, before] of goldBefore) {
          const gained = (players[id]?.gold ?? 0) - before
          if (gained > 0) {
            events.push({
              _tag: 'gold_change',
              tick: state.tick,
              playerId: id,
              amount: gained,
              reason: id === killerId ? 'hero kill' : 'assist',
            })
          }
        }
      }

      changed = true
    }
  }

  // Backup expiry sweep: tickBuffs preserves the backup buff at ticksRemaining ===
  // 0 so the death loop above can proc it. If the player survived this tick
  // (no death → no backup consumption), remove the expired backup now so it
  // doesn't linger as a stale buff.
  for (const [pid, player] of Object.entries(players)) {
    if (player.alive && player.buffs.some((b) => b.id === 'backup' && b.ticksRemaining <= 0)) {
      players[pid] = {
        ...player,
        buffs: player.buffs.filter((b) => !(b.id === 'backup' && b.ticksRemaining <= 0)),
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
      buffs[existing] = { ...buffs[existing]!, ticksRemaining: IN_COMBAT_BUFF_DURATION }
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

/** Track ice kills by comparing pre-tick and post-tick ice state. */
function trackIceKills(
  state: GameState,
  preIce: GameState['ice'],
  events: GameEngineEvent[],
): GameState {
  let teams = { ...state.teams }
  let changed = false

  for (let i = 0; i < state.ice.length; i++) {
    const before = preIce[i]
    const after = state.ice[i]
    if (before && after && before.alive && !after.alive) {
      // Ice was destroyed — the killing team is the opposing team
      const killerTeam = after.team === 'chaff' ? 'audit' : 'chaff'
      const teamState = teams[killerTeam]
      teams = {
        ...teams,
        [killerTeam]: { ...teamState, iceKills: teamState.iceKills + 1 },
      }

      events.push({
        _tag: 'ice_kill',
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
 * Ancient becomes attackable once any of its team's T3 ice is down —
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
