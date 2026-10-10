import { createHash } from 'node:crypto'

/**
 * A short, non-secret fingerprint of WHICH database a connection string points
 * at, so `/api/ready` can show which Neon branch a deployment talks to without
 * exposing the URL. Pooled and direct URLs of the same Neon endpoint hash the
 * same (`ep-xxx-pooler.…` and `ep-xxx.…`); different branches, hosts or
 * database names hash differently. Returns null when there is no usable URL.
 */
export function dbFingerprint(url: string | undefined | null): string | null {
  if (!url) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (!parsed.hostname) return null
  const host = parsed.hostname.replace(/-pooler(?=\.)/, '')
  const database = parsed.pathname.replace(/^\//, '')
  return createHash('sha256').update(`${host}/${database}`).digest('hex').slice(0, 10)
}
