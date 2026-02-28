import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { TeamId } from '~~/shared/types/game'
import { lobbyLog } from '~/utils/logger'

export type QueueStatus = 'idle' | 'searching' | 'found' | 'picking' | 'starting'

type PollResponse =
  | { status: 'searching'; playersInQueue: number; estimatedWaitSeconds: number }
  | {
      status: 'lobby'
      lobbyId: string
      team: TeamId
      players: { playerId: string; team: TeamId; heroId: string | null }[]
      phase: string
    }
  | { status: 'game_starting'; gameId: string }

export const useLobbyStore = defineStore('lobby', () => {
  const queueStatus = ref<QueueStatus>('idle')
  const queueTime = ref(0)
  const playersInQueue = ref(0)
  const estimatedWaitSeconds = ref(0)
  const lobbyId = ref<string | null>(null)
  const gameId = ref<string | null>(null)
  const team = ref<TeamId | null>(null)
  const pickedHeroes = ref<Record<string, string>>({})
  const teamRoster = ref<
    Array<{ playerId: string; name: string; heroId: string | null; team: TeamId }>
  >([])
  const countdown = ref(0)

  let queueTimer: ReturnType<typeof setInterval> | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null

  async function joinQueue(mode: 'ranked_5v5' | 'quick_3v3' | '1v1' = 'ranked_5v5') {
    try {
      const res = await $fetch<{ success: boolean; queueSize: number }>('/api/queue/join', {
        method: 'POST',
        body: { mode },
      })
      playersInQueue.value = res.queueSize
      queueStatus.value = 'searching'
      queueTime.value = 0
      _startTimers()
    } catch (err) {
      lobbyLog.error('Failed to join queue', err)
      throw err
    }
  }

  async function leaveQueue() {
    try {
      await $fetch('/api/queue/leave', { method: 'POST' })
    } catch {
      // Ignore errors on leave
    }
    _reset()
  }

  async function pollQueueStatus() {
    try {
      const res = await $fetch<PollResponse>('/api/queue/status')

      lobbyLog.debug('Poll result', { status: res.status, queueStatus: queueStatus.value })

      if (res.status === 'game_starting') {
        // Game created — skip straight to starting
        gameId.value = res.gameId
        if (queueStatus.value !== 'starting') {
          allPicksComplete()
          // Start countdown in case WS game_countdown message was missed
          if (countdown.value <= 0) startCountdown(3)
        }
      } else if (res.status === 'lobby') {
        // Always sync lobby/team info when we have it
        if (queueStatus.value === 'searching' || !lobbyId.value) {
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
        }

        // Sync pickedHeroes AND teamRoster from poll data.
        // The poll may have heroId values that WS hero_pick messages missed.
        for (const p of res.players) {
          if (p.heroId) {
            pickedHeroes.value = { ...pickedHeroes.value, [p.playerId]: p.heroId }
          }
        }
        // Also update teamRoster heroIds so the roster names display correctly
        if (teamRoster.value.length > 0) {
          let rosterChanged = false
          for (const p of res.players) {
            if (p.heroId) {
              const existing = teamRoster.value.find((m) => m.playerId === p.playerId)
              if (existing && existing.heroId !== p.heroId) {
                rosterChanged = true
              }
            }
          }
          if (rosterChanged) {
            teamRoster.value = teamRoster.value.map((m) => {
              const polled = res.players.find((p) => p.playerId === m.playerId)
              return polled?.heroId ? { ...m, heroId: polled.heroId } : m
            })
          }
        }

        if (res.phase === 'starting' && queueStatus.value !== 'starting') {
          // All picks done, game is about to start
          allPicksComplete()
          // Start countdown in case WS game_countdown message was missed
          if (countdown.value <= 0) startCountdown(3)
        } else if (queueStatus.value === 'searching') {
          matchFound(res.lobbyId)
        }
      } else if (res.status === 'searching') {
        playersInQueue.value = res.playersInQueue
        estimatedWaitSeconds.value = res.estimatedWaitSeconds
      }
    } catch {
      // Ignore poll errors
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
  }

  function allPicksComplete() {
    // Stop queue timer but keep poll timer running as fallback
    // for detecting game_starting if the WS message is missed
    if (queueTimer) {
      clearInterval(queueTimer)
      queueTimer = null
    }
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

  function _startTimers() {
    _stopTimers()
    queueTimer = setInterval(() => {
      queueTime.value++
    }, 1000)
    pollTimer = setInterval(pollQueueStatus, 2000)
  }

  function _stopTimers() {
    if (queueTimer) {
      clearInterval(queueTimer)
      queueTimer = null
    }
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    if (countdownTimer) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }
  }

  function _reset() {
    _stopTimers()
    queueStatus.value = 'idle'
    queueTime.value = 0
    playersInQueue.value = 0
    estimatedWaitSeconds.value = 0
    lobbyId.value = null
    gameId.value = null
    team.value = null
    pickedHeroes.value = {}
    teamRoster.value = []
    countdown.value = 0
  }

  function $dispose() {
    _stopTimers()
  }

  return {
    // State
    queueStatus,
    queueTime,
    playersInQueue,
    estimatedWaitSeconds,
    lobbyId,
    gameId,
    team,
    pickedHeroes,
    teamRoster,
    countdown,
    // Actions
    joinQueue,
    leaveQueue,
    pollQueueStatus,
    matchFound,
    heroPicked,
    allPicksComplete,
    setTeamInfo,
    startCountdown,
    $dispose,
  }
})
