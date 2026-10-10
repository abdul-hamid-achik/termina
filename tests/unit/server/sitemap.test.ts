import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SITE_ORIGIN } from '../../../shared/constants/site'
import { SITEMAP_PATHS, buildSitemapXml } from '../../../server/utils/sitemap'

const root = resolve(__dirname, '../../..')

describe('sitemap', () => {
  it('emits absolute www URLs for every public path', () => {
    const xml = buildSitemapXml()
    expect(xml.startsWith('<?xml')).toBe(true)
    for (const p of SITEMAP_PATHS) expect(xml).toContain(`<loc>${SITE_ORIGIN}${p}</loc>`)
    expect(xml).not.toMatch(/\/(api|admin|lobby|play|login|profile)\b/)
  })

  it('only lists paths that have a page', () => {
    for (const p of SITEMAP_PATHS) {
      const file = p === '/' ? 'index' : p.slice(1)
      expect(existsSync(resolve(root, `app/pages/${file}.vue`)), p).toBe(true)
    }
  })

  it('robots.txt allows the site, points at the sitemap, never blanket-disallows', () => {
    const robots = readFileSync(resolve(root, 'public/robots.txt'), 'utf8')
    expect(robots).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`)
    expect(robots).not.toMatch(/^Disallow:\s*\/\s*$/m)
    expect(robots).toMatch(/^Disallow: \/api\//m)
  })

  it('llms files use absolute www links only', () => {
    for (const f of ['llms.txt', 'llms-full.txt']) {
      const text = readFileSync(resolve(root, `public/${f}`), 'utf8')
      expect(text).toMatch(/^# /)
      const links = [...text.matchAll(/https?:\/\/[^\s)>]+/g)].map((m) => m[0])
      expect(links.length).toBeGreaterThan(0)
      for (const l of links) expect(l.startsWith(`${SITE_ORIGIN}/`), l).toBe(true)
    }
  })
})
