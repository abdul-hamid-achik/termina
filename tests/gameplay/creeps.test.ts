import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN } from './harness'

/**
 * Engine-truth coverage for lane creep combat (CreepAI). When opposing waves
 * meet in a zone they trade blows rather than walking past each other — the
 * basis of lane equilibrium. Creeps don't regen, so any HP drop is combat.
 * Placed in an empty river zone so no heroes/towers confound the trade.
 */
describe('creeps: lane combat', () => {
  it('opposing creep waves fight when they meet in a lane', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      creeps: [
        { id: 'rc', team: 'radiant', zone: 'top-river', hp: 400, type: 'melee' },
        { id: 'dc', team: 'dire', zone: 'top-river', hp: 400, type: 'melee' },
      ],
    }))

    await game.tick()

    const state = await game.state()
    const rc = state.creeps.find((c) => c.id === 'rc')
    const dc = state.creeps.find((c) => c.id === 'dc')
    // Both traded blows — neither walked past the other untouched.
    expect(rc && rc.hp < 400).toBe(true)
    expect(dc && dc.hp < 400).toBe(true)
  })

  it('a creep at 1 HP is finished off by the opposing wave', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      creeps: [
        { id: 'rc', team: 'radiant', zone: 'top-river', hp: 400, type: 'melee' },
        { id: 'dc', team: 'dire', zone: 'top-river', hp: 1, type: 'melee' },
      ],
    }))

    await game.tick()

    // The 1-HP dire creep dies and is reaped from the board.
    expect((await game.state()).creeps.find((c) => c.id === 'dc')).toBeUndefined()
  })
})

/**
 * The laning creep economy — the skill floor of any MOBA. Last-hitting an enemy
 * creep banks its full bounty; denying your own low-HP creep robs the enemy of
 * that bounty for a reduced cut. Both run through the real processTick attack /
 * deny phases (MELEE_CREEP_HP 400, DENY_HP_THRESHOLD 0.5, DENY_GOLD_RATIO 0.5).
 */
describe('creeps: last-hit & deny economy', () => {
  it('last-hitting an enemy creep banks gold', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me0 = await game.me()
    const enemyTeam = me0.team === 'radiant' ? 'dire' : 'radiant'
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'mid-river' } },
      // One enemy creep at a sliver of HP, co-located — a single swing finishes it.
      creeps: [{ id: 'enemy_creep', team: enemyTeam, zone: 'mid-river', hp: 10, type: 'melee' }],
    }))

    const goldBefore = (await game.me()).gold
    game.submit({ type: 'attack', target: { kind: 'creep', index: 0 } })
    await game.tick()

    // The creep is dead and its bounty is in the bank.
    expect((await game.me()).gold).toBeGreaterThan(goldBefore)
    const creep = (await game.state()).creeps.find((c) => c.id === 'enemy_creep')
    expect(!creep || creep.hp <= 0).toBe(true)
  })

  it('denying a low-HP allied creep kills it for a reduced bounty + a creep_deny event', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me0 = await game.me()
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'mid-river' } },
      // An ALLIED melee creep below the 50%-of-400 deny threshold, co-located.
      creeps: [{ id: 'ally_creep', team: me0.team, zone: 'mid-river', hp: 100, type: 'melee' }],
    }))

    const goldBefore = (await game.me()).gold
    game.submit({ type: 'deny', target: { kind: 'creep', index: 0 } })
    await game.tick()

    // Denied: the creep dies, the denier pockets the reduced cut, and the lane
    // sees a creep_deny event (so the enemy knows the last hit was stolen).
    expect(game.lastEvents.some((e) => e._tag === 'creep_deny' && e.playerId === HUMAN)).toBe(true)
    expect((await game.me()).gold).toBeGreaterThan(goldBefore)
    const creep = (await game.state()).creeps.find((c) => c.id === 'ally_creep')
    expect(!creep || creep.hp <= 0).toBe(true)
  })

  it('a healthy allied creep cannot be denied (above the HP threshold)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me0 = await game.me()
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'mid-river' } },
      // 380 / 400 = 95% HP — well above the deny window.
      creeps: [{ id: 'ally_creep', team: me0.team, zone: 'mid-river', hp: 380, type: 'melee' }],
    }))

    game.submit({ type: 'deny', target: { kind: 'creep', index: 0 } })
    await game.tick()

    // The deny is refused — no event, and the creep is still standing.
    expect(game.lastEvents.some((e) => e._tag === 'creep_deny')).toBe(false)
    const creep = (await game.state()).creeps.find((c) => c.id === 'ally_creep')
    expect(creep && creep.hp > 0).toBe(true)
  })
})
