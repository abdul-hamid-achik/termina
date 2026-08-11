/**
 * Owner audit items 4 (durable match finalization) and 5 (MMR format scope),
 * both in server/plugins/game-server.ts.
 *
 * game-server.ts calls defineNitroPlugin at module eval, so stub it before
 * import (same pattern as practice-persistence.test.ts / end-stats.test.ts).
 * Everything under test here is a pure, module-level export — none of it
 * needs the plugin body (managedRuntime/Redis/DB layers) to run.
 */
import { readFileSync } from 'node:fs'
import { describe, it, expect, vi } from 'vitest'
import { Effect } from 'effect'
import type { NewMatch, NewMatchPlayer } from '~~/server/db/schema'
import type { MatchDerivedPlayerStats } from '~~/server/services/DatabaseService'

vi.stubGlobal('defineNitroPlugin', (fn: unknown) => fn)

const {
  isRankedMatch,
  finalizePendingKey,
  writeFinalizePending,
  deleteFinalizePending,
  sweepFinalizePending,
  finalizeMatchIntent,
  FINALIZE_PENDING_TTL_SECONDS,
} = await import('~~/server/plugins/game-server')
type FinalizeIntent = Awaited<ReturnType<typeof sweepFinalizePending>>[number]

function matchRecord(over: Partial<NewMatch> = {}): NewMatch {
  return {
    id: 'game_1',
    mode: 'ranked_5v5',
    winner: 'chaff',
    durationCycles: 900,
    seasonNumber: 1,
    endedAt: new Date('2026-08-10T00:00:00Z'),
    ...over,
  }
}

function matchPlayers(): NewMatchPlayer[] {
  return [
    {
      matchId: 'game_1',
      playerId: 'p1',
      team: 'chaff',
      heroId: 'echo',
      kills: 5,
      deaths: 1,
      assists: 3,
      finalScrip: 500,
      netWorth: 1200,
      damageDealt: 9000,
      iceDamageDealt: 200,
      lastHits: 30,
      burns: 4,
      finalItems: [],
      finalLevel: 12,
      mmrChange: 15,
    },
  ]
}

function derivedPlayers(): MatchDerivedPlayerStats[] {
  return [
    {
      playerId: 'p1',
      heroId: 'echo',
      won: true,
      ranked: true,
      mmrChange: 15,
      kills: 5,
      deaths: 1,
      assists: 3,
    },
  ]
}

function intent(over: Partial<FinalizeIntent> = {}): FinalizeIntent {
  return {
    matchRecord: matchRecord(),
    matchPlayerRecords: matchPlayers(),
    derivedPlayers: derivedPlayers(),
    ...over,
  }
}

// ── Item 5: MMR format scope ────────────────────────────────────────────────

describe('isRankedMatch (owner audit item 5)', () => {
  it('ranks a full 10-player human-only 5v5', () => {
    expect(isRankedMatch(10, false)).toBe(true)
  })

  it('does NOT rank a 5v5 that contains any bots', () => {
    expect(isRankedMatch(10, true)).toBe(false)
  })

  it('does NOT rank a human-only 1v1', () => {
    // REGRESSION: `!hasBots` alone used to treat this as ranked, writing the
    // same mmr/seasonMmr change a full 5v5 would.
    expect(isRankedMatch(2, false)).toBe(false)
  })

  it('does NOT rank a human-only 3v3', () => {
    expect(isRankedMatch(6, false)).toBe(false)
  })
})

// ── Item 4: durable finalization primitives ─────────────────────────────────

describe('finalizePendingKey', () => {
  it('is namespaced by gameId', () => {
    expect(finalizePendingKey('game_1')).toBe('finalize:pending:game_1')
  })
})

describe('writeFinalizePending / deleteFinalizePending', () => {
  it('mirrors the intent keyed by the match id with a bounded TTL', async () => {
    const set = vi.fn(() => Effect.void)
    const redis = { set } as never

    await Effect.runPromise(writeFinalizePending(redis, intent()))

    expect(set).toHaveBeenCalledWith(
      finalizePendingKey('game_1'),
      JSON.stringify(intent()),
      FINALIZE_PENDING_TTL_SECONDS,
    )
  })

  it('deletes the pending mirror by gameId', async () => {
    const del = vi.fn(() => Effect.void)
    const redis = { del } as never

    await Effect.runPromise(deleteFinalizePending(redis, 'game_1'))

    expect(del).toHaveBeenCalledWith(finalizePendingKey('game_1'))
  })
})

describe('sweepFinalizePending', () => {
  it('finds and rehydrates every pending intent, restoring endedAt as a Date', async () => {
    const redis = {
      scan: vi.fn(() => Effect.succeed([finalizePendingKey('game_1')])),
      get: vi.fn(() => Effect.succeed(JSON.stringify(intent()))),
    } as never

    const found = await Effect.runPromise(sweepFinalizePending(redis))
    expect(found).toHaveLength(1)
    expect(found[0]!.matchRecord.id).toBe('game_1')
    // JSON.stringify turns a Date into an ISO string — the sweep must rebuild
    // it, since drizzle's timestamp column expects a real Date going back in.
    expect(found[0]!.matchRecord.endedAt).toBeInstanceOf(Date)
  })

  it('skips a corrupt entry without failing the rest of the sweep', async () => {
    const redis = {
      scan: vi.fn(() =>
        Effect.succeed([finalizePendingKey('game_bad'), finalizePendingKey('game_good')]),
      ),
      get: vi.fn((key: string) =>
        Effect.succeed(key.includes('game_bad') ? '{not json' : JSON.stringify(intent())),
      ),
    } as never

    const found = await Effect.runPromise(sweepFinalizePending(redis))
    expect(found).toHaveLength(1)
    expect(found[0]!.matchRecord.id).toBe('game_1')
  })

  it('returns nothing when there are no pending keys', async () => {
    const redis = { scan: vi.fn(() => Effect.succeed([])), get: vi.fn() } as never
    expect(await Effect.runPromise(sweepFinalizePending(redis))).toEqual([])
    expect(redis.get).not.toHaveBeenCalled()
  })
})

describe('finalizeMatchIntent', () => {
  it('persists the match and applies derived stats, reporting success', async () => {
    const db = {
      recordMatch: vi.fn(() => Effect.succeed('inserted' as const)),
      applyMatchDerivedStats: vi.fn(() => Effect.succeed(true)),
    } as never

    const ok = await Effect.runPromise(finalizeMatchIntent(db, intent()))
    expect(ok).toBe(true)
    expect(db.recordMatch).toHaveBeenCalledWith(matchRecord(), matchPlayers())
    expect(db.applyMatchDerivedStats).toHaveBeenCalledWith('game_1', derivedPlayers())
  })

  it('is idempotent: an already-persisted match still applies/settles derived stats', async () => {
    const db = {
      recordMatch: vi.fn(() => Effect.succeed('already_exists' as const)),
      applyMatchDerivedStats: vi.fn(() => Effect.succeed(false)), // claim already taken — no-op
    } as never

    const ok = await Effect.runPromise(finalizeMatchIntent(db, intent()))
    expect(ok).toBe(true)
    expect(db.applyMatchDerivedStats).toHaveBeenCalled()
  })

  it('reports failure and skips derived stats when the match write failed', async () => {
    const db = {
      recordMatch: vi.fn(() => Effect.succeed('failed' as const)),
      applyMatchDerivedStats: vi.fn(() => Effect.succeed(true)),
    } as never

    const ok = await Effect.runPromise(finalizeMatchIntent(db, intent()))
    expect(ok).toBe(false)
    expect(db.applyMatchDerivedStats).not.toHaveBeenCalled()
  })
})

/**
 * Boot-sweep semantics (owner audit item 4): a pending finalize intent left
 * over from a crashed process is found, replayed through the exact same
 * idempotent persistence path, and only then has its durable mirror deleted.
 * This composes the primitives the same way the plugin's boot-time sweep does
 * (sweep → finalizeMatchIntent → delete-on-success), without booting the
 * plugin itself.
 */
describe('boot sweep composes to: pending key present → processed → key deleted', () => {
  it('replays a pending intent and deletes its key once persistence succeeds', async () => {
    const stored = new Map<string, string>([
      [finalizePendingKey('game_1'), JSON.stringify(intent())],
    ])
    const redis = {
      scan: vi.fn(() => Effect.succeed([...stored.keys()])),
      get: vi.fn((key: string) => Effect.succeed(stored.get(key) ?? null)),
      del: vi.fn((key: string) => {
        stored.delete(key)
        return Effect.void
      }),
    } as never
    const db = {
      recordMatch: vi.fn(() => Effect.succeed('inserted' as const)),
      applyMatchDerivedStats: vi.fn(() => Effect.succeed(true)),
    } as never

    const pending = await Effect.runPromise(sweepFinalizePending(redis))
    expect(pending).toHaveLength(1)

    for (const found of pending) {
      const persisted = await Effect.runPromise(finalizeMatchIntent(db, found))
      if (persisted) await Effect.runPromise(deleteFinalizePending(redis, found.matchRecord.id))
    }

    expect(db.recordMatch).toHaveBeenCalledTimes(1)
    expect(redis.del).toHaveBeenCalledWith(finalizePendingKey('game_1'))
    expect(stored.has(finalizePendingKey('game_1'))).toBe(false)
  })

  it('leaves the pending key in place when persistence still fails', async () => {
    const stored = new Map<string, string>([
      [finalizePendingKey('game_1'), JSON.stringify(intent())],
    ])
    const redis = {
      scan: vi.fn(() => Effect.succeed([...stored.keys()])),
      get: vi.fn((key: string) => Effect.succeed(stored.get(key) ?? null)),
      del: vi.fn((key: string) => {
        stored.delete(key)
        return Effect.void
      }),
    } as never
    const db = {
      recordMatch: vi.fn(() => Effect.succeed('failed' as const)),
      applyMatchDerivedStats: vi.fn(() => Effect.succeed(true)),
    } as never

    const pending = await Effect.runPromise(sweepFinalizePending(redis))
    for (const found of pending) {
      const persisted = await Effect.runPromise(finalizeMatchIntent(db, found))
      if (persisted) await Effect.runPromise(deleteFinalizePending(redis, found.matchRecord.id))
    }

    expect(redis.del).not.toHaveBeenCalled()
    expect(stored.has(finalizePendingKey('game_1'))).toBe(true)
  })
})

/**
 * onGameOver + the plugin boot sequence are closures over the Effect runtime
 * and can't be invoked from a unit test (see forceEndGame.test.ts). The
 * primitives above prove the durability logic is correct in isolation; these
 * assert the plugin actually WIRES them in, the same source-invariant
 * technique game-message-scoping.test.ts uses for buildCallbacks.
 */
function fileSource(): string {
  return readFileSync(new URL('../../../server/plugins/game-server.ts', import.meta.url), 'utf8')
}

describe('game-server wiring (source invariants)', () => {
  it('writes the finalize-pending intent before persisting, in onGameOver', () => {
    const src = fileSource()
    const writeAt = src.indexOf('writeFinalizePending(redis, intent)')
    const reconcileAt = src.indexOf('reconcileFinalization(intent)')
    expect(writeAt).toBeGreaterThan(-1)
    expect(reconcileAt).toBeGreaterThan(-1)
    expect(writeAt).toBeLessThan(reconcileAt)
  })

  it('sweeps pending finalize intents on boot and reconciles each one', () => {
    const src = fileSource()
    expect(src).toContain('sweepFinalizePending(redis)')
    expect(src).toContain('reconcileFinalization(intent)')
  })

  it('sweeps pending game_ready handoffs on boot and reprocesses each one', () => {
    const src = fileSource()
    expect(src).toContain('sweepGameReadyPending(redis)')
    expect(src).toContain('processGameReadyPayload(payload)')
  })

  it('only deletes the game_ready pending mirror after the game loop has started', () => {
    const src = fileSource()
    const startAt = src.indexOf(
      'startGameLoop(gameId, stateManager, callbacks, managedRuntime, redis, snapshotMeta)',
    )
    const deleteAt = src.indexOf('deleteGameReadyPending(redis, gameId)')
    expect(startAt).toBeGreaterThan(-1)
    expect(deleteAt).toBeGreaterThan(-1)
    expect(startAt).toBeLessThan(deleteAt)
  })
})
