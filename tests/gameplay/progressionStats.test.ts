import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN } from './harness'
import { getFarmStats } from '~~/server/game/engine/GameLoop'
import { TALENT_TREES, TALENT_UNLOCK_LEVEL } from '~~/shared/constants/talents'

/**
 * Engine truth for the two progression numbers the scoreboard never had. The
 * tally is derived from the emitted `wave_strip` / `wave_burn` events, so
 * these run through the real attack and burn phases rather than poking a
 * counter — a tally that disagreed with the feed would be worse than none.
 */
describe('progression: last hits and burns', () => {
  it('counts a last hit against the player who landed it', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me0 = await game.me()
    const enemyTeam = me0.team === 'chaff' ? 'audit' : 'chaff'
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'mid-river' } },
      waves: [{ id: 'enemy_wave', team: enemyTeam, zone: 'mid-river', integ: 10, type: 'line' }],
    }))

    expect(getFarmStats(game.gameId)[HUMAN]?.lastHits ?? 0).toBe(0)

    game.submit({ type: 'attack', target: { kind: 'wave', index: 0 } })
    await game.tick()

    expect(getFarmStats(game.gameId)[HUMAN]).toEqual({ lastHits: 1, burns: 0 })
  })

  it('counts a burn separately from a last hit', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me0 = await game.me()
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'mid-river' } },
      // Own wave under the burn window (LINE_UNIT_HP 400 × BURN_HP_THRESHOLD 0.5).
      waves: [{ id: 'own_wave', team: me0.team, zone: 'mid-river', integ: 20, type: 'line' }],
    }))

    game.submit({ type: 'burn', target: { kind: 'wave', index: 0 } })
    await game.tick()

    expect(getFarmStats(game.gameId)[HUMAN]).toEqual({ lastHits: 0, burns: 1 })
  })

  it('accumulates across ticks rather than reporting only the last one', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me0 = await game.me()
    const enemyTeam = me0.team === 'chaff' ? 'audit' : 'chaff'

    for (let i = 0; i < 3; i++) {
      await game.patch((s) => ({
        ...s,
        players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'mid-river' } },
        waves: [{ id: `ec${i}`, team: enemyTeam, zone: 'mid-river', integ: 10, type: 'line' }],
      }))
      game.submit({ type: 'attack', target: { kind: 'wave', index: 0 } })
      await game.tick()
    }

    expect(getFarmStats(game.gameId)[HUMAN]?.lastHits).toBe(3)
  })

  it('keeps each game’s tally to itself', async () => {
    const a = await seedGame('laning_combat', { heroSelf: 'echo' })
    const b = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me0 = await a.me()
    const enemyTeam = me0.team === 'chaff' ? 'audit' : 'chaff'
    await a.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'mid-river' } },
      waves: [{ id: 'ec', team: enemyTeam, zone: 'mid-river', integ: 10, type: 'line' }],
    }))
    a.submit({ type: 'attack', target: { kind: 'wave', index: 0 } })
    await a.tick()

    expect(getFarmStats(a.gameId)[HUMAN]?.lastHits).toBe(1)
    expect(getFarmStats(b.gameId)).toEqual({})
  })
})

/**
 * Talent tiers unlock on TALENT_UNLOCK_LEVEL, not on the tier number. Every case
 * below sits at a NON-DEFAULT level: at level 1 (and at level 10+) the two rules
 * agree, so a fixture parked at either end proves nothing.
 */
describe('progression: talent tiers unlock on their configured level', () => {
  const firstTier = TALENT_TREES.echo.tiers[10][0]
  const lastTier = TALENT_TREES.echo.tiers[25][0]

  async function atLevel(level: number) {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, level } },
    }))
    return game
  }

  it('grants the first tier at its unlock level, far below the tier number', async () => {
    expect(TALENT_UNLOCK_LEVEL[10]).toBeLessThan(10)

    const game = await atLevel(TALENT_UNLOCK_LEVEL[10])
    game.selectTalent(10, firstTier.id)
    await game.tick()

    expect((await game.me()).talents.tier10).toBe(firstTier.id)
    expect(game.lastRejected).toEqual([])
  })

  it('still refuses the tick before that level, naming the level it needs', async () => {
    const game = await atLevel(TALENT_UNLOCK_LEVEL[10] - 1)
    game.selectTalent(10, firstTier.id)
    await game.tick()

    expect((await game.me()).talents.tier10).toBeNull()
    expect(game.lastRejected[0]?.reason).toBe(`Requires level ${TALENT_UNLOCK_LEVEL[10]}`)
  })

  it('gates the exotic top tier on its own level, reachable inside a real match', async () => {
    // The top tier used to need level 25; no hero in an 8-match sim passed 16,
    // so its four cast effects were unreachable content in every game played.
    expect(TALENT_UNLOCK_LEVEL[25]).toBeLessThanOrEqual(13)

    const tooEarly = await atLevel(TALENT_UNLOCK_LEVEL[25] - 1)
    tooEarly.selectTalent(25, lastTier.id)
    await tooEarly.tick()
    expect((await tooEarly.me()).talents.tier25).toBeNull()

    const ready = await atLevel(TALENT_UNLOCK_LEVEL[25])
    ready.selectTalent(25, lastTier.id)
    await ready.tick()
    expect((await ready.me()).talents.tier25).toBe(lastTier.id)
  })

  it('keeps the tiers strictly ordered so they cannot all land at once', async () => {
    const levels = [10, 15, 20, 25].map((t) => TALENT_UNLOCK_LEVEL[t as 10 | 15 | 20 | 25])
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]!).toBeGreaterThan(levels[i - 1]!)
    }
  })
})
