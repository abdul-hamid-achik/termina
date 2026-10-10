import { randomUUID } from 'node:crypto'

/**
 * Builds a Postgres connection string for a test from parts, so no
 * credential-shaped URL literal is ever committed (secret scanners flag those
 * even when fake). User and password are generated per call unless given.
 */
export function pgUrl(parts: {
  host: string
  database?: string
  user?: string
  password?: string
}): string {
  const url = new URL('postgresql://placeholder')
  url.hostname = parts.host
  url.username = parts.user ?? 'fixture'
  url.password = parts.password ?? randomUUID()
  url.pathname = `/${parts.database ?? 'fixture'}`
  return url.toString()
}
