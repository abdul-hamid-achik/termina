import type { PlayerVisibleState } from '~~/shared/types/game'

/** A parsed spectator websocket message, ready to apply to the view state. */
export type SpectatorMessage =
  | { type: 'ack'; gameId: string }
  | { type: 'tick'; tick: number; state: PlayerVisibleState }
  | { type: 'error'; message: string }
  | { type: 'ignore' }

/**
 * Parse + classify a raw spectator websocket frame. Pure — extracted from the
 * spectate page's onmessage so the input pipeline (JSON safety + the ack/tick/
 * error dispatch + error-message formatting) is unit-tested without a live
 * socket. Unparseable frames and unknown types resolve to `ignore` (dropped).
 */
export function parseSpectatorMessage(raw: unknown): SpectatorMessage {
  let msg: Record<string, unknown>
  try {
    msg = typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>)
  } catch {
    return { type: 'ignore' }
  }
  if (!msg || typeof msg !== 'object') return { type: 'ignore' }

  switch (msg.type) {
    case 'spectator_ack':
      return { type: 'ack', gameId: String(msg.gameId ?? '') }
    case 'spectator_tick':
      return {
        type: 'tick',
        tick: Number(msg.tick ?? 0),
        state: msg.state as PlayerVisibleState,
      }
    case 'error':
      return { type: 'error', message: `${msg.code ?? 'error'}: ${msg.message ?? ''}` }
    default:
      return { type: 'ignore' }
  }
}
