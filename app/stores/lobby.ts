import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { TeamId } from '~~/shared/types/game'
import { lobbyLog } from '~/utils/logger'
import { useGameStore } from '~/stores/game'

export type QueueStatus = 'idle' | 'searching' | 'found' | 'picking' | 'starting'

export const useLobbyStore = defineStore('lobby', () => {
  const queueStatus = ref<QueueStatus>('idle')
  const queueTime = ref(0)
  const playersInQueue = ref(0)
  const estimatedWaitSeconds = ref(0)
  const queueRoster = ref<{ username: string; mmrBracket: string }[]>([])
  const matchSize = ref(10)
  // Remember which queue mode we joined so leaveQueue can target the right
  // Redis queue keys — leaving with the wrong/default mode leaks the entry.
  const queuedMode = ref<'ranked_5v5' | 'quick_3v3' | '1v1'>('ranked_5v5')
  const botsFilling = ref(false)
  const botsCount = ref(0)
  const lobbyId = ref<string | null>(null)
  const gameId = ref<string | null>(null)
  const team = ref<TeamId | null>(null)
  const pickedHeroes = ref<Record<string, string>>({})
  const teamRoster = ref<
    Array<{ playerId: string; name: string; heroId: string | null; team: TeamId }>
  >([])
  const countdown = ref(0)
  // Whose turn it is in the snake draft + the server-authoritative deadline
  // (epoch ms). Components derive the pick countdown from this instead of
  // running their own drifting timers.
  const currentPicker = ref<{ playerId: string; username: string } | null>(null)
  const pickDeadline = ref<number | null>(null)
  // Last user-facing error (failed queue join, server-rejected pick, WS errors).
  // Rendered inline by the lobby UI instead of dying in the console.
  const lastError = ref<string | null>(null)
  // Optimistic hero pick awaiting server confirmation (hero_pick broadcast).
  // Rolled back via rollbackPendingPick() when the server rejects it.
  const pendingPick = ref<{ playerId: string; heroId: string } | null>(null)

  function setPickTurn(playerId: string, username: string, timeRemainingMs: number) {
    currentPicker.value = { playerId, username }
    pickDeadline.value = Date.now() + timeRemainingMs
  }

  function setError(message: string) {
    lastError.value = message
  }

  function clearError() {
    lastError.value = null
  }

  let queueTimer: ReturnType<typeof setInterval> | null = null

  async function joinQueue(mode: 'ranked_5v5' | 'quick_3v3' | '1v1' = 'ranked_5v5') {
    clearError()
    queuedMode.value = mode
    try {
      const res = await $fetch<{ success: boolean; queueSize: number }>('/api/queue/join', {
        method: 'POST',
        body: { mode },
      })
      playersInQueue.value = res.queueSize
      queueStatus.value = 'searching'
      queueTime.value = 0
      _startQueueTimer()
    } catch (err) {
      lobbyLog.error('Failed to join queue', err)
      lastError.value = `could not join queue — ${_errorReason(err)}`
      throw err
    }
  }

  /** Extract a human-readable reason from a $fetch/network error. */
  function _errorReason(err: unknown): string {
    if (err && typeof err === 'object') {
      const e = err as {
        data?: { message?: string; statusMessage?: string }
        statusMessage?: string
        message?: string
      }
      return (
        e.data?.message ?? e.data?.statusMessage ?? e.statusMessage ?? e.message ?? 'unknown error'
      )
    }
    return String(err ?? 'unknown error')
  }

  async function leaveQueue() {
    try {
      await $fetch('/api/queue/leave', { method: 'POST', body: { mode: queuedMode.value } })
    } catch {
      // Ignore errors on leave
    }
    _reset()
  }

  /** One-shot HTTP recovery for page refresh — not polled. */
  async function recoverState() {
    try {
      const res = await $fetch<
        | { status: 'idle' }
        | { status: 'searching'; playersInQueue: number; estimatedWaitSeconds: number }
        | {
            status: 'lobby'
            lobbyId: string
            team: TeamId
            players: { playerId: string; team: TeamId; heroId: string | null }[]
            phase: string
          }
        | { status: 'game_starting'; gameId: string }
      >('/api/queue/status')

      lobbyLog.debug('Recovery result', { status: res.status })

      if (res.status === 'idle') {
        return null
      } else if (res.status === 'game_starting') {
        gameId.value = res.gameId
        // Also set gameStore.gameId so the lobby.vue navigation watcher triggers
        const gameStore = useGameStore()
        gameStore.gameId = res.gameId
        allPicksComplete()
        if (countdown.value <= 0) startCountdown(3)
      } else if (res.status === 'lobby') {
        lobbyId.value = res.lobbyId
        setTeamInfo(
          res.team,
          res.players.map((p) => ({
            playerId: p.playerId,
            name: p.playerId,
            heroId: p.heroId,
            team: p.team,
          })),
        )
        for (const p of res.players) {
          if (p.heroId) {
            pickedHeroes.value = { ...pickedHeroes.value, [p.playerId]: p.heroId }
          }
        }
        if (res.phase === 'starting') {
          allPicksComplete()
          if (countdown.value <= 0) startCountdown(3)
        } else {
          matchFound(res.lobbyId)
        }
      } else if (res.status === 'searching') {
        queueStatus.value = 'searching'
        playersInQueue.value = res.playersInQueue
        estimatedWaitSeconds.value = res.estimatedWaitSeconds
        queueTime.value = 0
        _startQueueTimer()
      }

      return res.status !== 'searching' ? res.status : 'searching'
    } catch {
      // No active session — stay idle
      return null
    }
  }

  function matchFound(id?: string) {
    queueStatus.value = 'found'
    if (id) lobbyId.value = id
    lobbyLog.info('Match found', { lobbyId: id })
    // Transition to picking after a brief delay — guard against race with allPicksComplete
    setTimeout(() => {
      if (queueStatus.value === 'found') {
        queueStatus.value = 'picking'
        lobbyLog.debug('Transitioned to picking')
      }
    }, 1500)
  }

  function heroPicked(playerId: string, heroId: string) {
    pickedHeroes.value = { ...pickedHeroes.value, [playerId]: heroId }
    // Update roster
    teamRoster.value = teamRoster.value.map((m) => (m.playerId === playerId ? { ...m, heroId } : m))
    // A server hero_pick broadcast for the pending player confirms the optimistic pick
    if (pendingPick.value?.playerId === playerId) {
      pendingPick.value = null
    }
  }

  /** Apply a pick locally before the server confirms it (snappy UI). */
  function optimisticPick(playerId: string, heroId: string) {
    clearError()
    heroPicked(playerId, heroId)
    pendingPick.value = { playerId, heroId }
  }

  /** Undo an optimistic pick the server rejected. No-op once confirmed. */
  function rollbackPendingPick() {
    if (!pendingPick.value) return
    const { playerId } = pendingPick.value
    pickedHeroes.value = Object.fromEntries(
      Object.entries(pickedHeroes.value).filter(([pid]) => pid !== playerId),
    )
    teamRoster.value = teamRoster.value.map((m) =>
      m.playerId === playerId ? { ...m, heroId: null } : m,
    )
    pendingPick.value = null
  }

  function allPicksComplete() {
    _stopQueueTimer()
    queueStatus.value = 'starting'
    lobbyLog.info('All picks complete — transitioning to starting')
  }

  function setTeamInfo(
    teamId: TeamId,
    roster: Array<{ playerId: string; name: string; heroId: string | null; team: TeamId }>,
  ) {
    team.value = teamId
    teamRoster.value = roster
  }

  let countdownTimer: ReturnType<typeof setInterval> | null = null

  function startCountdown(seconds: number) {
    lobbyLog.debug('Starting countdown', { seconds })
    countdown.value = seconds
    if (countdownTimer) clearInterval(countdownTimer)
    countdownTimer = setInterval(() => {
      countdown.value = Math.max(0, countdown.value - 1)
      if (countdown.value <= 0 && countdownTimer) {
        clearInterval(countdownTimer)
        countdownTimer = null
      }
    }, 1000)
  }

  function _startQueueTimer() {
    _stopQueueTimer()
    queueTimer = setInterval(() => {
      queueTime.value++
    }, 1000)
  }

  function _stopQueueTimer() {
    if (queueTimer) {
      clearInterval(queueTimer)
      queueTimer = null
    }
  }

  function _reset() {
    _stopQueueTimer()
    if (countdownTimer) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }
    queueStatus.value = 'idle'
    queueTime.value = 0
    playersInQueue.value = 0
    estimatedWaitSeconds.value = 0
    queueRoster.value = []
    matchSize.value = 10
    botsFilling.value = false
    botsCount.value = 0
    lobbyId.value = null
    gameId.value = null
    team.value = null
    pickedHeroes.value = {}
    teamRoster.value = []
    countdown.value = 0
    currentPicker.value = null
    pickDeadline.value = null
    lastError.value = null
    pendingPick.value = null
  }

  function $dispose() {
    _stopQueueTimer()
    if (countdownTimer) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }
  }

  return {
    // State
    queueStatus,
    queueTime,
    playersInQueue,
    estimatedWaitSeconds,
    queueRoster,
    matchSize,
    botsFilling,
    botsCount,
    lobbyId,
    gameId,
    team,
    pickedHeroes,
    teamRoster,
    countdown,
    currentPicker,
    pickDeadline,
    lastError,
    pendingPick,
    // Actions
    joinQueue,
    leaveQueue,
    recoverState,
    matchFound,
    heroPicked,
    optimisticPick,
    rollbackPendingPick,
    allPicksComplete,
    setTeamInfo,
    startCountdown,
    setPickTurn,
    setError,
    clearError,
    $dispose,
  }
})
