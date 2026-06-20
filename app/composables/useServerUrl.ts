/**
 * Resolve the WebSocket base origin for the current environment.
 *
 * In dev and single-instance DO deploys, the WS server is same-origin —
 * `window.location.host` is correct. In the Vercel+DO split, the SPA is on
 * Vercel and the WS server is on DO, so the client must connect to the DO
 * origin exposed via `runtimeConfig.public.wsUrl`.
 *
 * Returns the `wss://host` / `ws://host` base (no path or query). Callers
 * append `/ws?...`.
 */
export function useWsOrigin(): string {
  const config = useRuntimeConfig()
  const wsUrl = config.public.wsUrl as string

  if (wsUrl) {
    // Explicit override — normalize to ws/wss protocol.
    const normalized = wsUrl.replace(/^https?:\/\//, (m) => (m === 'https://' ? 'wss://' : 'ws://'))
    return normalized.replace(/^\/+/, '')
  }

  // Same-origin fallback (dev + single-instance).
  if (import.meta.client) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}`
  }
  return 'ws://localhost:3000'
}

/**
 * Resolve the HTTP API base origin for the current environment.
 *
 * Same logic as `useWsOrigin` but for HTTP `$fetch` / `fetch` calls. Empty
 * string = same-origin (relative URLs work). When `apiUrl` is set, callers
 * prepend it to `/api/...` paths.
 */
export function useApiOrigin(): string {
  const config = useRuntimeConfig()
  return (config.public.apiUrl as string) || ''
}
