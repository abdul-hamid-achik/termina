import { randomUUID } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { dbFingerprint } from '~~/server/utils/dbFingerprint'
import { pgUrl } from '../../helpers/pgUrl'

// Connection strings are assembled at runtime from parts on a reserved `.test`
// domain — no credential-shaped literal lives in the repo.
const endpoint = 'ep-fixture-one'
const pooled = pgUrl({ host: `${endpoint}-pooler.db.example.test`, database: 'neondb' })
const direct = pgUrl({ host: `${endpoint}.db.example.test`, database: 'neondb' })
const otherBranch = pgUrl({ host: 'ep-fixture-two-pooler.db.example.test', database: 'neondb' })

describe('dbFingerprint', () => {
  it('is identical for the pooled and direct URL of the same endpoint', () => {
    expect(dbFingerprint(pooled)).toBe(dbFingerprint(direct))
  })

  it('differs between two endpoints (e.g. main vs preview branch)', () => {
    expect(dbFingerprint(pooled)).not.toBe(dbFingerprint(otherBranch))
  })

  it('never leaks the host, user or password', () => {
    const password = randomUUID()
    const fp = dbFingerprint(pgUrl({ host: `${endpoint}.db.example.test`, password }))!
    expect(fp).toMatch(/^[0-9a-f]{10}$/)
    expect(fp).not.toContain(endpoint)
    expect(fp).not.toContain(password)
  })

  it('distinguishes databases on the same host', () => {
    const a = pgUrl({ host: 'db.example.test', database: 'termina' })
    const b = pgUrl({ host: 'db.example.test', database: 'termina_test' })
    expect(dbFingerprint(a)).not.toBe(dbFingerprint(b))
  })

  it('returns null for a missing or unparseable URL', () => {
    expect(dbFingerprint(undefined)).toBeNull()
    expect(dbFingerprint('')).toBeNull()
    expect(dbFingerprint('not a url')).toBeNull()
  })
})
