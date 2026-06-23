import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN } from './harness'
import { getBotPlayerIds, isGameBot } from '~~/server/game/ai/BotManager'

/**
 * Engine-truth coverage for the AFK → bot takeover, driven through the real
 * processTick (no browser/server/DB). The harness never submits actions unless
 * told to, so a seeded human is idle by default — exactly the AFK case. The
 * takeover fires on the 60-tick AFK check once a player has been idle past the
 * threshold (30 ticks); from then on the bot driver inside processTick issues
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

  it('lets the bot drive the converted hero from the next tick', async () => {
    const run = await seedGame('laning')
    await run.tick(60)
    const atConversion = (await run.player(HUMAN)).lastActionTick ?? 0

    await run.tick(10)
    // The bot driver submits actions for the slot, advancing lastActionTick past
    // the conversion tick — proof a bot, not the (idle) human, is now playing.
    expect((await run.player(HUMAN)).lastActionTick ?? 0).toBeGreaterThan(atConversion)
  })
})
