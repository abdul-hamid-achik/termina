// Canonical public origin. The www host is canonical (the apex 308-redirects to it).
export const SITE_ORIGIN = 'https://www.terminamoba.com'

/** Absolute canonical URL for a route path: www host, no query/hash, no trailing slash except "/". */
export function canonicalUrl(path: string): string {
  const clean = (path.split(/[?#]/)[0] ?? '').replace(/\/+$/, '')
  return `${SITE_ORIGIN}${clean.startsWith('/') ? clean : `/${clean}`}`
}
