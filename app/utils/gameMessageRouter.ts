import type { useGameStore } from '~/stores/game'
import type { ServerMessage } from '~~/shared/types/protocol'
import { socketLog } from '~/utils/logger'

type GameStore = ReturnType<typeof useGameStore>

export interface RouteServerMessageOptions {
  /** Tears down the current transport — called before bouncing to /lobby on a
   *  terminal server error (NOT_ASSIGNED, game_not_found), so a retry loop or
   *  open channel/socket can't keep answering into a dead game. */
  disconnect: () => void
}

/**
 * The store-routing half of the server message switch, shared by every
 * transport that can produce a `ServerMessage`. `useGameChannel.ts`
 * (Ably+HTTP) is the only transport since the all-Vercel cutover:
 * `cycle_state`/`game_over`/`announcement`/`error`/`chat`/`ping_map` arrive
 * over the per-player Ably channel, `action_ack` is synthesized from the
 * POST /api/game/action response.
 *
 * Deliberately excludes anything transport-specific (reconnect scheduling,
 * HTTP request framing — those stay in the caller) and anything that isn't
 * a store concern (chat/ping_map render straight into GameScreen's feed).
 */
export function routeServerMessage(
  gameStore: GameStore,
  msg: ServerMessage,
  opts: RouteServerMessageOptions,
): void {
  switch (msg.type) {
    case 'cycle_state':
      gameStore.updateFromCycle(msg)
      break
    case 'action_ack':
      if (msg.accepted) {
        // The server holds our order for the open batch — flip the HUD's
        // CYCLE line from OPEN to COMMITTED.
        gameStore.markOrderCommitted()
      } else {
        // Reverse the optimistic COMMITTED and reopen the action slot — the
        // server never queued this order.
        gameStore.markOrderRejected()
        gameStore.addAnnouncement(
          msg.reason === 'late'
            ? `[CYCLE] Order arrived after the batch committed — retype it for cycle ${msg.cycle ?? '?'}`
            : '[CYCLE] Order stamped for a future cycle — refresh if this repeats',
          'warning',
        )
      }
      break
    case 'events':
      gameStore.addEvents(msg.events)
      break
    case 'announcement':
      gameStore.addAnnouncement(msg.message, msg.level)
      break
    case 'error':
      socketLog.warn('Server error', { code: msg.code, message: msg.message })
      // NOT_ASSIGNED is terminal, not transient: the server no longer maps us
      // to this game, so retrying the same request answers the same forever
      // and the HUD stays frozen on a board that will never tick again. Being
      // unassigned on the post-game screen is normal (cleanup releases the
      // assignment), so leave a finished match alone.
      if (msg.code === 'NOT_ASSIGNED' && gameStore.phase !== 'ended') {
        gameStore.addAnnouncement(
          '[ERROR] This match is no longer active. Returning to lobby...',
          'error',
        )
        opts.disconnect()
        setTimeout(() => {
          window.location.href = '/lobby'
        }, 2000)
        break
      }
      gameStore.addAnnouncement(`[ERROR] ${msg.message}`, 'error')
      break
    case 'game_over':
      gameStore.setGameOver(
        msg.winner,
        msg.stats,
        msg.mmrChange,
        msg.ranked ?? true,
        msg.durationCycles,
      )
      break
    // chat/ping_map are deliberately NOT store concerns: GameScreen's
    // onMessage handler renders them straight into the local feed.
  }
}
