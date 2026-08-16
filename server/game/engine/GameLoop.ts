import { Effect } from 'effect'
import type { GameEvent, GameState, TeamId } from '~~/shared/types/game'
import type { Command } from '~~/shared/types/commands'
import {
  RESPAWN_BASE_CYCLES,
  RESPAWN_PER_LEVEL_CYCLES,
  RESPAWN_FREE_LEVELS,
  FOUNTAIN_HEAL_PER_CYCLE_PERCENT,
  FOUNTAIN_BW_PER_CYCLE_PERCENT,
  XP_PER_LEVEL,
  MAX_LEVEL,
  HERO_KILL_XP_BASE,
  HERO_KILL_XP_PER_LEVEL,
  ASSIST_XP_RATIO,
  POWER_SPIKE_LEVELS,
  IN_COMBAT_BUFF_DURATION,
  DAY_DURATION_CYCLES,
  NIGHT_DURATION_CYCLES,
  HARDEN_DURATION_CYCLES,
} from '~~/shared/constants/balance'
import { scaledRespawnTicks, fastGameFactor } from './fastGame'
import { resolveActions, validateAction, type PlayerAction } from './ActionResolver'
import {
  advanceTutorialAfterTick,
  tutorialMasteryAchieved,
  TUTORIAL_STEP_COUNT,
} from '~~/server/game/modes/tutorial'
import { distributePassiveScrip, awardKill, xpComebackMultiplier } from './ScripDistributor'
import { runWaveAI, applyWaveActions, enforceWaveZoneCap } from './WaveAI'
import { ensureTerminals, updateTerminalVulnerability, checkTerminalWin } from './TerminalSystem'
import { runIceAI, applyIceActions } from './IceAI'
import { runTenantAI, processTenantDamage } from './TenantAI'
import { removeExpiredCaches, processCacheBuffs } from './CacheAI'
import { processTraps } from './TrapSystem'
import { resolveKineticHit } from './CombatResolver'
import { spawnWaveUnits, spawnCaches } from '~~/server/game/map/spawner'
import { spawnSiltDwellers, runNeutralAI, applyNeutralActions } from './NeutralAI'
import { removeExpiredWards } from '~~/server/game/map/zones'
import { mix, mulberry32, hashStringToSeed } from './rng'
// Importing from '~~/server/game/heroes' (not '../heroes/_base') guarantees every hero's
// registerHero() side effect has run before the first tick resolves a cast.
import {
  levelUpHero,
  processDoTs,
  cycleAllBuffs,
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
import { escalateRejection } from './rejectionEscalation'

// ── Action queue per game ──────────────────────────────────────

/** Command verbs that do NOT cancel an in-progress auto-path walk: a new move
 *  replaces the destination in the resolver, and the out-of-band verbs resolve
 *  without expressing a new positional intent. */
const KEEPS_AUTOPATH = new Set(['move', 'surrender', 'select_talent', 'buyback'])

/** Command verbs that do NOT cancel a standing attack order: a new attack
 *  replaces the target in the resolver, an item active is a free action from
 *  its own slot, and the out-of-band verbs express no new target intent.
 *  Keeping `attack` here is also what lets a last hit interrupt a breach without
 *  ending it — a wave swing sets no order of its own, so the ice you were
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
 *  - 'main': move/attack/cast/buy/… — still exactly one per cycle.
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
    victimMap.set(e.sourceId, state.cycle)
  }
  // Prune contributions older than the window
  for (const [victimId, victimMap] of game) {
    for (const [attackerId, tick] of victimMap) {
      if (state.cycle - tick > ASSIST_WINDOW_TICKS) victimMap.delete(attackerId)
    }
    if (victimMap.size === 0) game.delete(victimId)
  }
}

function getDamageContributors(gameId: string, victimId: string): string[] {
  return [...(recentHeroDamage.get(gameId)?.get(victimId)?.keys() ?? [])]
}

// ── Farm tracking ──────────────────────────────────────────────
// Last hits and burns — the two numbers a new MOBA player watches improve, and
// the only scoreboard columns the engine never produced.

export interface PlayerFarm {
  lastHits: number
  burns: number
}

/** gameId -> playerId -> farm tally for the whole match. */
const gameFarm = new Map<string, Map<string, PlayerFarm>>()

/**
 * Tally farm off the emitted events rather than off a counter beside the scrip
 * award. The two `creep_*` events fire exactly where the reward lands (past the
 * resolver's INTEG window, team and index checks), so a tally derived from them
 * cannot disagree with the "+38g last-hit" lines the player actually watched go
 * by — which is the whole point of showing them the number.
 */
/**
 * Tally farm off the emitted events. Writes BOTH the in-process Map (so
 * getFarmStats stays the cheap per-game lookup tests use) AND PlayerState
 * lastHits/burns (the numbers that survive a serverless tick landing on a
 * fresh instance — they ride in the live_games jsonb).
 */
function tallyFarm(gameId: string, state: GameState, events: GameEngineEvent[]): GameState {
  const deltas = new Map<string, PlayerFarm>()
  for (const e of events) {
    if (e._tag !== 'wave_strip' && e._tag !== 'wave_burn') continue
    const d = deltas.get(e.playerId) ?? { lastHits: 0, burns: 0 }
    if (e._tag === 'wave_strip') d.lastHits++
    else d.burns++
    deltas.set(e.playerId, d)
  }
  if (deltas.size === 0) return state

  let game = gameFarm.get(gameId)
  if (!game) {
    game = new Map()
    gameFarm.set(gameId, game)
  }
  const players = { ...state.players }
  for (const [playerId, d] of deltas) {
    const prev = game.get(playerId) ?? { lastHits: 0, burns: 0 }
    game.set(playerId, { lastHits: prev.lastHits + d.lastHits, burns: prev.burns + d.burns })
    const p = players[playerId]
    if (!p) continue
    players[playerId] = {
      ...p,
      lastHits: (p.lastHits ?? 0) + d.lastHits,
      burns: (p.burns ?? 0) + d.burns,
    }
  }
  return { ...state, players }
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
function enqueueAction(
  gameId: string,
  playerId: string,
  command: Command,
  synthesized = false,
): { slot: string; replaced: boolean } {
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
    queue[existing] = { playerId, command, ...(synthesized ? { synthesized: true } : {}) }
    return { slot, replaced: true }
  }
  queue.push({ playerId, command, ...(synthesized ? { synthesized: true } : {}) })
  return { slot, replaced: false }
}

/** Submit a player's order for the open cycle. Returns which slot it landed in
 * and whether it replaced an earlier order in that slot — the WS layer echoes
 * both back to the player as `action_ack`. */
export function submitAction(
  gameId: string,
  playerId: string,
  command: Command,
): { slot: string; replaced: boolean } {
  return enqueueAction(gameId, playerId, command)
}

/** Replay ingress preserves whether the original action was synthesized. */
export function submitReplayAction(
  gameId: string,
  playerId: string,
  command: Command,
  synthesized = false,
): void {
  enqueueAction(gameId, playerId, command, synthesized)
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
export function processCycle(
  gameId: string,
  state: GameState,
): Effect.Effect<{
  state: GameState
  events: GameEngineEvent[]
  rejectedActions: Array<{ playerId: string; reason: string }>
  /** Coaching lines to push to a player this cycle (tutorial guidance). */
  notices: Array<{ playerId: string; message: string }>
  /** All actions drained this cycle — exposed so callers can persist them. */
  actions: PlayerAction[]
}> {
  return Effect.gen(function* () {
    // ensureTerminals backfills `terminals` on states created before the
    // Terminal existed (resumed snapshots, older fixtures).
    let currentState: GameState = ensureTerminals({ ...state, cycle: state.cycle + 1, events: [] })
    const allEvents: GameEngineEvent[] = []
    const rejectedActions: Array<{ playerId: string; reason: string }> = []
    const notices: Array<{ playerId: string; message: string }> = []

    // THE BATCH CLOCK IS CANON: resolution must be deterministic given the same
    // state+actions, so every random draw this cycle (crits, procs, neutral/cache
    // spawn rolls — never bot AI, which is an INPUT, recorded and re-fed on
    // replay) comes from one rng derived from the per-game seed mixed with the
    // cycle number. Explicit parameter, not a module-level "current rng" —
    // game fibers interleave. Older states without a stamped rngSeed (pre-seed
    // snapshots) fall back to a stable hash of the gameId.
    const rngSeed = currentState.rngSeed ?? hashStringToSeed(gameId)
    const rng = mulberry32(mix(rngSeed, currentState.cycle))

    // Third-identical-rejection escalation (tutorial lock messages are
    // teaching, not failure — excluded inside the helper).
    const escalate = (playerId: string, reason: string) =>
      escalateRejection(gameId, currentState.mode, playerId, reason)

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
      if (!bot) continue
      // Alive bots skip the AI turn if a surrender vote is already queued for
      // this cycle (AFK-converted humans voting to end should not also charge).
      // Dead bots still run decideBotAction so tryBuyback can fire — the old
      // `if (bot.alive)` gate made buyback unreachable forever.
      if (bot.alive && hasQueuedCommand(gameId, botId, 'surrender')) continue
      const command = decideBotAction(currentState, bot, getBotLane(gameId, botId), gameId)
      if (command) {
        submitAction(gameId, botId, command)
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
              lastActionCycle: currentState.cycle,
              ...(cancelsWalk ? { moveTarget: null } : {}),
              ...(cancelsAttack ? { attackTarget: null } : {}),
            },
          },
        }
      }
    }

    // 1.3. Standing-order continuation — players with a queued destination or
    // attack target and no explicit order this cycle keep walking / keep
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
    rejectedActions.push(
      ...specialResult.rejectedActions.map((r) => ({
        ...r,
        reason: escalate(r.playerId, r.reason),
      })),
    )

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
        // would otherwise get "Cannot move while rooted" warnings every cycle
        // for an order they issued long ago. The walk resumes when the
        // disable expires (moveTarget persists).
        rejectedActions.push({
          playerId: action.playerId,
          reason: escalate(action.playerId, error),
        })
      }
    }

    // 3. Resolve actions via ActionResolver
    const preIce = currentState.ice
    const resolved = yield* resolveActions(currentState, validActions, rng)
    currentState = resolved.state
    allEvents.push(...resolved.events)
    // Casts/moves that failed inside resolution (BW, bad target, slow)
    // reach onActionRejected player feedback through the same channel as
    // validation failures.
    rejectedActions.push(
      ...resolved.rejected.map((r) => ({ ...r, reason: escalate(r.playerId, r.reason) })),
    )

    // 3.4. Advance the tutorial when this tick's ENGINE EVENTS satisfy the
    // current drill's objective (a wave_strip, damage on ICE, a ward placed…)
    // — never merely because the taught command was typed (no-op in normal
    // games). Exhausted deadlines escalate help/nudges inside the module.
    {
      const advanced = advanceTutorialAfterTick(
        currentState,
        validActions,
        resolved.rejected,
        resolved.events,
      )
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
      // left in an endless 2v2 with no menu and — because SURRENDER_MIN_CYCLE is
      // 225 (15 min) and the tutorial ends around tick 60 — no way to quit for
      // another ~11 minutes. Closing the tab was the only real option. End the
      // game on graduation instead: the win block below preserves an
      // already-set winner, so onGameOver fires exactly as a Terminal kill
      // would and the player lands on the post-game screen.
      const team = humanId ? currentState.players[humanId]?.team : undefined
      if (graduated && team) {
        currentState = { ...currentState, phase: 'ended', winner: team }
        if (humanId) {
          notices.push({
            playerId: humanId,
            // An honest graduation: mastery = every drill genuinely performed.
            // With skips the game still ends (never trap the player), but the
            // funnel keeps offering practice — say so.
            message: tutorialMasteryAchieved(currentState)
              ? "🎓 That's the basics — practice complete. Here's how it went."
              : '🎓 Practice over — some drills timed out and were skipped. Run practice again to master them.',
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

    // 4–5.6. NPC AI (waves, neutrals, ice, Tenant)
    const npcResult = runNPCAI(currentState, {
      heroAttackers: resolved.heroAttackers,
      priorEvents: allEvents,
      rng,
    })
    currentState = npcResult.state
    allEvents.push(...npcResult.events)

    // 5.65. Being shot by ice, a wave or a silt dweller is combat too —
    // it must gate fountain regen and the "out of combat" item passives exactly
    // as a hero attack does. Runs a second time (step 3.6 only sees the hero
    // phase, which resolves before NPCs act); the buff refresh is idempotent.
    currentState = applyInCombatBuffs(currentState, npcResult.events)

    // 5.7. Recompute Terminal vulnerability after all ice damage this cycle
    // (hero attacks in resolveActions + wave attacks in NPC AI).
    currentState = updateTerminalVulnerability(currentState)

    // 6–7. Spawn waves / neutrals / caches; expire caches + wards
    currentState = runSpawning(currentState, rng)

    // 8. Distribute passive scrip
    currentState = distributePassiveScrip(currentState)

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
    currentState = cycleAllBuffs(currentState)
    // cycleAllBuffs authors teleport_complete as a wire-format event on
    // state.events, which the client never reads (updateFromCycle ignores it).
    // Bridge those into the _tag/allEvents channel so a completed teleport
    // actually reaches the combat log — mirroring teleport_cancelled, which is
    // already authored as a _tag event in the resolver.
    for (const e of currentState.events.slice(eventsBeforeBuffTick)) {
      if (e.type === 'teleport_complete') {
        allEvents.push({
          _tag: 'teleport_complete',
          cycle: e.cycle,
          playerId: e.payload.playerId as string,
          destination: e.payload.destination as string,
          ...(e.payload.source ? { source: e.payload.source as 'return' | 'next_hop' } : {}),
        })
      } else if (e.type === 'ability_used' && e.payload.effect === 'dmz_explosion') {
        // Firewall DMZ explosion mutates enemy INTEG inside cycleAllBuffs but only
        // authors a wire ability_used event. Bridge its per-victim INTEG loss into
        // the _tag/allEvents damage channel (BEFORE trackHeroDamage/handleDeaths
        // below) so the blast yields kill credit, assists, bounty, and triggers
        // the victims' damage_taken passives — same as any other damage source.
        const casterId = e.payload.playerId as string
        const victims = (e.payload.victims as { id: string; amount: number }[] | undefined) ?? []
        for (const v of victims) {
          if (v.amount > 0) {
            allEvents.push({
              _tag: 'damage',
              cycle: e.cycle,
              sourceId: casterId,
              targetId: v.id,
              amount: v.amount,
              damageType: 'code',
            })
          }
        }
      }
    }

    // The Ably transport feeds the client from state.events (embedded in
    // cycle_state), so a bridged teleport must not survive in BOTH channels —
    // step 14's merge would then hand the feed the same teleport twice (the
    // wire original + the bridged _tag copy converted back). Retire the wire
    // originals once bridged. The dmz ability_used wire event STAYS: its
    // bridge emits damage events, not a duplicate cast line.
    if (
      currentState.events.slice(eventsBeforeBuffTick).some((e) => e.type === 'teleport_complete')
    ) {
      currentState = {
        ...currentState,
        events: currentState.events.filter(
          (e, i) => i < eventsBeforeBuffTick || e.type !== 'teleport_complete',
        ),
      }
    }

    // 11. Handle deaths — check for newly dead players, attribute kills.
    // Damage dealt this cycle (attacks, abilities, DoTs) feeds assist credit.
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
    // converging toward a Terminal kill — ice standing per team and Terminal
    // HP/vulnerability — so a watcher can see whether games end on time.
    if (fastGameFactor() > 1 && currentState.cycle % 25 === 0) {
      const iceUp = (team: string) =>
        currentState.ice.filter((t) => t.team === team && t.alive).length
      const anc = currentState.terminals
      engineLog.info('📊 Game progress', {
        gameId,
        cycle: currentState.cycle,
        ice: `R${iceUp('chaff')}:D${iceUp('audit')}`,
        chaffTerminal: `${anc?.chaff.integ ?? '?'}${anc?.chaff.vulnerable ? '!' : ''}`,
        auditTerminal: `${anc?.audit.integ ?? '?'}${anc?.audit.vulnerable ? '!' : ''}`,
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
    // the top of this pipeline issues their actions from next cycle; we flag the
    // slot `aiControlled` for the UI and emit an afk_takeover event. No-reclaim:
    // the action ingress drops a reconnecting human's input via isGameBot, and
    // detectAFKPlayers skips aiControlled slots so this fires exactly once.
    if (currentState.cycle % 60 === 0) {
      for (const afk of detectAFKPlayers(currentState)) {
        const player = currentState.players[afk.playerId]
        if (!player) continue
        // Presence gate: "no game action for 2 min" alone false-positives on a
        // player who is at the screen but between actions (reading the shop,
        // watching a fight). A connected player is only converted after the
        // longer silence window, and only when a human teammate benefits.
        // isConnected is hardcoded false — there is no live-peer signal on the
        // Workflow/Ably path (the DO-era WS PeerRegistry this used to read is
        // gone), so every AFK player takes the "disconnected" branch of
        // shouldConvertAFK today. Wiring an Ably-presence signal back in here
        // is the tracked follow-up (see LeaverSystem.ts's module doc).
        const convert = shouldConvertAFK(currentState, afk.playerId, {
          isConnected: false,
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
          cycle: currentState.cycle,
          playerId: afk.playerId,
          heroId: player.heroId,
          team: player.team,
          message: 'went AFK — a bot has taken over',
        })
        recordLeaverSafe(afk.playerId, gameId, currentState, 'afk')
      }
    }

    // 14. Store events on state — merge instead of overwrite so wire-format
    // events pushed directly onto state during the tick (e.g. cycleAllBuffs'
    // teleport_complete) aren't dropped.
    currentState = {
      ...currentState,
      events: [...currentState.events, ...allEvents.map(toGameEvent)],
    }

    yield* Effect.logDebug('Tick processed').pipe(
      Effect.annotateLogs({ gameId, cycle: currentState.cycle, actionCount: validActions.length }),
    )

    currentState = tallyFarm(gameId, currentState, allEvents)

    // Append this cycle's drained actions (humans, bots, synthesized standing
    // orders) onto the durable log. reconstructReplay re-feeds this as the
    // sole input — Bot AI is NOT re-run on archive playback.
    if (actions.length > 0) {
      const logged = actions.map((a) => ({
        cycle: currentState.cycle,
        playerId: a.playerId,
        command: a.command,
        ...(a.synthesized ? { synthesized: true as const } : {}),
      }))
      currentState = {
        ...currentState,
        actionLog: [...(currentState.actionLog ?? []), ...logged],
      }
    }

    return { state: currentState, events: allEvents, rejectedActions, notices, actions }
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
            cycle: currentState.cycle,
            sourceId: 'buyback',
            targetId: action.playerId,
            amount: player.maxInteg,
          })
          events.push({
            _tag: 'power_spike',
            cycle: currentState.cycle,
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
            cycle: currentState.cycle,
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
              cycle: currentState.cycle,
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
              cycle: currentState.cycle,
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
 * Hero passive hook (processCycle step 11.5). Synthesizes the wire-format
 * GameEvent stream the 18 hero passives were written against and folds
 * `resolvePassive` over every alive hero player for each event.
 *
 * Full trigger vocabulary used across the hero files:
 *   attack (cipher/echo/ping/thread/socket), ability_cast (lambda/regex/
 *   daemon), item_used (daemon), damage_taken (cache/firewall/proxy),
 *   move (mutex/traceroute), kill (null_ref),
 *   tick_end (cron/mutex/daemon/kernel/malloc/sentry/firewall/proxy).
 *
 * Keep the synthesized list lean (no per-wave events) — the fold is
 * O(players x events) immutable state copies per cycle.
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
        cycle: state.cycle,
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
        cycle: state.cycle,
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
        cycle: state.cycle,
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
      synthesized.push({ cycle: state.cycle, type: 'move', payload: { playerId: pid } })
    }
  }

  for (const e of allEvents) {
    if (e._tag === 'damage' && state.players[e.targetId]) {
      synthesized.push({
        cycle: state.cycle,
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
        cycle: state.cycle,
        type: 'kill',
        payload: { killerId: e.killerId, victimId: e.victimId },
      })
    }
  }

  synthesized.push({ cycle: state.cycle, type: 'tick_end', payload: {} })

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
 * Run all NPC AIs (waves, neutrals, ice, Tenant) and apply their actions.
 *
 * Ice AI needs `heroAttackers` from the prior `resolveActions` step so it
 * can prioritize heroes that recently attacked allies. Tenant damage is
 * tallied by scanning the events emitted earlier in the tick.
 */
export function runNPCAI(
  state: GameState,
  ctx: {
    heroAttackers: Map<string, string>
    priorEvents: GameEngineEvent[]
    /** Deterministic per-tick rng (see rng.ts). Defaults to Math.random for
     *  back-compat with existing direct callers/tests. */
    rng?: () => number
  },
): { state: GameState; events: GameEngineEvent[] } {
  let s = state
  const events: GameEngineEvent[] = []
  const rng = ctx.rng ?? Math.random

  // Waves (may damage/destroy the enemy Terminal — events carry that)
  const waveResult = applyWaveActions(s, runWaveAI(s))
  s = waveResult.state
  events.push(...waveResult.events)

  // Neutrals
  const neutralResult = applyNeutralActions(s, runNeutralAI(s, rng))
  s = neutralResult.state
  events.push(...neutralResult.events)

  // ICE — priorEvents lets ice aggro heroes that attacked them this cycle
  const iceResult = applyIceActions(s, runIceAI(s, ctx.heroAttackers, ctx.priorEvents))
  s = iceResult.state
  events.push(...iceResult.events)

  // Tenant attacks
  for (const action of runTenantAI(s)) {
    const target = s.players[action.targetId]
    if (target && target.alive) {
      // Route through the shared mitigation chain so Tenant hits honor item
      // plate, vuln amps, Kernel 'hardened', shields, and Echo phaseShift —
      // previously the inline path skipped everything but immunity and emitted
      // the RAW attack value as the damage amount.
      const hit = resolveKineticHit(target, action.damage)
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
        cycle: s.cycle,
        sourceId: 'tenant',
        targetId: action.targetId,
        amount: hit.damageDealt,
        damageType: 'kinetic',
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
 * Spawn periodic content for the cycle: wave units, silt dwellers, caches;
 * and clean up expired caches and wards. Pure: same state object if nothing
 * spawned and nothing expired.
 */
export function runSpawning(state: GameState, rng: () => number = Math.random): GameState {
  let s = state
  // Gate wave/neutral/cache spawning to the zones THIS game's map actually has,
  // so subset maps (one-lane) don't spawn into uninitialized top/bot/silt zones.
  const hasZone = (zoneId: string) => zoneId in s.zones

  const newWaves = spawnWaveUnits(s.cycle, hasZone)
  if (newWaves.length > 0) {
    s = { ...s, waves: [...s.waves, ...newWaves] }
  }

  // Defensive cap: never let waves stack unboundedly in a zone
  s = enforceWaveZoneCap(s)

  const newNeutrals = spawnSiltDwellers(s.cycle, hasZone, s.neutrals ?? [], rng)
  if (newNeutrals.length > 0) {
    s = { ...s, neutrals: [...(s.neutrals ?? []), ...newNeutrals] }
  }

  const activeCacheZones = new Set<string>((s.caches ?? []).map((r) => r.zone))
  const newCaches = spawnCaches(s.cycle, hasZone, activeCacheZones, rng)
  if (newCaches.length > 0) {
    s = { ...s, caches: [...(s.caches ?? []), ...newCaches] }
  }

  s = removeExpiredCaches(s)
  s = processCacheBuffs(s)

  const updatedZones = removeExpiredWards(s.zones, s.cycle)
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
  const chaffUsed = state.teams.chaff.hardenUsedCycle
  const auditUsed = state.teams.audit.hardenUsedCycle
  const chaffExpired = chaffUsed !== null && state.cycle - chaffUsed >= HARDEN_DURATION_CYCLES
  const auditExpired = auditUsed !== null && state.cycle - auditUsed >= HARDEN_DURATION_CYCLES

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
  let dayNightCycle = state.dayNightCycle + 1

  if (timeOfDay === 'day' && dayNightCycle >= DAY_DURATION_CYCLES) {
    timeOfDay = 'night'
    dayNightCycle = 0
    events.push({ _tag: 'night_falls', cycle: state.cycle })
  } else if (timeOfDay === 'night' && dayNightCycle >= NIGHT_DURATION_CYCLES) {
    timeOfDay = 'day'
    dayNightCycle = 0
    events.push({ _tag: 'day_breaks', cycle: state.cycle })
  }

  return {
    state: { ...state, timeOfDay, dayNightCycle },
    events,
  }
}

// ── Helper functions ───────────────────────────────────────────

/** Handle player respawns: set alive if respawnCycle has been reached. */
function handleRespawns(state: GameState): GameState {
  const players = { ...state.players }
  let changed = false

  for (const [pid, player] of Object.entries(players)) {
    if (!player.alive && player.respawnCycle !== null && state.cycle >= player.respawnCycle) {
      const spawnZone = player.team === 'chaff' ? 'rookery-anchor' : 'landing-anchor'
      players[pid] = {
        ...player,
        alive: true,
        integ: player.maxInteg,
        bw: player.maxBw,
        zone: spawnZone,
        respawnCycle: null,
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
      (player.team === 'chaff' && player.zone === 'rookery-anchor') ||
      (player.team === 'audit' && player.zone === 'landing-anchor')

    // Skip healing if player is in combat (soft check — full combat tracking would need a separate system)
    const inCombat = player.buffs.some((b) => b.id === 'inCombat')
    if (isInFountain && !inCombat) {
      const hpHeal = Math.floor((player.maxInteg * FOUNTAIN_HEAL_PER_CYCLE_PERCENT) / 100)
      const mpHeal = Math.floor((player.maxBw * FOUNTAIN_BW_PER_CYCLE_PERCENT) / 100)
      players[pid] = {
        ...player,
        integ: Math.min(player.maxInteg, player.integ + hpHeal),
        bw: Math.min(player.maxBw, player.bw + mpHeal),
      }
      changed = true
    }
  }

  return changed ? { ...state, players } : state
}

/** Handle newly dead players — set respawn timers, attribute kills/assists, award scrip/XP. */
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
    if (!player.alive && player.respawnCycle === null) {
      if (player.buffs.some((b) => b.id === 'backup')) {
        players[pid] = {
          ...player,
          alive: true,
          integ: player.maxInteg,
          bw: player.maxBw,
          buffs: player.buffs.filter((b) => b.id !== 'backup'),
          // Death cancels the standing orders on this branch too — an backup
          // revive must not resume marching into, or swinging at, whoever just
          // killed you.
          moveTarget: null,
          attackTarget: null,
        }
        events.push({
          _tag: 'backup_used',
          cycle: state.cycle,
          playerId: pid,
        })
        changed = true
        continue
      }

      const alreadyCounted = events.some((e) => e._tag === 'death' && e.playerId === pid)
      const scaledLevels = Math.max(0, player.level - RESPAWN_FREE_LEVELS)
      // scaledRespawnTicks keeps wall-clock respawn time at production pace
      // when the TERMINA_TEST_FAST_GAME accelerator is active (no-op otherwise).
      const respawnCycles = scaledRespawnTicks(
        RESPAWN_BASE_CYCLES + RESPAWN_PER_LEVEL_CYCLES * scaledLevels,
      )
      const newDeaths = alreadyCounted ? player.deaths : player.deaths + 1
      // Compute from the post-death death count so the displayed buyback cost
      // matches what buyback() actually charges (both use deaths * 10).
      const buybackCost = calculateBuybackCost({ ...player, deaths: newDeaths })

      players[pid] = {
        ...player,
        respawnCycle: state.cycle + respawnCycles,
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
          cycle: state.cycle,
          playerId: pid,
          respawnCycle: state.cycle + respawnCycles,
        })
      }

      // Everyone who damaged the victim recently shares credit — direct
      // attackers from this cycle plus DoT/ability/item damage in the window.
      const contributors = new Set(getDamageContributors(gameId, pid))
      if (heroAttackers) {
        for (const [attackerId, victimId] of heroAttackers.entries()) {
          if (victimId === pid) contributors.add(attackerId)
        }
      }
      contributors.delete(pid)

      // Killer preference: a direct attacker this cycle, else any recent contributor
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
        // Award kill scrip
        const assisters = [...contributors].filter((id) => id !== killerId && players[id])
        // The bounty is streak- and comeback-scaled, and the assist share is
        // split N ways — so the reported amounts are read back off the scrip diff
        // rather than recomputed here, where they could drift from awardKill.
        const scripBefore = new Map<string, number>(
          [killerId, ...assisters].map((id): [string, number] => [id, players[id]?.scrip ?? 0]),
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
        // XP mirror of the scrip comeback bounty applied in awardKill above.
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
        if (rapierVictim.items.includes('last_word')) {
          const victimItems = [...rapierVictim.items]
          const killerItems = [...players[killerId]!.items]
          for (let i = 0; i < victimItems.length; i++) {
            if (victimItems[i] !== 'last_word') continue
            victimItems[i] = null
            const freeSlot = killerItems.indexOf(null)
            if (freeSlot !== -1) killerItems[freeSlot] = 'last_word'
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
          cycle: state.cycle,
          killerId,
          victimId: pid,
          assisters,
          victimStreak: player.killStreak ?? 0,
          killerStreak: players[killerId]?.killStreak ?? 0,
        } as GameEngineEvent)

        // …and what it paid. Pushed after the kill line so the feed reads
        // "X terminated Y" then "You earned 240g". These reasons deliberately
        // avoid the words the client suppresses as farming noise.
        for (const [id, before] of scripBefore) {
          const gained = (players[id]?.scrip ?? 0) - before
          if (gained > 0) {
            events.push({
              _tag: 'scrip_change',
              cycle: state.cycle,
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

  // Backup expiry sweep: cycleBuffs preserves the backup buff at cyclesRemaining ===
  // 0 so the death loop above can proc it. If the player survived this cycle
  // (no death → no backup consumption), remove the expired backup now so it
  // doesn't linger as a stale buff.
  for (const [pid, player] of Object.entries(players)) {
    if (player.alive && player.buffs.some((b) => b.id === 'backup' && b.cyclesRemaining <= 0)) {
      players[pid] = {
        ...player,
        buffs: player.buffs.filter((b) => !(b.id === 'backup' && b.cyclesRemaining <= 0)),
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
        cycle: state.cycle,
        playerId: pid,
        newLevel,
      })

      // Power spike notifications for key levels
      if ((POWER_SPIKE_LEVELS as readonly number[]).includes(newLevel)) {
        events.push({
          _tag: 'power_spike',
          cycle: state.cycle,
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

/** Apply inCombat buff to players who dealt or received hero damage this cycle. */
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
      buffs[existing] = { ...buffs[existing]!, cyclesRemaining: IN_COMBAT_BUFF_DURATION }
    } else {
      buffs.push({
        id: 'inCombat',
        stacks: 1,
        cyclesRemaining: IN_COMBAT_BUFF_DURATION,
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
        cycle: state.cycle,
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
 * A team wins by destroying the enemy Terminal ("the Terminal"). The
 * Terminal becomes attackable once any of its team's T3 ice is down —
 * see TerminalSystem for the vulnerability/attack rules.
 */
function checkWinCondition(state: GameState): TeamId | null {
  return checkTerminalWin(state)
}

// NOTE: the server used to maintain a global `state.lastSeen` here (and auto-emit
// `enemy_missing`), but that was dead-and-wrong — a single un-fogged global field
// can't model the per-viewer/fog-aware "last seen" concept, which the CLIENT does
// correctly in store.lastSeen. Both the writer and the GameState field are gone;
// player-initiated enemy-missing callouts go through the `missing` command.
