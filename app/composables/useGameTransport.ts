import { useGameChannel } from '~/composables/useGameChannel'

/**
 * The realtime transport for an in-game connection. Used to pick between the
 * DigitalOcean WebSocket (useGameSocket) and the Ably+HTTP path
 * (useGameChannel) behind a runtime flag during the all-Vercel migration;
 * the DO transport (and the flag) is gone now that the cutover is complete —
 * this is a thin, permanent wrapper so GameScreen.vue's call site didn't need
 * to change.
 */
export function useGameTransport() {
  return useGameChannel()
}
