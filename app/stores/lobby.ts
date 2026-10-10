import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { TeamId } from '~~/shared/types/game'
import { lobbyLog } from '~/utils/logger'
import { useGameStore } from '~/stores/game'

export type QueueStatus = 'idle' | 'searching' | 'found' | 'banning' | 'picking' | 'starting'

export const useLobbyStore = defineStore('lobby', () => {
  const queueStatus = ref<QueueStatus>('idle')
  const queueTime = ref(0)
  const playersInQueue = ref(0)
  const estimatedWaitSeconds = ref(0)
  const queueRoster = ref<{ username: string; mmrBracket: string }[]>([])
  const matchSize = ref(10)
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
  // Ban phase: heroes removed from the draft + whose turn it is to ban and the
  // server-authoritative ban deadline (mirrors currentPicker/pickDeadline).
  const bannedHeroes = ref<string[]>([])
  const currentBanner = ref<{ playerId: string; username: string } | null>(null)
  const banDeadline = ref<number | null>(null)
  // Last user-facing error (failed queue join, server-rejected pick, WS errors).
  // Rendered inline by the lobby UI instead of dying in the console.
  const lastError = ref<string | null>(null)
  // Last server announcement during the lobby/draft phase (match cancelled, a
  // player replaced by a bot, …). Surfaced as a transient toast — the `seq`
  // counter re-fires the toast even for a repeated message.
  const lastAnnouncement = ref<{
    message: string
    level: 'info' | 'warning' | 'kill' | 'objective'
    seq: number
  } | null>(null)
  // Optimistic hero pick awaiting server confirmation (hero_pick broadcast).
  // Rolled back via rollbackPendingPick() when the server rejects it.
  const pendingPick = ref<{ playerId: string; heroId: string } | null>(null)

  function setPickTurn(playerId: string, username: string, timeRemainingMs: number) {
    currentPicker.value = { playerId, username }
    pickDeadline.value = Date.now() + timeRemainingMs
  }

  function setBanTurn(playerId: string, username: string, timeRemainingMs: number) {
    currentBanner.value = { playerId, username }
    banDeadline.value = Date.now() + timeRemainingMs
    queueStatus.value = 'banning'
  }

  /** Record a banned hero (idempotent). */
  function heroBanned(heroId: string) {
    if (!bannedHeroes.value.includes(heroId)) {
      bannedHeroes.value = [...bannedHeroes.value, heroId]
    }
  }

  function setError(message: string) {
    lastError.value = message
  }

  function clearError() {
    lastError.value = null
  }

  function setAnnouncement(
    message: string,
    level: 'info' | 'warning' | 'kill' | 'objective' = 'info',
  ) {
    lastAnnouncement.value = {
      message,
      level,
      seq: (lastAnnouncement.value?.seq ?? 0) + 1,
    }
  }

  let queueTimer: ReturnType<typeof setInterval> | null = null
  let foundTransitionTimer: ReturnType<typeof setTimeout> | null = null

  async function joinQueue(mode: 'ranked_5v5' | 'quick_3v3' | '1v1' = 'ranked_5v5') {
    clearError()
    try {
      const res = await $fetch<{ success: boolean; queueSize: number; gameId?: string }>(
        '/api/queue/join-neon',
        {
          method: 'POST',
          body: { mode },
        },
      )
      // This very join completed (or bot-filled) a roster and the game is
      // already running — no queue to sit in.
      if (res.gameId) {
        _adoptGame(res.gameId)
        return
      }
      playersInQueue.value = res.queueSize
      queueStatus.value = 'searching'
      queueTime.value = 0
      _startQueueTimer()
    } catch (err) {
      lobbyLog.error('Failed to join queue', err)
      // 409 = the server refused because we're already in an active game. Don't
      // dead-end the player with a confusing "could not join queue" error —
      // recover straight back into that game (recoverState detects it and the
      // gameStore.gameId watcher in lobby.vue navigates to /play).
      if (_errorStatus(err) === 409) {
        const recovered = await recoverState()
        if (recovered === 'found') return
      }
      lastError.value = `could not join queue — ${_errorReason(err)}`
      throw err
    }
  }

  /** Extract an HTTP status code from a $fetch/network error, if present. */
  function _errorStatus(err: unknown): number | undefined {
    if (err && typeof err === 'object') {
      const e = err as { statusCode?: number; status?: number; response?: { status?: number } }
      return e.statusCode ?? e.status ?? e.response?.status
    }
    return undefined
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
      // One queue row per player (player_id is the PK), so no mode is needed.
      await $fetch('/api/queue/leave-neon', { method: 'POST' })
    } catch {
      // Ignore errors on leave
    }
    _reset()
  }

  /** Point the store (and the game store, whose gameId the lobby page
   *  watches to navigate to /play) at a running game. */
  function _adoptGame(id: string) {
    gameId.value = id
    const gameStore = useGameStore()
    gameStore.gameId = id
    allPicksComplete()
    if (countdown.value <= 0) startCountdown(3)
  }

  /** One-shot HTTP recovery for page refresh — not polled. */
  async function recoverState(): Promise<'found' | 'searching' | null> {
    try {
      const res = await $fetch<
        | { status: 'idle' }
        | { status: 'searching'; queueSize: number; botFillDue?: boolean }
        | { status: 'found'; gameId: string }
      >('/api/queue/status-neon')

      lobbyLog.debug('Recovery result', { status: res.status })

      if (res.status === 'found') {
        _adoptGame(res.gameId)
        return 'found'
      }
      if (res.status === 'searching') {
        queueStatus.value = 'searching'
        playersInQueue.value = res.queueSize
        botsFilling.value = res.botFillDue ?? false
        queueTime.value = 0
        _startQueueTimer()
        return 'searching'
      }

      // Server says we're in nothing — if the store is still showing a
      // pre-game phase (e.g. a cancel message was missed), reset back to
      // find-match instead of staying frozen.
      if (queueStatus.value !== 'idle') {
        const note = lastAnnouncement.value
        _reset()
        lastAnnouncement.value = note // keep any "cancelled" toast across reset
      }
      return null
    } catch {
      // No active session — stay idle
      return null
    }
  }

  function matchFound(id?: string) {
    if (id) lobbyId.value = id
    // Idempotent: the 3s HTTP recovery poll calls this on every cycle for an
    // active lobby. Without this guard it would reset a player already drafting
    // back to the 'found' splash every poll (the picking↔found bounce). Only run
    // the found→picking transition from a genuinely pre-match state.
    if (
      queueStatus.value === 'found' ||
      queueStatus.value === 'banning' ||
      queueStatus.value === 'picking' ||
      queueStatus.value === 'starting'
    ) {
      return
    }
    queueStatus.value = 'found'
    lobbyLog.info('Match found', { lobbyId: id })
    // Transition to picking after a brief delay — guard against race with
    // allPicksComplete. Tracked + cleared in _reset/$dispose so a leave→rejoin
    // within the 1.5s window can't fire this stale timer onto the new lobby.
    if (foundTransitionTimer) clearTimeout(foundTransitionTimer)
    foundTransitionTimer = setTimeout(() => {
      foundTransitionTimer = null
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
    if (foundTransitionTimer) {
      clearTimeout(foundTransitionTimer)
      foundTransitionTimer = null
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
    bannedHeroes.value = []
    currentBanner.value = null
    banDeadline.value = null
    lastError.value = null
    lastAnnouncement.value = null
    pendingPick.value = null
  }

  function $dispose() {
    _stopQueueTimer()
    if (countdownTimer) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }
    if (foundTransitionTimer) {
      clearTimeout(foundTransitionTimer)
      foundTransitionTimer = null
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
    bannedHeroes,
    currentBanner,
    banDeadline,
    lastError,
    lastAnnouncement,
    pendingPick,
    // Actions
    joinQueue,
    leaveQueue,
    recoverState,
    // Public reset — clears all queue/lobby state + timers (used on logout so a
    // prior session's lobby state can't leak into the next one on a shared tab).
    reset: _reset,
    matchFound,
    heroPicked,
    optimisticPick,
    rollbackPendingPick,
    allPicksComplete,
    setTeamInfo,
    startCountdown,
    setPickTurn,
    setBanTurn,
    heroBanned,
    setError,
    clearError,
    setAnnouncement,
    $dispose,
  }
})
