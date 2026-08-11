/**
 * Resolve the HTTP API base origin for the current environment.
 *
 * Empty string = same-origin (relative URLs work). When `apiUrl` is set,
 * callers prepend it to `/api/...` paths — a leftover of the Vercel(www) +
 * DigitalOcean(api) split; kept in case a future deploy ever splits origins
 * again, but empty (same-origin, via vercel.json's `/api/*` rewrite) is the
 * all-Vercel default.
 */
export function useApiOrigin(): string {
  const config = useRuntimeConfig()
  return (config.public.apiUrl as string) || ''
}

/**
 * Pure transform behind the `api-origin.client.ts` fetch shim.
 *
 * When `apiOrigin` is set (a cross-origin API split), a relative `/api/...`
 * call must be sent to that origin AND opt into credentials — otherwise the
 * browser won't attach the shared-domain session cookie to the cross-origin
 * request and every authed endpoint 401s. Non-API URLs, full URLs, and
 * `Request`/`URL` objects pass through untouched (same-origin, no rewrite).
 *
 * Extracted as a pure function so it's unit-testable without the Nuxt runtime.
 */
export function rewriteApiRequest(
  apiOrigin: string,
  input: RequestInfo | URL,
  init?: RequestInit,
): [RequestInfo | URL, RequestInit | undefined] {
  if (apiOrigin && typeof input === 'string' && input.startsWith('/api/')) {
    return [`${apiOrigin}${input}`, { ...init, credentials: 'include' }]
  }
  return [input, init]
}
