import { useGameSocket } from '~/composables/useGameSocket'
import { useGameChannel } from '~/composables/useGameChannel'

/**
 * Picks the realtime transport by the `ablyTransport` runtime flag
 * (NUXT_PUBLIC_ABLY_TRANSPORT, default false) — the DigitalOcean WebSocket
 * (useGameSocket) or the Ably+HTTP migration path (useGameChannel). Both
 * composables expose the same public surface (connect/disconnect,
 * connected/reconnecting/connectionLost/latency refs, send, onMessage), so
 * call sites use whichever this returns without a branch of their own.
 */
export function useGameTransport() {
  const config = useRuntimeConfig()
  return config.public.ablyTransport ? useGameChannel() : useGameSocket()
}
