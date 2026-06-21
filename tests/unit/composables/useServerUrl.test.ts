import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────

// useRuntimeConfig is a Nuxt auto-import (from #imports / nuxt/app).
// We stub it globally so the composable can call it.
let mockPublicConfig: Record<string, string> = {}

vi.stubGlobal('useRuntimeConfig', () => ({ public: mockPublicConfig }))

// ── Subject ────────────────────────────────────────────────────────

const { useWsOrigin, useApiOrigin } = await import('../../../app/composables/useServerUrl')

// ── Tests ──────────────────────────────────────────────────────────

describe('useWsOrigin', () => {
  beforeEach(() => {
    mockPublicConfig = {}
  })

  it('uses explicit wsUrl override with ws:// protocol normalization', () => {
    mockPublicConfig = { wsUrl: 'http://ws.example.com' }
    expect(useWsOrigin()).toBe('ws://ws.example.com')
  })

  it('normalizes https:// override to wss://', () => {
    mockPublicConfig = { wsUrl: 'https://ws.example.com' }
    expect(useWsOrigin()).toBe('wss://ws.example.com')
  })

  it('passes through ws:// and wss:// overrides unchanged', () => {
    mockPublicConfig = { wsUrl: 'ws://ws.example.com' }
    expect(useWsOrigin()).toBe('ws://ws.example.com')

    mockPublicConfig = { wsUrl: 'wss://ws.example.com' }
    expect(useWsOrigin()).toBe('wss://ws.example.com')
  })

  it('strips leading slashes from a protocol-relative override', () => {
    // A protocol-relative override has no http(s):// to rewrite, so it exercises
    // the `replace(/^\/+/, '')` strip (the https:// case never has leading
    // slashes after normalization, so it wouldn't test this path at all).
    mockPublicConfig = { wsUrl: '//ws.example.com' }
    expect(useWsOrigin()).toBe('ws.example.com')
  })

  it('falls back to ws://localhost:3000 when no override and not on client', () => {
    mockPublicConfig = {}
    expect(useWsOrigin()).toBe('ws://localhost:3000')
  })
})

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
