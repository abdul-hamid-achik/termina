import { rewriteApiRequest } from '~/composables/useServerUrl'

/**
 * Route relative `/api/...` fetches to the DO API origin when
 * `runtimeConfig.public.apiUrl` is set (the Vercel+DO split), attaching
 * `credentials: 'include'` so the shared-domain session cookie rides along.
 *
 * In dev + single-instance DO, `apiUrl` is empty → relative URLs resolve
 * same-origin (Nuxt's default) and this plugin no-ops. In the split deploy the
 * SPA is on Vercel and the API is on DO, so `/api/...` must become
 * `https://do-host/api/...` AND send credentials — without the latter the
 * browser drops the cookie on the cross-origin request and authed calls 401.
 *
 * Only string URLs starting with `/api/` are rewritten (see `rewriteApiRequest`);
 * full URLs, `Request`/`URL` objects, and non-API paths are passed through.
 */
export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  const apiOrigin = (config.public.apiUrl as string) || ''
  if (!apiOrigin) return

  const originalFetch = globalThis.fetch
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
    originalFetch(...rewriteApiRequest(apiOrigin, input, init))
})
