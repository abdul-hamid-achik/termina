/**
 * Drives the Neon-backed quick-match queue over plain HTTP polling — the
 * only queue path now that the all-Vercel cutover is complete. The DO-era WS
 * push flow (lobby_state/queue_update/etc, pushed by the now-deleted ws.ts)
 * has no equivalent on the Ably+HTTP stack (server/game/matchmaking/
 * queueNeon.ts's queue has no push channel of its own), so this polls
 * GET /api/queue/status-neon on an interval instead, calling back into
 * whatever the page wants done with each state.
 *
 * Deliberately dumb: no store coupling, no navigation — the caller
 * (lobby.vue) decides what 'searching'/'found' mean for its own UI. `$fetch`
 * is a Nuxt auto-import global.
 */
export interface QueuePollStatus {
  status: 'idle' | 'searching' | 'found'
  queueSize?: number
  botFillDue?: boolean
  gameId?: string
}

export interface QueuePollingCallbacks {
  /** Fired exactly once, the poll that first sees `status: 'found'` — polling
   *  stops immediately after. */
  onFound: (gameId: string) => void
  onSearching?: (info: { queueSize: number; botFillDue: boolean }) => void
  onIdle?: () => void
  onError?: (err: unknown) => void
}

export function useQueuePolling() {
  let timer: ReturnType<typeof setInterval> | null = null
  let inFlight = false

  async function _poll(callbacks: QueuePollingCallbacks) {
    if (inFlight) return // don't stack overlapping requests if one is slow
    inFlight = true
    try {
      const res = await $fetch<QueuePollStatus>('/api/queue/status-neon')
      if (res.status === 'found' && res.gameId) {
        stop()
        callbacks.onFound(res.gameId)
      } else if (res.status === 'searching') {
        callbacks.onSearching?.({
          queueSize: res.queueSize ?? 0,
          botFillDue: res.botFillDue ?? false,
        })
      } else {
        callbacks.onIdle?.()
      }
    } catch (err) {
      callbacks.onError?.(err)
    } finally {
      inFlight = false
    }
  }

  /** Start polling every `intervalMs` (default 2s), firing an immediate
   *  poll right away rather than waiting for the first interval tick. */
  function start(callbacks: QueuePollingCallbacks, intervalMs = 2000) {
    stop()
    void _poll(callbacks)
    timer = setInterval(() => void _poll(callbacks), intervalMs)
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  return { start, stop }
}
