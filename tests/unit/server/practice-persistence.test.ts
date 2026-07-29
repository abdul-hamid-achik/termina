/**
 * Which games count as a RESULT (server/plugins/game-server.ts).
 *
 * onGameOver persists a match row and increments players.games_played/wins plus
 * hero_stats. Tutorial games now END on graduation and are surrenderable from
 * tick 0, so they reach that callback routinely — including for a player who
 * issued no commands at all, because the tutorial step deadlines carry the flow
 * on their own. Without this gate, merely opening practice and walking away
 * banked a free, publicly-displayed win every ~60 ticks.
 *
 * game-server.ts calls defineNitroPlugin at module eval, so stub it before
 * import (same pattern as event-visibility.test.ts).
 */
import { describe, it, expect, vi } from 'vitest'

vi.stubGlobal('defineNitroPlugin', (fn: unknown) => fn)

const { isPracticeGame } = await import('~~/server/plugins/game-server')

describe('isPracticeGame (game-over persistence gate)', () => {
  it('treats a tutorial game as practice, whatever its id', () => {
    expect(isPracticeGame('game_1785_abcd', 'tutorial')).toBe(true)
  })

  it('treats a dev_ game as practice even if its mode could not be read', () => {
    // onGameOver falls back to the id when finalState is unavailable.
    expect(isPracticeGame('dev_1785_abcd', undefined)).toBe(true)
  })

  it('does NOT treat a real match as practice', () => {
    expect(isPracticeGame('game_1785_abcd', 'normal')).toBe(false)
    expect(isPracticeGame('game_1785_abcd', undefined)).toBe(false)
  })

  it('does not match a game whose id merely contains "dev_"', () => {
    // Prefix, not substring — a real match must never be silently unranked.
    expect(isPracticeGame('game_dev_1785', 'normal')).toBe(false)
  })
})
