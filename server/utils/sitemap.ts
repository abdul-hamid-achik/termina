import { SITE_ORIGIN } from '~~/shared/constants/site'

// Sitemap source of truth. Canonical host is www (the apex 308-redirects to it).

// Public, indexable pages only. Auth/app pages (/login, /lobby, /play,
// /profile/*, /replay/*, /admin, account recovery) and /api are deliberately
// absent; robots.txt disallows them too. Keep in sync with app/pages
// (tests/unit/server/sitemap.test.ts fails if a listed path has no page).
export const SITEMAP_PATHS = [
  '/',
  '/learn',
  '/cast',
  '/items',
  '/lore',
  '/leaderboard',
  '/terms',
  '/privacy',
] as const

export function buildSitemapXml(paths: readonly string[] = SITEMAP_PATHS): string {
  const urls = paths.map((p) => `  <url>\n    <loc>${SITE_ORIGIN}${p}</loc>\n  </url>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}
