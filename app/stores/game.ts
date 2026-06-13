import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  GamePhase,
  PlayerState,
  GameEvent,
  ZoneRuntimeState,
  TeamState,
  TeamId,
  TowerState,
  AncientState,
  CreepState,
  NeutralCreepState,
} from '~~/shared/types/game'
import type { TickStateMessage, PlayerEndStats } from '~~/shared/types/protocol'
import { ZONE_MAP } from '~~/shared/constants/zones'
import { TICK_DURATION_MS } from '~~/shared/constants/balance'
import { gameLog } from '~/utils/logger'

/** How often (ms) the client-side tick countdown refreshes. */
const COUNTDOWN_REFRESH_MS = 100

export interface ScoreboardEntry {
  id: string
  name: string
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
}

export const useGameStore = defineStore('game', () => {
  // ── Core State ──────────────────────────────────────────────────
  const gameId = ref<string | null>(null)
  const playerId = ref<string | null>(null)
  const phase = ref<GamePhase>('waiting')
  const tick = ref(0)
  const player = ref<PlayerState | null>(null)
  const visibleZones = ref<Record<string, ZoneRuntimeState>>({})
  const allPlayers = ref<Record<string, PlayerState>>({})
  const teams = ref<{ radiant: TeamState; dire: TeamState } | null>(null)
  const towers = ref<TowerState[]>([])
  const ancients = ref<{ radiant: AncientState; dire: AncientState } | null>(null)
  const creeps = ref<CreepState[]>([])
  const neutrals = ref<NeutralCreepState[]>([])
  const events = ref<GameEvent[]>([])
  const announcements = ref<string[]>([])
  const nextTickIn = ref(0)
  const lastTickAt = ref<number | null>(null)
  const scoreboard = ref<ScoreboardEntry[]>([])
  const gameOverStats = ref<Record<string, PlayerEndStats> | null>(null)
  const winner = ref<TeamId | null>(null)
  const timeOfDay = ref<'day' | 'night'>('day')
  const dayNightTick = ref(0)

  // Track if player has acted this tick (resets each tick)
  const lastActionTick = ref<number>(-1)

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

  const canBuy = computed(() => {
    if (!player.value || !isAlive.value) return false
    const zone = ZONE_MAP[player.value.zone]
    return zone?.shop ?? false
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
      teams: { radiant: TeamState; dire: TeamState }
      towers?: TowerState[]
      ancients?: { radiant: AncientState; dire: AncientState }
      creeps?: CreepState[]
      neutrals?: NeutralCreepState[]
      timeOfDay?: 'day' | 'night'
      dayNightTick?: number
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
    phase.value = state.phase
    allPlayers.value = state.players
    visibleZones.value = state.zones
    teams.value = state.teams
    if (state.towers) towers.value = state.towers
    if (state.ancients) ancients.value = state.ancients
    if (state.creeps) creeps.value = state.creeps
    if (state.neutrals) neutrals.value = state.neutrals
    if (state.timeOfDay) timeOfDay.value = state.timeOfDay
    if (state.dayNightTick !== undefined) dayNightTick.value = state.dayNightTick

    if (playerId.value && state.players[playerId.value]) {
      player.value = state.players[playerId.value] ?? null
    }

    // Update scoreboard from players
    scoreboard.value = Object.values(state.players).map((p) => {
      const isFogged = (p as { fogged?: boolean }).fogged ?? false
      return {
        id: p.id,
        name: p.name,
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
      }
    })
  }

  function addEvents(newEvents: GameEvent[]) {
    events.value.push(...newEvents)
    // Keep last 200 events
    if (events.value.length > 200) {
      events.value = events.value.slice(-200)
    }
  }

  function addAnnouncement(text: string) {
    announcements.value.push(text)
    if (announcements.value.length > 50) {
      announcements.value = announcements.value.slice(-50)
    }
  }

  function setPhase(newPhase: GamePhase) {
    phase.value = newPhase
  }

  function setGameOver(winnerTeam: TeamId, stats: Record<string, PlayerEndStats>) {
    winner.value = winnerTeam
    gameOverStats.value = stats
    phase.value = 'ended'
  }

  function markActionSent(description?: string) {
    lastActionTick.value = tick.value
    if (description) pendingCommand.value = description
  }

  function reset() {
    gameId.value = null
    phase.value = 'waiting'
    tick.value = 0
    player.value = null
    visibleZones.value = {}
    allPlayers.value = {}
    teams.value = null
    towers.value = []
    ancients.value = null
    creeps.value = []
    neutrals.value = []
    events.value = []
    announcements.value = []
    stopTickCountdown()
    scoreboard.value = []
    gameOverStats.value = null
    winner.value = null
    lastActionTick.value = -1
    pendingCommand.value = null
    bufferedCommand.value = null
    timeOfDay.value = 'day'
    dayNightTick.value = 0
  }

  return {
    // State
    gameId,
    playerId,
    phase,
    tick,
    player,
    visibleZones,
    allPlayers,
    teams,
    towers,
    ancients,
    creeps,
    neutrals,
    events,
    announcements,
    nextTickIn,
    lastTickAt,
    pendingCommand,
    bufferedCommand,
    scoreboard,
    gameOverStats,
    winner,
    lastActionTick,
    timeOfDay,
    dayNightTick,
    // Getters
    currentZone,
    isAlive,
    canAct,
    canBuy,
    kda,
    heroLevel,
    nearbyEnemies,
    nearbyAllies,
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
