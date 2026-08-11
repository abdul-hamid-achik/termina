import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────

// useRuntimeConfig is a Nuxt auto-import (from #imports / nuxt/app).
// We stub it globally so the composable can call it.
let mockPublicConfig: Record<string, string> = {}

vi.stubGlobal('useRuntimeConfig', () => ({ public: mockPublicConfig }))

// ── Subject ────────────────────────────────────────────────────────

const { useApiOrigin, rewriteApiRequest } = await import('../../../app/composables/useServerUrl')

// ── Tests ──────────────────────────────────────────────────────────

describe('useApiOrigin', () => {
  beforeEach(() => {
    mockPublicConfig = {}
  })

  it('returns the apiUrl override when set', () => {
    mockPublicConfig = { apiUrl: 'https://api.example.com' }
    expect(useApiOrigin()).toBe('https://api.example.com')
  })

  it('returns empty string (same-origin) when no override is set', () => {
    mockPublicConfig = {}
    expect(useApiOrigin()).toBe('')
  })

  it('returns empty string for falsy override values', () => {
    mockPublicConfig = { apiUrl: '' }
    expect(useApiOrigin()).toBe('')
  })
})

describe('rewriteApiRequest', () => {
  const ORIGIN = 'https://api.example.com'

  it('rewrites a relative /api/ URL to the API origin AND adds credentials', () => {
    const [url, init] = rewriteApiRequest(ORIGIN, '/api/game/tutorial', { method: 'POST' })
    expect(url).toBe('https://api.example.com/api/game/tutorial')
    expect(init).toEqual({ method: 'POST', credentials: 'include' })
  })

  it('attaches credentials even when no init is provided', () => {
    const [url, init] = rewriteApiRequest(ORIGIN, '/api/leaderboard')
    expect(url).toBe('https://api.example.com/api/leaderboard')
    expect(init).toEqual({ credentials: 'include' })
  })

  it('forces credentials:include over an explicit init value', () => {
    const [, init] = rewriteApiRequest(ORIGIN, '/api/x', { credentials: 'omit' })
    expect(init?.credentials).toBe('include')
  })

  it('passes non-/api/ paths through untouched (no rewrite, no credentials)', () => {
    const init = { method: 'GET' }
    const [url, out] = rewriteApiRequest(ORIGIN, '/login', init)
    expect(url).toBe('/login')
    expect(out).toBe(init)
  })

  it('passes through when the API origin is empty (same-origin dev)', () => {
    const [url, init] = rewriteApiRequest('', '/api/game/tutorial', { method: 'POST' })
    expect(url).toBe('/api/game/tutorial')
    expect(init).toEqual({ method: 'POST' })
  })

  it('does not rewrite already-absolute URLs', () => {
    const abs = 'https://other.example.com/api/x'
    const [url] = rewriteApiRequest(ORIGIN, abs)
    expect(url).toBe(abs)
  })

  it('does not rewrite Request/URL objects', () => {
    const u = new URL('https://api.example.com/api/x')
    const [url] = rewriteApiRequest(ORIGIN, u)
    expect(url).toBe(u)
  })
})
