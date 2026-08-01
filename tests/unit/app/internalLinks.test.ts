import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Every internal link in the app points at a page that exists.
 *
 * Nuxt resolves routes at runtime from the filesystem, so a `<NuxtLink
 * to="/heroes">` left behind by a page rename type-checks, lints, builds and
 * ships — and then 404s for a player with nothing failing anywhere in CI. The
 * `/heroes` → `/cast` rename touched six link sites in five files; missing one
 * would have been invisible.
 *
 * So this walks the link literals rather than trusting a grep at rename time.
 * It is deliberately literal-only: a link assembled from a variable can't be
 * checked here, and pretending otherwise would be worse than not checking.
 */
const APP = join(process.cwd(), 'app')
const PAGES = join(APP, 'pages')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

/** Filesystem pages → the route patterns Nuxt will actually serve. */
function knownRoutes(): Set<string> {
  const routes = new Set<string>()
  for (const file of walk(PAGES)) {
    if (!file.endsWith('.vue')) continue
    const rel = relative(PAGES, file).replace(/\.vue$/, '')
    const segments = rel
      .split(/[/\\]/)
      // `[id]` / `[gameId]` are params — any value matches.
      .map((s) => (s.startsWith('[') && s.endsWith(']') ? ':param' : s))
    if (segments.at(-1) === 'index') segments.pop()
    routes.add('/' + segments.join('/'))
  }
  return routes
}

/**
 * Link targets written as literals: `to="/x"`, `:to="'/x'"` and the template
 * form `` :to="`/x?hero=${id}`" ``. Interpolations become `:param` because
 * that is exactly what they fill in a route.
 */
function linksIn(source: string): string[] {
  const found: string[] = []
  const patterns = [
    /\bto="(\/[^"{}]*)"/g, // to="/cast"
    /:to="`(\/[^`]*)`"/g, // :to="`/cast?hero=${id}`"
    /:to="'(\/[^']*)'"/g, // :to="'/cast'"
    /navigateTo\(\s*'(\/[^']*)'/g, // navigateTo('/lobby')
    /navigateTo\(\s*"(\/[^"]*)"/g,
  ]
  for (const re of patterns) {
    for (const m of source.matchAll(re)) found.push(m[1]!)
  }
  return found
}

/** `/cast?hero=${id}` → `['cast']`; `/profile/${id}` → `['profile', ':param']`. */
function normalise(link: string): string[] {
  return link
    .split('?')[0]!
    .split('#')[0]!
    .split('/')
    .map((s) => (s.includes('${') ? ':param' : s))
    .filter((s) => s !== '')
}

/**
 * Does a link match a route the filesystem serves?
 *
 * Segment-wise, because a param slot accepts a literal: `/profile/me` is a
 * perfectly live link into `profile/[id].vue`. Comparing normalised strings
 * flagged it as dead, which is exactly the kind of false alarm that gets a
 * guard deleted instead of trusted.
 */
function resolves(link: string, routes: Set<string>): boolean {
  const segments = normalise(link)
  for (const route of routes) {
    const pattern = route.split('/').filter((s) => s !== '')
    if (pattern.length !== segments.length) continue
    if (pattern.every((p, i) => p === ':param' || p === segments[i])) return true
  }
  return false
}

describe('internal links', () => {
  const routes = knownRoutes()

  // `/api/*` is server-handled, and an external URL is not ours to check.
  const EXTERNAL = /^\/api\//

  const links: Array<{ file: string; link: string }> = []
  for (const file of walk(APP)) {
    if (!file.endsWith('.vue') && !file.endsWith('.ts')) continue
    const source = readFileSync(file, 'utf8')
    for (const link of linksIn(source)) {
      if (EXTERNAL.test(link)) continue
      links.push({ file: relative(process.cwd(), file), link })
    }
  }

  it('finds link literals to check (otherwise this file proves nothing)', () => {
    expect(links.length).toBeGreaterThan(8)
  })

  it('every internal link resolves to a page that exists', () => {
    const dead = links.filter(({ link }) => !resolves(link, routes))
    expect(
      dead.map(({ file, link }) => `${file} → ${link}`),
      'these links 404 at runtime with nothing failing at build time',
    ).toEqual([])
  })

  it('every page is reachable from at least one link or the nav', () => {
    // Not a hard invariant for auth/flow pages (a reset-password page is
    // reached from an email), so this only reports — but a *content* page
    // nothing points at is a page nobody will find.
    const CONTENT = ['/cast', '/items', '/lore', '/learn', '/leaderboard']
    const linked = new Set(links.map(({ link }) => '/' + normalise(link).join('/')))
    for (const route of CONTENT) {
      expect(routes.has(route), `${route} is linked but does not exist`).toBe(true)
      expect(linked.has(route), `${route} exists but nothing links to it`).toBe(true)
    }
  })
})
