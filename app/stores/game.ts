import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  GamePhase,
  PlayerState,
  GameEvent,
  ZoneRuntimeState,
  TeamState,
  TeamId,
} from '~~/shared/types/game'
import type { TickStateMessage, PlayerEndStats } from '~~/shared/types/protocol'
import { ZONE_MAP } from '~~/shared/constants/zones'

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
  const events = ref<GameEvent[]>([])
  const announcements = ref<string[]>([])
  const nextTickIn = ref(0)
  const scoreboard = ref<ScoreboardEntry[]>([])
  const gameOverStats = ref<Record<string, PlayerEndStats> | null>(null)
  const winner = ref<TeamId | null>(null)

  // ── Getters ─────────────────────────────────────────────────────
  const currentZone = computed(() => {
    if (!player.value) return null
    return ZONE_MAP[player.value.zone] ?? null
  })

  const isAlive = computed(() => player.value?.alive ?? false)

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
      p => p.zone === player.value!.zone && p.team !== player.value!.team && p.alive,
    )
  })

  const nearbyAllies = computed(() => {
    if (!player.value) return []
    return Object.values(allPlayers.value).filter(
      p => p.zone === player.value!.zone && p.team === player.value!.team && p.id !== player.value!.id && p.alive,
    )
  })

  // ── Actions ─────────────────────────────────────────────────────
  function updateFromTick(msg: TickStateMessage) {
    tick.value = msg.tick
    phase.value = msg.state.phase
    allPlayers.value = msg.state.players
    visibleZones.value = msg.state.zones
    teams.value = msg.state.teams

    if (playerId.value && msg.state.players[playerId.value]) {
      player.value = msg.state.players[playerId.value]
    }

    // Update scoreboard from players
    scoreboard.value = Object.values(msg.state.players).map(p => ({
      id: p.id,
      name: p.name,
      heroId: p.heroId ?? '',
      team: p.team,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      gold: p.gold,
      level: p.level,
      items: p.items,
    }))
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

  function reset() {
    gameId.value = null
    phase.value = 'waiting'
    tick.value = 0
    player.value = null
    visibleZones.value = {}
    allPlayers.value = {}
    teams.value = null
    events.value = []
    announcements.value = []
    nextTickIn.value = 0
    scoreboard.value = []
    gameOverStats.value = null
    winner.value = null
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
    events,
    announcements,
    nextTickIn,
    scoreboard,
    gameOverStats,
    winner,
    // Getters
    currentZone,
    isAlive,
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
    reset,
  }
})
