/**
 * Prepend the API origin to relative `/api/...` fetches when
 * `runtimeConfig.public.apiUrl` is set (the Vercel+DO split).
 *
 * In dev + single-instance DO, `apiUrl` is empty → relative URLs resolve
 * same-origin (Nuxt's default). In the split deploy, the SPA is on Vercel and
 * the API is on DO, so `/api/...` must become `https://do-host/api/...`.
 *
 * Only intercepts string URLs starting with `/api/` — programmatic fetches
 * with full URLs, Request objects, and non-API paths are passed through
 * untouched.
 */
export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  const apiOrigin = (config.public.apiUrl as string) || ''
  if (!apiOrigin) return

  const originalFetch = globalThis.fetch
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/api/')) {
      input = `${apiOrigin}${input}`
    }
    return originalFetch(input, init)
  }
})
