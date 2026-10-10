import { buildSitemapXml } from '../utils/sitemap'

export default defineEventHandler((event) => {
  setHeader(event, 'content-type', 'application/xml; charset=utf-8')
  setHeader(event, 'cache-control', 'public, max-age=3600, s-maxage=86400')
  return buildSitemapXml()
})
