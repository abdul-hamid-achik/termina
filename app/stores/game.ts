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
  AncientState,
  WaveUnitState,
  SiltDwellerState,
  TenantState,
  CacheState,
} from '~~/shared/types/game'
import type {
  TickStateMessage,
  PlayerEndStats,
  AnnouncementMessage,
} from '~~/shared/types/protocol'

// Server announcement severities plus a client-only 'error' (synthesised for
// connection/[ERROR] messages) — drives the AnnouncementToast colour.
export type AnnouncementLevel = AnnouncementMessage['level'] | 'error'
import { isShopZoneFor, ZONE_MAP } from '~~/shared/constants/zones'
import { TICK_DURATION_MS } from '~~/shared/constants/balance'
import { gameLog } from '~/utils/logger'
import { playerNetWorth } from '~/utils/strategy'

/** How many ticks of team net-worth history to keep for the trend sparkline. */
const NET_WORTH_HISTORY_MAX = 40

/** How often (ms) the client-side tick countdown refreshes. */
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
  gold: number
  level: number
  items: (string | null)[]
  alive: boolean
  respawnTick: number | null
  fogged: boolean
  aiControlled?: boolean // true once an AFK player was replaced by a bot
}

export const useGameStore = defineStore('game', () => {
  // ── Core State ──────────────────────────────────────────────────
  const gameId = ref<string | null>(null)
  const playerId = ref<string | null>(null)
  const phase = ref<GamePhase>('waiting')
  const tick = ref(0)
  const player = ref<PlayerState | null>(null)
  // The zones MAP (every zone, fogged ones stripped) — used for per-zone data
  // lookups. NOT the fog list: `visibleZones` here is the map keyed by id.
  const visibleZones = ref<Record<string, ZoneRuntimeState>>({})
  // The server's fog list — the ids of zones THIS player can actually see this
  // tick (own + adjacent + ward/ice vision). Distinct from the zones map
  // (which carries all zones); drives map fog-dimming + the net readout vision %.
  const visibleZoneIds = ref<string[]>([])
  const allPlayers = ref<Record<string, PlayerState>>({})
  const teams = ref<{ chaff: TeamState; audit: TeamState } | null>(null)
  const ice = ref<IceState[]>([])
  const ancients = ref<{ chaff: AncientState; audit: AncientState } | null>(null)
  const waves = ref<WaveUnitState[]>([])
  const neutrals = ref<SiltDwellerState[]>([])
  // Objective layer — streamed in every tick payload (PlayerVisibleState) but
  // previously discarded by updateFromTick. Surfaced here for the net readout HUD.
  const tenant = ref<TenantState | null>(null)
  const caches = ref<CacheState[]>([])
  const backup = ref<{ zone: string; tick: number; holderId: string | null } | null>(null)
  // Last-seen position per player (zone + tick) — drives "last seen mid 4t ago"
  // for fogged enemies. Server only includes positions the team is allowed to know.
  const lastSeen = ref<Record<string, { zone: string; tick: number }>>({})
  // Last-known net worth per player — carried forward while a player is fogged so
  // the gold-lead readout stays stable instead of cratering whenever enemies
  // drop out of vision (you can't see a fogged enemy's gold).
  const knownNetWorth = ref<Record<string, number>>({})
  // Per-team net-worth history (one sample per tick) for the trend sparkline.
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
  const nextTickIn = ref(0)
  const lastTickAt = ref<number | null>(null)
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
  const dayNightTick = ref(0)

  // Track if player has acted this tick (resets each tick)
  const lastActionTick = ref<number>(-1)
  // The item slot is tracked separately: the server queues item actives in
  // their own per-player slot (GameLoop.actionSlot), so spending one leaves the
  // tick's main decision — the ability, the attack, the step — still available.
  const lastItemActionTick = ref<number>(-1)

  // Human-readable description of the action queued for the next tick,
  // e.g. "move mid-river". Cleared when the tick resolves.
  const pendingCommand = ref<string | null>(null)

  // Command typed while the player had already acted this tick. It is
  // buffered client-side and auto-sent when the next tick arrives.
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
    // Can act if we haven't acted this tick yet
    return lastActionTick.value !== tick.value
  })

  /** Whether the free item-active slot is still open this tick. */
  const canUseItem = computed(() => {
    if (!player.value || !isAlive.value) return false
    return lastItemActionTick.value !== tick.value
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

  /** Recompute the ms remaining until the next tick from wall-clock time. */
  function _updateCountdown() {
    if (lastTickAt.value == null) {
      nextTickIn.value = 0
      return
    }
    nextTickIn.value = Math.max(0, TICK_DURATION_MS - (Date.now() - lastTickAt.value))
  }

  /**
   * Start the ~100ms client interval that keeps `nextTickIn` live between
   * tick_state arrivals. Idempotent — safe to call on every tick.
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
    lastTickAt.value = null
    nextTickIn.value = 0
  }

  /** Buffer a command typed while waiting; it is sent on the next tick. */
  function bufferCommand(cmd: string) {
    bufferedCommand.value = cmd
  }

  /** Take (and clear) the buffered command, if any. */
  function consumeBufferedCommand(): string | null {
    const cmd = bufferedCommand.value
    bufferedCommand.value = null
    return cmd
  }

  function updateFromTick(msg: TickStateMessage) {
    const state = msg.state as {
      phase: GamePhase
      players: Record<string, PlayerState>
      zones: Record<string, ZoneRuntimeState>
      visibleZones?: string[]
      teams: { chaff: TeamState; audit: TeamState }
      ice?: IceState[]
      ancients?: { chaff: AncientState; audit: AncientState }
      waves?: WaveUnitState[]
      neutrals?: SiltDwellerState[]
      tenant?: TenantState
      caches?: CacheState[]
      backup?: { zone: string; tick: number; holderId: string | null } | null
      timeOfDay?: 'day' | 'night'
      dayNightTick?: number
      mapId?: string
      mode?: GameMode
      tutorialStep?: number
    }

    gameLog.trace('tick_state', {
      tick: msg.tick,
      players: Object.keys(state.players).length,
      zones: Object.keys(state.zones).length,
    })

    if (msg.tick !== tick.value) {
      pendingCommand.value = null
    }
    tick.value = msg.tick
    // Anchor the client-side countdown to this tick's arrival time
    lastTickAt.value = Date.now()
    _updateCountdown()
    _ensureCountdownTimer()
    // phase + teams are delta-OMITTED when unchanged (StateDelta), so they must
    // be merge-guarded like every field below — an unconditional assign clobbers
    // them to undefined on every steady tick (blanks the score banner/scoreboard
    // and corrupts any phase check). players + zones are always sent, so stay
    // unconditional.
    if (state.phase) phase.value = state.phase
    allPlayers.value = state.players
    visibleZones.value = state.zones
    // visibleZones (the fog id list) is always sent in the delta; fall back to
    // all zone ids only for payloads that omit it (e.g. spectator full state).
    visibleZoneIds.value = state.visibleZones ?? Object.keys(state.zones)
    if (state.teams) teams.value = state.teams
    if (state.ice) ice.value = state.ice
    if (state.ancients) ancients.value = state.ancients
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
        if (zone && p.alive) seen[p.id] = { zone, tick: msg.tick }
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
          known[p.id] = playerNetWorth(p as { gold?: number; items?: (string | null)[] })
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
    if (state.dayNightTick !== undefined) dayNightTick.value = state.dayNightTick
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
        gold: isFogged ? 0 : (p.gold ?? 0),
        level: p.level ?? 0,
        items: isFogged ? [] : (p.items ?? []),
        alive: (p.alive as boolean) ?? true,
        respawnTick: (p.respawnTick as number | null) ?? null,
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
    durationTicks?: number,
  ) {
    winner.value = winnerTeam
    gameOverStats.value = stats
    gameOverMmrChange.value = mmrChange ?? null
    gameOverRanked.value = ranked
    gameOverDurationTicks.value = durationTicks ?? null
    phase.value = 'ended'
  }

  /**
   * Record that a command went to the server this tick, against the slot it
   * competes for. The slot is derived from the command line itself (the caller
   * already passes the raw input) so the two client gates can never disagree
   * with the server's queue: `use …` consumes only the item slot, everything
   * else consumes the main one.
   */
  function markActionSent(description?: string, slot?: 'main' | 'item') {
    const verb = description?.trim().split(/\s+/)[0]?.toLowerCase()
    const resolved = slot ?? (verb === 'use' ? 'item' : 'main')
    if (resolved === 'item') lastItemActionTick.value = tick.value
    else lastActionTick.value = tick.value
    if (description) pendingCommand.value = description
  }

  function reset() {
    gameId.value = null
    phase.value = 'waiting'
    tick.value = 0
    player.value = null
    visibleZones.value = {}
    visibleZoneIds.value = []
    allPlayers.value = {}
    teams.value = null
    ice.value = []
    ancients.value = null
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
    lastActionTick.value = -1
    lastItemActionTick.value = -1
    pendingCommand.value = null
    bufferedCommand.value = null
    timeOfDay.value = 'day'
    dayNightTick.value = 0
    mapId.value = undefined
    mode.value = undefined
    tutorialStep.value = undefined
  }

  return {
    // State
    gameId,
    playerId,
    phase,
    tick,
    player,
    visibleZones,
    visibleZoneIds,
    allPlayers,
    teams,
    ice,
    ancients,
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
    nextTickIn,
    lastTickAt,
    pendingCommand,
    bufferedCommand,
    scoreboard,
    gameOverStats,
    gameOverMmrChange,
    gameOverRanked,
    gameOverDurationTicks,
    winner,
    lastActionTick,
    lastItemActionTick,
    timeOfDay,
    dayNightTick,
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
    updateFromTick,
    addEvents,
    addAnnouncement,
    setPhase,
    setGameOver,
    markActionSent,
    bufferCommand,
    consumeBufferedCommand,
    stopTickCountdown,
    reset,
  }
})
