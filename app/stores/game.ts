import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  GamePhase,
  GameMode,
  PlayerState,
  GameEvent,
  ZoneRuntimeState,
  TeamState,
  TeamId,
  IceState,
  TerminalState,
  WaveUnitState,
  SiltDwellerState,
  TenantState,
  CacheState,
} from '~~/shared/types/game'
import type {
  CycleStateMessage,
  PlayerEndStats,
  AnnouncementMessage,
} from '~~/shared/types/protocol'

// Server announcement severities plus a client-only 'error' (synthesised for
// connection/[ERROR] messages) — drives the AnnouncementToast colour.
export type AnnouncementLevel = AnnouncementMessage['level'] | 'error'
import { isShopZoneFor, ZONE_MAP } from '~~/shared/constants/zones'
import { CYCLE_DURATION_MS } from '~~/shared/constants/balance'
import { gameLog } from '~/utils/logger'
import { playerNetWorth } from '~/utils/strategy'

/** How many ticks of team net-worth history to keep for the trend sparkline. */
const NET_WORTH_HISTORY_MAX = 40

/** How often (ms) the client-side cycle countdown refreshes. */
const COUNTDOWN_REFRESH_MS = 100

export interface ScoreboardEntry {
  id: string
  name: string
  /** Guild/clan tag (public identity) — shown next to the name. */
  guildTag?: string
  heroId: string
  team: TeamId
  kills: number
  deaths: number
  assists: number
  scrip: number
  level: number
  items: (string | null)[]
  alive: boolean
  respawnCycle: number | null
  fogged: boolean
  aiControlled?: boolean // true once an AFK player was replaced by a bot
}

export const useGameStore = defineStore('game', () => {
  // ── Core State ──────────────────────────────────────────────────
  const gameId = ref<string | null>(null)
  const playerId = ref<string | null>(null)
  const phase = ref<GamePhase>('waiting')
  const cycle = ref(0)
  const player = ref<PlayerState | null>(null)
  // The zones MAP (every zone, fogged ones stripped) — used for per-zone data
  // lookups. NOT the fog list: `visibleZones` here is the map keyed by id.
  const visibleZones = ref<Record<string, ZoneRuntimeState>>({})
  // The server's fog list — the ids of zones THIS player can actually see this
  // cycle (own + adjacent + ward/ice vision). Distinct from the zones map
  // (which carries all zones); drives map fog-dimming + the net readout vision %.
  const visibleZoneIds = ref<string[]>([])
  const allPlayers = ref<Record<string, PlayerState>>({})
  const teams = ref<{ chaff: TeamState; audit: TeamState } | null>(null)
  const ice = ref<IceState[]>([])
  const terminals = ref<{ chaff: TerminalState; audit: TerminalState } | null>(null)
  const waves = ref<WaveUnitState[]>([])
  const neutrals = ref<SiltDwellerState[]>([])
  // Objective layer — streamed in every cycle payload (PlayerVisibleState) but
  // previously discarded by updateFromCycle. Surfaced here for the net readout HUD.
  const tenant = ref<TenantState | null>(null)
  const caches = ref<CacheState[]>([])
  const backup = ref<{ zone: string; cycle: number; holderId: string | null } | null>(null)
  // Last-seen position per player (zone + cycle) — drives "last seen mid 4t ago"
  // for fogged enemies. Server only includes positions the team is allowed to know.
  const lastSeen = ref<Record<string, { zone: string; cycle: number }>>({})
  // Last-known net worth per player — carried forward while a player is fogged so
  // the scrip-lead readout stays stable instead of cratering whenever enemies
  // drop out of vision (you can't see a fogged enemy's scrip).
  const knownNetWorth = ref<Record<string, number>>({})
  // Per-team net-worth history (one sample per cycle) for the trend sparkline.
  const netWorthHistory = ref<{ chaff: number[]; audit: number[] }>({ chaff: [], audit: [] })
  const events = ref<GameEvent[]>([])
  // Monotonic counter + the most-recent batch. Consumers (audio/shake/flash/KDA)
  // react to `eventSeq` and read `latestEvents` instead of diffing `events.length`
  // — which pins at 200 once the buffer caps below, silently killing game-feel
  // mid-game.
  const eventSeq = ref(0)
  const latestEvents = ref<GameEvent[]>([])
  const announcements = ref<string[]>([])
  // Monotonic counter so transient consumers (the warning toast) retrigger on
  // every announcement — `announcements.length` pins at 50 once capped below,
  // same trap as eventSeq above.
  const announcementSeq = ref(0)
  // Severity of the latest announcement, so the toast can colour it correctly
  // (info messages like "Reconnected" must NOT read as amber warnings).
  const lastAnnouncementLevel = ref<AnnouncementLevel>('warning')
  const nextCycleIn = ref(0)
  const lastCycleAt = ref<number | null>(null)
  // Epoch ms when the CURRENT cycle window commits — the server's authoritative
  // clock for the persistent CYCLE n · OPEN/COMMITTED · s.s s indicator. Read
  // from cycle_state when present; falls back to lastCycleAt + CYCLE_DURATION_MS
  // (arrival time + one cycle) for older payloads that omit it, so the clock
  // still runs.
  const nextCommitAt = ref<number | null>(null)
  // Whether an order is queued for the CURRENT cycle window. Distinct from
  // `canAct`/`lastActionCycle` (which gate the main action slot specifically):
  // this is the player-facing OPEN/COMMITTED flag for the persistent clock.
  // Resets to false whenever a cycle_state with a NEW cycle number arrives.
  const orderCommitted = ref(false)
  const scoreboard = ref<ScoreboardEntry[]>([])
  const gameOverStats = ref<Record<string, PlayerEndStats> | null>(null)
  const gameOverMmrChange = ref<number | null>(null)
  // False when the finished match contained bots (practice / bot-filled) and so
  // did not affect MMR — the post-game screen shows "unranked" instead of a number.
  const gameOverRanked = ref<boolean>(true)
  /** Match length, for the post-game summary. Null for any game_over that
   *  predates the field (older snapshots, resumed games). */
  const gameOverDurationTicks = ref<number | null>(null)
  const winner = ref<TeamId | null>(null)
  const timeOfDay = ref<'day' | 'night'>('day')
  /** Which map this game runs on (undefined = full 5v5); drives the ASCII layout. */
  const mapId = ref<string | undefined>(undefined)
  /** Game mode (undefined/'normal' = regular match; 'tutorial' = guided flow). */
  const mode = ref<GameMode | undefined>(undefined)
  /** Tutorial progress (0-based step); drives the in-game tutorial banner. */
  const tutorialStep = ref<number | undefined>(undefined)
  const dayNightCycle = ref(0)

  // Track if player has acted this cycle (resets each cycle)
  const lastActionCycle = ref<number>(-1)
  // The item slot is tracked separately: the server queues item actives in
  // their own per-player slot (GameLoop.actionSlot), so spending one leaves the
  // tick's main decision — the ability, the attack, the step — still available.
  const lastItemActionTick = ref<number>(-1)

  // Human-readable description of the action queued for the next cycle,
  // e.g. "move coldstore-cross". Cleared when the cycle resolves.
  const pendingCommand = ref<string | null>(null)

  // Command typed while the player had already acted this cycle. It is
  // buffered client-side and auto-sent when the next cycle arrives.
  const bufferedCommand = ref<string | null>(null)

  // Client-side countdown timer handle (see _ensureCountdownTimer)
  let countdownTimer: ReturnType<typeof setInterval> | null = null

  // ── Getters ─────────────────────────────────────────────────────
  const currentZone = computed(() => {
    if (!player.value) return null
    return ZONE_MAP[player.value.zone] ?? null
  })

  const isAlive = computed(() => player.value?.alive ?? false)

  const canAct = computed(() => {
    if (!player.value || !isAlive.value) return false
    // Can act if we haven't acted this cycle yet
    return lastActionCycle.value !== cycle.value
  })

  /** Whether the free item-active slot is still open this cycle. */
  const canUseItem = computed(() => {
    if (!player.value || !isAlive.value) return false
    return lastItemActionTick.value !== cycle.value
  })

  const canBuy = computed(() => {
    if (!player.value || !isAlive.value) return false
    return isShopZoneFor(player.value.zone, player.value.team)
  })

  const kda = computed(() => {
    if (!player.value) return '0/0/0'
    return `${player.value.kills}/${player.value.deaths}/${player.value.assists}`
  })

  const heroLevel = computed(() => player.value?.level ?? 0)

  const nearbyEnemies = computed(() => {
    if (!player.value) return []
    return Object.values(allPlayers.value).filter(
      (p) => p.zone === player.value!.zone && p.team !== player.value!.team && p.alive,
    )
  })

  const nearbyAllies = computed(() => {
    if (!player.value) return []
    return Object.values(allPlayers.value).filter(
      (p) =>
        p.zone === player.value!.zone &&
        p.team === player.value!.team &&
        p.id !== player.value!.id &&
        p.alive,
    )
  })

  // Full rosters (incl. dead + fogged) — drive the net readout enemy threat sheet
  // and ally status, independent of the player's current zone.
  const enemyPlayers = computed<PlayerState[]>(() => {
    if (!player.value) return []
    return Object.values(allPlayers.value).filter((p) => p.team !== player.value!.team)
  })

  const allyPlayers = computed<PlayerState[]>(() => {
    if (!player.value) return []
    return Object.values(allPlayers.value).filter(
      (p) => p.team === player.value!.team && p.id !== player.value!.id,
    )
  })

  /** Current team net worth (latest history sample). */
  const netWorth = computed(() => ({
    chaff: netWorthHistory.value.chaff.at(-1) ?? 0,
    audit: netWorthHistory.value.audit.at(-1) ?? 0,
  }))

  // ── Actions ─────────────────────────────────────────────────────

  /** Recompute the ms remaining until the next cycle from wall-clock time. */
  function _updateCountdown() {
    if (lastCycleAt.value == null) {
      nextCycleIn.value = 0
      return
    }
    nextCycleIn.value = Math.max(0, CYCLE_DURATION_MS - (Date.now() - lastCycleAt.value))
  }

  /**
   * Start the ~100ms client interval that keeps `nextCycleIn` live between
   * cycle_state arrivals. Idempotent — safe to call on every cycle.
   */
  function _ensureCountdownTimer() {
    if (countdownTimer) return
    countdownTimer = setInterval(_updateCountdown, COUNTDOWN_REFRESH_MS)
  }

  function stopTickCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }
    lastCycleAt.value = null
    nextCycleIn.value = 0
    nextCommitAt.value = null
  }

  /**
   * Mark that an order is queued for the current cycle window. Called
   * optimistically by `markActionSent` (main slot) and by the socket layer on
   * server acknowledgment — both converge on this single flag rather than each
   * tracking their own.
   */
  function markOrderCommitted() {
    orderCommitted.value = true
  }

  /**
   * The server refused the order (action_ack accepted:false — a late/future
   * cycle stamp). Reverse the optimistic COMMITTED and reopen the action slot,
   * so the player retypes for the open cycle instead of staring at a
   * COMMITTED line the server never honored.
   */
  function markOrderRejected() {
    orderCommitted.value = false
    lastActionCycle.value = -1
  }

  /** Buffer a command typed while waiting; it is sent on the next cycle. */
  function bufferCommand(cmd: string) {
    bufferedCommand.value = cmd
  }

  /** Take (and clear) the buffered command, if any. */
  function consumeBufferedCommand(): string | null {
    const cmd = bufferedCommand.value
    bufferedCommand.value = null
    return cmd
  }

  function updateFromCycle(msg: CycleStateMessage) {
    const state = msg.state as {
      phase: GamePhase
      players: Record<string, PlayerState>
      zones: Record<string, ZoneRuntimeState>
      visibleZones?: string[]
      teams: { chaff: TeamState; audit: TeamState }
      ice?: IceState[]
      terminals?: { chaff: TerminalState; audit: TerminalState }
      waves?: WaveUnitState[]
      neutrals?: SiltDwellerState[]
      tenant?: TenantState
      caches?: CacheState[]
      backup?: { zone: string; cycle: number; holderId: string | null } | null
      timeOfDay?: 'day' | 'night'
      dayNightCycle?: number
      mapId?: string
      mode?: GameMode
      tutorialStep?: number
      winner?: TeamId | null
    }

    gameLog.trace('cycle_state', {
      cycle: msg.cycle,
      players: Object.keys(state.players).length,
      zones: Object.keys(state.zones).length,
    })

    if (msg.cycle !== cycle.value) {
      pendingCommand.value = null
      // A new cycle window opened — any order committed against the previous
      // one no longer applies.
      orderCommitted.value = false
    }
    cycle.value = msg.cycle
    // Anchor the client-side countdown to this cycle's arrival time
    lastCycleAt.value = Date.now()
    // `nextCommitAt` is a top-level CycleStateMessage field (the server's
    // batch-commit epoch), not part of the PlayerVisibleState payload — read
    // it off `msg`, not `state`. Absent on older/manual-tick payloads, so fall
    // back to this arrival time + one cycle.
    nextCommitAt.value = msg.nextCommitAt ?? lastCycleAt.value + CYCLE_DURATION_MS
    _updateCountdown()
    _ensureCountdownTimer()
    // Merge-guard optional fields: the Ably path sends the full filtered
    // state every cycle, but guarding keeps the store robust against any
    // payload that omits a field (older server, dev/manual ticks) — an
    // unconditional assign would clobber them to undefined and blank the
    // score banner/scoreboard. players + zones are always sent, so stay
    // unconditional.
    if (state.phase) phase.value = state.phase
    // Fallback end-of-game path: the serverless tick publishes an explicit
    // game_over message alongside the final cycle_state, but if that message
    // is lost the player must NEVER be stranded on a dead board (the
    // first-playtest bug: phase froze to 'ended', winner stayed null, and
    // PostGame — which requires both — never rendered). Derive the post-game
    // screen from the ended state itself; a real game_over arriving first
    // wins (winner already set), arriving after overwrites with richer data.
    if (state.phase === 'ended' && state.winner && winner.value === null) {
      const derived: Record<string, PlayerEndStats> = {}
      for (const [id, p] of Object.entries(state.players)) {
        const full = p as Partial<PlayerState>
        derived[id] = {
          kills: p.kills ?? 0,
          deaths: p.deaths ?? 0,
          assists: p.assists ?? 0,
          scrip: full.scrip ?? 0,
          items: full.items ?? [],
          heroDamage: full.damageDealt ?? 0,
          iceDamage: full.iceDamageDealt ?? 0,
          netWorth: full.items ? playerNetWorth(full as PlayerState) : undefined,
          level: full.level ?? 1,
        }
      }
      setGameOver(state.winner, derived, undefined, false, msg.cycle)
    }
    allPlayers.value = state.players
    visibleZones.value = state.zones
    // visibleZones (the fog id list) is always sent in the delta; fall back to
    // all zone ids only for payloads that omit it (e.g. spectator full state).
    visibleZoneIds.value = state.visibleZones ?? Object.keys(state.zones)
    if (state.teams) teams.value = state.teams
    if (state.ice) ice.value = state.ice
    if (state.terminals) terminals.value = state.terminals
    if (state.waves) waves.value = state.waves
    if (state.neutrals) neutrals.value = state.neutrals
    if (state.tenant) tenant.value = state.tenant
    if (state.caches) caches.value = state.caches
    if ('backup' in state) backup.value = state.backup ?? null
    // Fog-safe last-seen tracking: record a player's position ONLY on the ticks
    // where they arrive un-fogged (fogged enemies come through as FoggedPlayer
    // with no `zone`). This can never leak a position the team didn't actually
    // observe, so it needs no server/vision change — unlike exposing the server's
    // global lastSeen map, which would reveal enemies still hidden in fog.
    {
      const seen = { ...lastSeen.value }
      for (const p of Object.values(state.players)) {
        const zone = (p as { zone?: string }).zone
        if (zone && p.alive) seen[p.id] = { zone, cycle: msg.cycle }
      }
      lastSeen.value = seen
    }
    // Net-worth tracking: update last-known worth only for un-fogged players,
    // then sum per team (carrying forward fogged enemies' last-known value) and
    // append one sample per team to the trend history.
    {
      const known = { ...knownNetWorth.value }
      for (const p of Object.values(state.players)) {
        if (!(p as { fogged?: boolean }).fogged) {
          known[p.id] = playerNetWorth(p as { scrip?: number; items?: (string | null)[] })
        }
      }
      knownNetWorth.value = known
      const teamWorth = (team: TeamId) =>
        Object.values(state.players)
          .filter((p) => p.team === team)
          .reduce((sum, p) => sum + (known[p.id] ?? 0), 0)
      const push = (arr: number[], v: number) => {
        const next = [...arr, v]
        return next.length > NET_WORTH_HISTORY_MAX ? next.slice(-NET_WORTH_HISTORY_MAX) : next
      }
      netWorthHistory.value = {
        chaff: push(netWorthHistory.value.chaff, teamWorth('chaff')),
        audit: push(netWorthHistory.value.audit, teamWorth('audit')),
      }
    }
    if (state.timeOfDay) timeOfDay.value = state.timeOfDay
    if (state.dayNightCycle !== undefined) dayNightCycle.value = state.dayNightCycle
    if (state.mapId) mapId.value = state.mapId
    if (state.mode) mode.value = state.mode
    if (state.tutorialStep !== undefined) tutorialStep.value = state.tutorialStep

    if (playerId.value && state.players[playerId.value]) {
      player.value = state.players[playerId.value] ?? null
    }

    // Update scoreboard from players
    scoreboard.value = Object.values(state.players).map((p) => {
      const isFogged = (p as { fogged?: boolean }).fogged ?? false
      return {
        id: p.id,
        name: p.name,
        guildTag: (p as { guildTag?: string }).guildTag,
        heroId: p.heroId ?? '',
        team: p.team,
        kills: p.kills ?? 0,
        deaths: p.deaths ?? 0,
        assists: p.assists ?? 0,
        scrip: isFogged ? 0 : (p.scrip ?? 0),
        level: p.level ?? 0,
        items: isFogged ? [] : (p.items ?? []),
        alive: (p.alive as boolean) ?? true,
        respawnCycle: (p.respawnCycle as number | null) ?? null,
        fogged: isFogged,
        aiControlled: (p as { aiControlled?: boolean }).aiControlled ?? false,
      }
    })
  }

  function addEvents(newEvents: GameEvent[]) {
    if (newEvents.length === 0) return
    events.value.push(...newEvents)
    // Keep last 200 events
    if (events.value.length > 200) {
      events.value = events.value.slice(-200)
    }
    // Expose the new batch + bump the monotonic seq so reactive consumers fire
    // even after the 200-cap freezes events.length.
    latestEvents.value = newEvents
    eventSeq.value += newEvents.length
  }

  function addAnnouncement(text: string, level?: AnnouncementLevel) {
    announcements.value.push(text)
    if (announcements.value.length > 50) {
      announcements.value = announcements.value.slice(-50)
    }
    // Fall back to the text prefix when no level is given (client [ERROR] lines).
    lastAnnouncementLevel.value = level ?? (text.startsWith('[ERROR]') ? 'error' : 'warning')
    announcementSeq.value++
  }

  function setPhase(newPhase: GamePhase) {
    phase.value = newPhase
  }

  function setGameOver(
    winnerTeam: TeamId,
    stats: Record<string, PlayerEndStats>,
    mmrChange?: number,
    ranked = true,
    durationCycles?: number,
  ) {
    winner.value = winnerTeam
    gameOverStats.value = stats
    gameOverMmrChange.value = mmrChange ?? null
    gameOverRanked.value = ranked
    gameOverDurationTicks.value = durationCycles ?? null
    phase.value = 'ended'
  }

  /**
   * Record that a command went to the server this cycle, against the slot it
   * competes for. The slot is derived from the command line itself (the caller
   * already passes the raw input) so the two client gates can never disagree
   * with the server's queue: `use …` consumes only the item slot, everything
   * else consumes the main one.
   */
  function markActionSent(description?: string, slot?: 'main' | 'item') {
    const verb = description?.trim().split(/\s+/)[0]?.toLowerCase()
    const resolved = slot ?? (verb === 'use' ? 'item' : 'main')
    if (resolved === 'item') {
      lastItemActionTick.value = cycle.value
    } else {
      lastActionCycle.value = cycle.value
      // Optimistic: the main action slot is exactly today's "order sent this
      // cycle" transition (drives `canAct`/AWAITING ORDERS) — the persistent
      // clock's COMMITTED state rides the same event rather than a parallel flag.
      markOrderCommitted()
    }
    if (description) pendingCommand.value = description
  }

  function reset() {
    gameId.value = null
    phase.value = 'waiting'
    cycle.value = 0
    player.value = null
    visibleZones.value = {}
    visibleZoneIds.value = []
    allPlayers.value = {}
    teams.value = null
    ice.value = []
    terminals.value = null
    waves.value = []
    neutrals.value = []
    tenant.value = null
    caches.value = []
    backup.value = null
    lastSeen.value = {}
    knownNetWorth.value = {}
    netWorthHistory.value = { chaff: [], audit: [] }
    events.value = []
    eventSeq.value = 0
    latestEvents.value = []
    announcements.value = []
    announcementSeq.value = 0
    lastAnnouncementLevel.value = 'warning'
    stopTickCountdown()
    scoreboard.value = []
    gameOverStats.value = null
    gameOverMmrChange.value = null
    gameOverRanked.value = true
    winner.value = null
    lastActionCycle.value = -1
    lastItemActionTick.value = -1
    orderCommitted.value = false
    pendingCommand.value = null
    bufferedCommand.value = null
    timeOfDay.value = 'day'
    dayNightCycle.value = 0
    mapId.value = undefined
    mode.value = undefined
    tutorialStep.value = undefined
  }

  return {
    // State
    gameId,
    playerId,
    phase,
    cycle,
    player,
    visibleZones,
    visibleZoneIds,
    allPlayers,
    teams,
    ice,
    terminals,
    waves,
    neutrals,
    tenant,
    caches,
    backup,
    lastSeen,
    knownNetWorth,
    netWorthHistory,
    events,
    eventSeq,
    latestEvents,
    announcements,
    announcementSeq,
    lastAnnouncementLevel,
    nextCycleIn,
    lastCycleAt,
    nextCommitAt,
    orderCommitted,
    pendingCommand,
    bufferedCommand,
    scoreboard,
    gameOverStats,
    gameOverMmrChange,
    gameOverRanked,
    gameOverDurationTicks,
    winner,
    lastActionCycle,
    lastItemActionTick,
    timeOfDay,
    dayNightCycle,
    mapId,
    mode,
    tutorialStep,
    // Getters
    currentZone,
    isAlive,
    canAct,
    canUseItem,
    canBuy,
    kda,
    heroLevel,
    nearbyEnemies,
    nearbyAllies,
    enemyPlayers,
    allyPlayers,
    netWorth,
    // Actions
    updateFromCycle,
    addEvents,
    addAnnouncement,
    setPhase,
    setGameOver,
    markActionSent,
    markOrderCommitted,
    markOrderRejected,
    bufferCommand,
    consumeBufferedCommand,
    stopTickCountdown,
    reset,
  }
})
