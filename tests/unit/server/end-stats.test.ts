/**
 * The game_over scoreboard payload (server/plugins/game-server.ts).
 *
 * game-server.ts calls defineNitroPlugin at module eval, so stub it before
 * import (same pattern as practice-persistence.test.ts).
 */
import { describe, it, expect, vi } from 'vitest'
import type { GameState, PlayerState } from '~~/shared/types/game'
import { ITEMS } from '~~/shared/constants/items'

vi.stubGlobal('defineNitroPlugin', (fn: unknown) => fn)

const { buildEndStats } = await import('~~/server/plugins/game-server')

function player(over: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'p1',
    team: 'chaff',
    heroId: 'echo',
    zone: 'mid-river',
    hp: 500,
    maxHp: 600,
    mp: 100,
    maxMp: 200,
    level: 11,
    xp: 0,
    gold: 120,
    items: ['blades_of_attack', 'town_portal_scroll', null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnTick: null,
    defense: 3,
    magicResist: 15,
    kills: 6,
    deaths: 4,
    assists: 9,
    damageDealt: 18_000,
    towerDamageDealt: 2400,
    killStreak: 0,
    buybackCost: 0,
    talents: { tier10: null, tier15: null, tier20: null, tier25: null },
    ...over,
  }
}

const stateWith = (players: Record<string, PlayerState>) => ({ players }) as unknown as GameState

describe('buildEndStats', () => {
  it('reports net worth, not the unspent wallet balance', () => {
    // REGRESSION: the payload only carried `gold`, so the post-game screen
    // ranked the player who converted every coin into items LAST.
    const owned = ITEMS.blades_of_attack!.cost + ITEMS.town_portal_scroll!.cost
    const spender = player({ gold: 120 })
    const hoarder = player({ gold: 120 + owned, items: [null, null, null, null, null, null] })
    const stats = buildEndStats(['p1', 'p2'], stateWith({ p1: spender, p2: hoarder }), {})

    expect(stats.p1!.gold).toBe(120)
    expect(stats.p1!.netWorth).toBe(120 + owned)
    // Two players who farmed the same amount rank equal, whatever they spent.
    expect(stats.p2!.netWorth).toBe(stats.p1!.netWorth)
  })

  it('carries the loop’s farm tally through per player', () => {
    const stats = buildEndStats(
      ['p1', 'p2'],
      stateWith({ p1: player(), p2: player({ id: 'p2' }) }),
      { p1: { lastHits: 74, denies: 11 } },
    )

    expect(stats.p1).toMatchObject({ lastHits: 74, denies: 11 })
    // A player who never landed one is absent from the tally, not undefined.
    expect(stats.p2).toMatchObject({ lastHits: 0, denies: 0 })
  })

  it('carries the final level so a total can be read against it', () => {
    const stats = buildEndStats(['p1'], stateWith({ p1: player({ level: 13 }) }), {})
    expect(stats.p1!.level).toBe(13)
  })

  it('zero-fills a player missing from the final state instead of throwing', () => {
    const stats = buildEndStats(['ghost'], stateWith({}), {})
    expect(stats.ghost).toMatchObject({ kills: 0, netWorth: 0, lastHits: 0, level: 1 })
  })
})
