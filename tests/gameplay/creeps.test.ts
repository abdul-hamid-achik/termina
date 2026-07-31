import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN, ENEMY } from './harness'
import { WAVE_ESCALATION_INTERVAL_CYCLES, waveUnitMaxHp } from '~~/shared/constants/balance'

/**
 * Engine-truth coverage for lane wave combat (WaveAI). When opposing waves
 * meet in a zone they trade blows rather than walking past each other — the
 * basis of lane equilibrium. Waves don't regen, so any INTEG drop is combat.
 * Placed in an empty river zone so no heroes/ice confound the trade.
 */
describe('waves: lane combat', () => {
  it('opposing wave waves fight when they meet in a lane', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      waves: [
        { id: 'rc', team: 'chaff', zone: 'top-river', integ: 400, type: 'line' },
        { id: 'dc', team: 'audit', zone: 'top-river', integ: 400, type: 'line' },
      ],
    }))

    await game.tick()

    const state = await game.state()
    const rc = state.waves.find((c) => c.id === 'rc')
    const dc = state.waves.find((c) => c.id === 'dc')
    // Both traded blows — neither walked past the other untouched.
    expect(rc && rc.integ < 400).toBe(true)
    expect(dc && dc.integ < 400).toBe(true)
  })

  it('a wave at 1 INTEG is finished off by the opposing wave', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      waves: [
        { id: 'rc', team: 'chaff', zone: 'top-river', integ: 400, type: 'line' },
        { id: 'dc', team: 'audit', zone: 'top-river', integ: 1, type: 'line' },
      ],
    }))

    await game.tick()

    // The 1-HP audit wave dies and is reaped from the board.
    expect((await game.state()).waves.find((c) => c.id === 'dc')).toBeUndefined()
  })
})

/**
 * The laning wave economy — the skill floor of any MOBA. Last-hitting an enemy
 * wave banks its full bounty; denying your own low-INTEG wave robs the enemy of
 * that bounty for a reduced cut. Both run through the real processCycle attack /
 * burn phases (LINE_UNIT_HP 400, BURN_HP_THRESHOLD 0.5, BURN_SCRIP_RATIO 0.5).
 */
describe('waves: last-hit & burn economy', () => {
  it('last-hitting an enemy wave banks gold', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me0 = await game.me()
    const enemyTeam = me0.team === 'chaff' ? 'audit' : 'chaff'
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'mid-river' } },
      // One enemy wave at a sliver of INTEG, co-located — a single swing finishes it.
      waves: [{ id: 'enemy_wave', team: enemyTeam, zone: 'mid-river', integ: 10, type: 'line' }],
    }))

    const scripBefore = (await game.me()).scrip
    game.submit({ type: 'attack', target: { kind: 'wave', index: 0 } })
    await game.tick()

    // The wave is dead and its bounty is in the bank.
    expect((await game.me()).scrip).toBeGreaterThan(scripBefore)
    const wave = (await game.state()).waves.find((c) => c.id === 'enemy_wave')
    expect(!wave || wave.integ <= 0).toBe(true)
  })

  it('denying a low-INTEG allied wave kills it for a reduced bounty + a wave_burn event', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me0 = await game.me()
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'mid-river' } },
      // An ALLIED line wave below the 50%-of-400 burn threshold, co-located.
      waves: [{ id: 'ally_wave', team: me0.team, zone: 'mid-river', integ: 100, type: 'line' }],
    }))

    const scripBefore = (await game.me()).scrip
    game.submit({ type: 'burn', target: { kind: 'wave', index: 0 } })
    await game.tick()

    // Burned: the wave dies, the burner pockets the reduced cut, and the lane
    // sees a wave_burn event (so the enemy knows the last hit was stolen).
    expect(game.lastEvents.some((e) => e._tag === 'wave_burn' && e.playerId === HUMAN)).toBe(true)
    expect((await game.me()).scrip).toBeGreaterThan(scripBefore)
    const wave = (await game.state()).waves.find((c) => c.id === 'ally_wave')
    expect(!wave || wave.integ <= 0).toBe(true)
  })

  it('a healthy allied wave cannot be burned (above the INTEG threshold)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me0 = await game.me()
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'mid-river' } },
      // 380 / 400 = 95% INTEG — well above the burn window.
      waves: [{ id: 'ally_wave', team: me0.team, zone: 'mid-river', integ: 380, type: 'line' }],
    }))

    game.submit({ type: 'burn', target: { kind: 'wave', index: 0 } })
    await game.tick()

    // The burn is refused — no event, and the wave is still standing.
    expect(game.lastEvents.some((e) => e._tag === 'wave_burn')).toBe(false)
    const wave = (await game.state()).waves.find((c) => c.id === 'ally_wave')
    expect(wave && wave.integ > 0).toBe(true)
  })

  it('a last-hit also pays lane-mates a share of the XP', async () => {
    // XP used to come EXCLUSIVELY from last-hits, so a laner who mistimed their
    // attacks earned literally zero and sat several levels behind. Presence in
    // the lane now pays a fraction; the last-hitter still keeps the full amount,
    // so timing is still worth more.
    const game = await seedGame('fresh', {
      players: [
        { id: HUMAN, name: HUMAN, team: 'chaff', heroId: 'echo' },
        { id: 'lanemate', name: 'lanemate', team: 'chaff', heroId: 'kernel' },
        { id: ENEMY, name: ENEMY, team: 'audit', heroId: 'regex' },
      ],
    })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, zone: 'mid-river', xp: 0 },
        lanemate: { ...s.players['lanemate']!, zone: 'mid-river', alive: true, xp: 0 },
      },
      waves: [{ id: 'enemy_wave', team: 'audit', zone: 'mid-river', integ: 10, type: 'line' }],
    }))

    game.submit({ type: 'attack', target: { kind: 'wave', index: 0 } })
    await game.tick()

    const after = await game.state()
    const mine = after.players[HUMAN]!.xp
    const theirs = after.players['lanemate']!.xp
    expect(theirs).toBeGreaterThan(0)
    // ...but strictly less than the last-hitter's, or timing stops mattering.
    expect(theirs).toBeLessThan(mine)
  })

  it("the burn window follows the wave's OWN max INTEG, not a level-1 constant", async () => {
    // REGRESSION (survived mutation testing once already): waves escalate with
    // match time. Judging the 50% burn threshold against the level-1 constant
    // makes denying steadily impossible; judging it against the CURRENT tick's
    // tier makes a wave that outlived an escalation boundary deniable well
    // above half health. The wave's own spawn-time maxInteg is the only correct
    // reference. Every other burn test sits at tick ~0 where the multiplier is
    // 1.0, so none of them can see this.
    const lateTick = WAVE_ESCALATION_INTERVAL_CYCLES * 2
    const spawnMax = waveUnitMaxHp('line', lateTick)
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me0 = await game.me()
    await game.patch((s) => ({
      ...s,
      cycle: lateTick,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'mid-river' } },
      waves: [
        {
          id: 'ally_wave',
          team: me0.team,
          zone: 'mid-river',
          // Just under half of what this wave actually spawned with. Against the
          // tick-0 constant this reads as ABOVE the threshold and is refused.
          integ: Math.round(spawnMax * 0.45),
          maxInteg: spawnMax,
          type: 'line',
        },
      ],
    }))

    game.submit({ type: 'burn', target: { kind: 'wave', index: 0 } })
    await game.tick()

    const wave = (await game.state()).waves.find((c) => c.id === 'ally_wave')
    expect(!wave || wave.integ <= 0, 'an escalated wave under half INTEG must be deniable').toBe(
      true,
    )
  })

  it('an OLD wave at a late tick is judged by what IT spawned with, not the current tier', async () => {
    // The other half of the same rule, and the one a "use the current tick"
    // implementation gets wrong: a wave that spawned early keeps its small max
    // for life. Judged against the late-game tier its 60%-HP is under the
    // threshold and it would be wrongly deniable.
    const baseMax = waveUnitMaxHp('line', 0)
    const lateTick = WAVE_ESCALATION_INTERVAL_CYCLES * 2
    expect(waveUnitMaxHp('line', lateTick)).toBeGreaterThan(baseMax * 1.2)

    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me0 = await game.me()
    await game.patch((s) => ({
      ...s,
      cycle: lateTick,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'mid-river' } },
      waves: [
        {
          id: 'old_wave',
          team: me0.team,
          zone: 'mid-river',
          integ: Math.round(baseMax * 0.6), // above ITS half, below the late tier's half
          maxInteg: baseMax,
          type: 'line',
        },
      ],
    }))

    game.submit({ type: 'burn', target: { kind: 'wave', index: 0 } })
    await game.tick()

    const wave = (await game.state()).waves.find((c) => c.id === 'old_wave')
    expect(wave?.integ, 'a wave above ITS OWN half must not be deniable').toBeGreaterThan(0)
  })

  it('`attack` on your OWN wave is refused — no kill, no bounty, and the player is told why', async () => {
    // Without the team guard the swing killed the ally wave and banked the
    // FULL last-hit bounty, rewarding the exact opposite of last-hitting.
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me0 = await game.me()
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'mid-river' } },
      waves: [{ id: 'ally_wave', team: me0.team, zone: 'mid-river', integ: 10, type: 'line' }],
    }))

    const scripBefore = (await game.me()).scrip
    game.submit({ type: 'attack', target: { kind: 'wave', index: 0 } })
    await game.tick()

    const wave = (await game.state()).waves.find((c) => c.id === 'ally_wave')
    expect(wave && wave.integ === 10).toBe(true)
    // Passive income can still tick in, so assert no LAST-HIT reward specifically.
    expect(game.lastEvents.some((e) => e._tag === 'wave_strip')).toBe(false)
    expect((await game.me()).scrip - scripBefore).toBeLessThan(20)
    expect(game.lastRejected.some((r) => r.playerId === HUMAN && /own wave/i.test(r.reason))).toBe(
      true,
    )
  })

  it('`attack wave:0` in a creepless zone is refused instead of eating the tick', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'mid-river' } },
      waves: [],
    }))

    game.submit({ type: 'attack', target: { kind: 'wave', index: 0 } })
    await game.tick()

    expect(game.lastRejected.some((r) => r.playerId === HUMAN && /no waves/i.test(r.reason))).toBe(
      true,
    )
  })
})
