import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN } from './harness'
import { getBotPlayerIds, isGameBot, cleanupGame, getBotLane } from '~~/server/game/ai/BotManager'
import { rehydrateRegistries } from '~~/server/workflows/gameTickCore'
import type { LiveGameRoster } from '~~/server/db/schema'
import type { Run } from './harness'

/**
 * Engine-truth coverage for the AFK → bot takeover, driven through the real
 * processCycle (no browser/server/DB). The harness never submits actions unless
 * told to, so a seeded human is idle by default — exactly the AFK case. The
 * takeover fires on the 60-tick AFK check once a player has been idle past the
 * threshold (30 ticks); from then on the bot driver inside processCycle issues
 * the slot's actions, and the WS path (covered separately) drops the human's
 * input (no-reclaim).
 */
describe('AFK takeover', () => {
  it('does not convert an idle human before the first 60-tick AFK check', async () => {
    const run = await seedGame('laning')
    await run.tick(59)

    expect(isGameBot(run.gameId, HUMAN)).toBe(false)
    expect((await run.player(HUMAN)).aiControlled ?? false).toBe(false)
    expect(run.allEvents.some((e) => e._tag === 'afk_takeover')).toBe(false)
  })

  it('replaces an idle human with a bot at the AFK check', async () => {
    const run = await seedGame('laning')
    await run.tick(60)

    // Now in the bot roster, so the GameLoop bot driver controls the slot.
    expect(getBotPlayerIds(run.gameId)).toContain(HUMAN)
    expect(isGameBot(run.gameId, HUMAN)).toBe(true)
    // Flagged for the UI...
    expect((await run.player(HUMAN)).aiControlled).toBe(true)
    // ...and announced exactly once for everyone to see.
    const takeovers = run.allEvents.filter((e) => e._tag === 'afk_takeover' && e.playerId === HUMAN)
    expect(takeovers).toHaveLength(1)
  })

  it('does not re-announce the takeover on later AFK checks', async () => {
    const run = await seedGame('laning')
    await run.tick(120) // two AFK checks (tick 60 + tick 120)

    const takeovers = run.allEvents.filter((e) => e._tag === 'afk_takeover' && e.playerId === HUMAN)
    expect(takeovers).toHaveLength(1)
  })

  it('lets the bot drive the converted hero from the next cycle', async () => {
    const run = await seedGame('laning')
    await run.tick(60)
    const atConversion = (await run.player(HUMAN)).lastActionCycle ?? 0

    await run.tick(10)
    // The bot driver submits actions for the slot, advancing lastActionCycle past
    // the conversion tick — proof a bot, not the (idle) human, is now playing.
    expect((await run.player(HUMAN)).lastActionCycle ?? 0).toBeGreaterThan(atConversion)
  })

  // PRODUCTION runs each cycle through gameTickCore.runOneTick, which calls
  // rehydrateRegistries on a possibly fresh instance BEFORE processCycle. The
  // tests above never do — so they passed while, in prod, the converted human
  // fell out of the bot set on the very next tick and idled forever.
  describe('across per-cycle registry rehydration (the production path)', () => {
    const roster: LiveGameRoster = {
      players: [
        { playerId: HUMAN, team: 'chaff', heroId: 'echo', mmr: 1000 },
        { playerId: 'enemy', team: 'audit', heroId: 'daemon', mmr: 1000 },
      ],
    }

    /** One production cycle: rehydrate from the persisted state, then tick. */
    async function prodTick(run: Run, n: number) {
      for (let i = 0; i < n; i++) {
        rehydrateRegistries(run.gameId, roster, await run.state())
        await run.tick(1)
      }
    }

    it('keeps the converted human bot-driven after the registry is rebuilt', async () => {
      const run = await seedGame('laning')
      await prodTick(run, 60) // conversion happens on cycle 60
      expect((await run.player(HUMAN)).aiControlled).toBe(true)

      // A cold instance picks the game up: all in-memory bot state is gone.
      cleanupGame(run.gameId)
      expect(isGameBot(run.gameId, HUMAN)).toBe(false)

      const atConversion = (await run.player(HUMAN)).lastActionCycle ?? 0
      await prodTick(run, 10)

      expect(isGameBot(run.gameId, HUMAN)).toBe(true)
      expect(getBotPlayerIds(run.gameId)).toContain(HUMAN)
      // The bot driver kept issuing the slot's actions on later cycles.
      expect((await run.player(HUMAN)).lastActionCycle ?? 0).toBeGreaterThan(atConversion)
      // ...and the converted slot keeps a real lane, not a blind default.
      expect(['seawall', 'coldstore', 'shallows']).toContain(getBotLane(run.gameId, HUMAN))
    })

    it('does not re-announce the takeover after a rebuild', async () => {
      const run = await seedGame('laning')
      await prodTick(run, 120)
      const takeovers = run.allEvents.filter(
        (e) => e._tag === 'afk_takeover' && e.playerId === HUMAN,
      )
      expect(takeovers).toHaveLength(1)
    })
  })
})
