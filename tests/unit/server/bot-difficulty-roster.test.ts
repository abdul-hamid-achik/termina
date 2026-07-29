/**
 * Matchmaking-side bot difficulty (server/plugins/game-server.ts). Bots used to
 * be registered at registerBots' hardcoded 'medium' default for every production
 * game, so `hard` and `unfair` were config nothing could reach.
 *
 * game-server.ts calls defineNitroPlugin at module eval, so stub it before
 * import (same pattern as practice-persistence.test.ts).
 */
import { describe, it, expect, vi } from 'vitest'

vi.stubGlobal('defineNitroPlugin', (fn: unknown) => fn)

const { botDifficultyForRoster } = await import('~~/server/plugins/game-server')

const human = (mmr: number, i = 0) => ({ playerId: `github_${i}`, mmr })
const bot = (mmr: number, i = 0) => ({ playerId: `bot_${i}`, mmr })

describe('botDifficultyForRoster', () => {
  it('scales with the human players average MMR', () => {
    expect(botDifficultyForRoster([human(600)])).toBe('easy')
    expect(botDifficultyForRoster([human(1000)])).toBe('medium')
    expect(botDifficultyForRoster([human(1500)])).toBe('hard')
    expect(botDifficultyForRoster([human(2400)])).toBe('unfair')
  })

  it('averages across the humans on both teams', () => {
    // 800 alone is 'easy' and 2200 alone is 'unfair'; the pair averages to 1500.
    expect(botDifficultyForRoster([human(800, 0), human(2200, 1)])).toBe('hard')
  })

  it('ignores the bots — they inherit the human average and would dilute it', () => {
    // Five 2400-MMR humans plus five bots seeded at 1000 average to 1700 ('hard')
    // if the bots are counted; only the humans should decide.
    const players = [
      ...[0, 1, 2, 3, 4].map((i) => human(2400, i)),
      ...[0, 1, 2, 3, 4].map((i) => bot(1000, i)),
    ]
    expect(botDifficultyForRoster(players)).toBe('unfair')
  })

  it('falls back to the seed MMR for an all-bot roster', () => {
    expect(botDifficultyForRoster([bot(1000, 0), bot(1000, 1)])).toBe('medium')
  })
})
