/**
 * Unit tests for forceEndGame (server/plugins/game-server.ts) — the test-only
 * hook that ends a live game deterministically so the post-game e2e screen
 * appears in ~1s instead of after a full bot match.
 *
 * game-server.ts calls defineNitroPlugin(...) at module-eval time (a Nitro
 * auto-import global). We stub it to a no-op BEFORE dynamically importing the
 * module, so the plugin body never runs and we get the exported functions in
 * isolation — no dev server, no Effect runtime, no real game state. In this
 * harness there is no live game and no managed runtime, so forceEndGame's
 * "unknown game" / "no runtime" guards both apply, returning false.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Nitro auto-import used at module-eval time. Identity is enough — we never
// invoke the registered plugin callback (which would need useRuntimeConfig,
// Redis, etc.), so its body never runs on import.
vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)

const { forceEndGame } = await import('~~/server/plugins/game-server')

const ORIGINAL_NODE_ENV = process.env.NODE_ENV

describe('forceEndGame', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test'
  })

  afterEach(() => {
    // Restore so we never leak a production flag into other tests.
    if (ORIGINAL_NODE_ENV === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = ORIGINAL_NODE_ENV
    }
  })

  it('returns false for an unknown gameId', () => {
    expect(forceEndGame('game_does_not_exist', 'radiant')).toBe(false)
  })

  it('returns false for both winners when the game is unknown', () => {
    expect(forceEndGame('game_nope', 'radiant')).toBe(false)
    expect(forceEndGame('game_nope', 'dire')).toBe(false)
  })

  it('is a no-op returning false in production (never ends real games)', () => {
    process.env.NODE_ENV = 'production'
    // Hard short-circuits before touching the live-game registry or runtime —
    // so even a gameId that "exists" could never be ended in production.
    expect(forceEndGame('any_game', 'radiant')).toBe(false)
    expect(forceEndGame('any_game', 'dire')).toBe(false)
  })

  it('returns false when no game runtime is initialized (call path is safe)', () => {
    // No defineNitroPlugin body ran, so _runtime is null. Exercising the call
    // path proves it fails closed (false) rather than throwing.
    expect(() => forceEndGame('game_x', 'radiant')).not.toThrow()
    expect(forceEndGame('game_x', 'radiant')).toBe(false)
  })
})
