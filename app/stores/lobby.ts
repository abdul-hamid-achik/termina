import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { TeamId } from '~~/shared/types/game'

export type QueueStatus = 'idle' | 'searching' | 'found' | 'picking' | 'starting'

export const useLobbyStore = defineStore('lobby', () => {
  const queueStatus = ref<QueueStatus>('idle')
  const queueTime = ref(0)
  const playersInQueue = ref(0)
  const estimatedWaitSeconds = ref(0)
  const lobbyId = ref<string | null>(null)
  const team = ref<TeamId | null>(null)
  const pickedHeroes = ref<Record<string, string>>({})
  const teamRoster = ref<Array<{ playerId: string; name: string; heroId: string | null }>>([])

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
      // eslint-disable-next-line no-console
      console.error('[Lobby] Failed to join queue:', err)
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
      const res = await $fetch<{ playersInQueue: number; estimatedWaitSeconds: number }>(
        '/api/queue/status',
      )
      playersInQueue.value = res.playersInQueue
      estimatedWaitSeconds.value = res.estimatedWaitSeconds
    } catch {
      // Ignore poll errors
    }
  }

  function matchFound(id?: string) {
    queueStatus.value = 'found'
    if (id) lobbyId.value = id
    _stopTimers()
    // Transition to picking after a brief delay
    setTimeout(() => {
      queueStatus.value = 'picking'
    }, 1500)
  }

  function heroPicked(playerId: string, heroId: string) {
    pickedHeroes.value = { ...pickedHeroes.value, [playerId]: heroId }
    // Update roster
    teamRoster.value = teamRoster.value.map((m) => (m.playerId === playerId ? { ...m, heroId } : m))
  }

  function allPicksComplete() {
    queueStatus.value = 'starting'
  }

  function setTeamInfo(
    teamId: TeamId,
    roster: Array<{ playerId: string; name: string; heroId: string | null }>,
  ) {
    team.value = teamId
    teamRoster.value = roster
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
  }

  function _reset() {
    _stopTimers()
    queueStatus.value = 'idle'
    queueTime.value = 0
    playersInQueue.value = 0
    estimatedWaitSeconds.value = 0
    lobbyId.value = null
    team.value = null
    pickedHeroes.value = {}
    teamRoster.value = []
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
    team,
    pickedHeroes,
    teamRoster,
    // Actions
    joinQueue,
    leaveQueue,
    pollQueueStatus,
    matchFound,
    heroPicked,
    allPicksComplete,
    setTeamInfo,
    $dispose,
  }
})
