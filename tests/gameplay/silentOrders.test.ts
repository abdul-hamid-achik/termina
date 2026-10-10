import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN, ENEMY } from './harness'
import { clearPlayerViolations, getPlayerViolations } from '~~/server/utils/AntiCheat'
import { processSpecialActions } from '~~/server/game/engine/GameLoop'

/**
 * Silent failures. An order that spends the player's one action per cycle and
 * changes nothing must say why, in the rejected channel — the single place
 * the client reads a one-line reason from.
 */
async function seedWave(
  wave: { team: 'mine' | 'theirs'; integ: number; zone?: string },
  playerZone = 'coldstore-cross',
) {
  const game = await seedGame('laning_combat', { heroSelf: 'echo' })
  const me = await game.me()
  await game.patch((s) => ({
    ...s,
    players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: playerZone } },
    waves: [
      {
        id: 'w0',
        team: wave.team === 'mine' ? me.team : me.team === 'chaff' ? 'audit' : 'chaff',
        zone: wave.zone ?? 'coldstore-cross',
        integ: wave.integ,
        type: 'line',
      },
    ],
  }))
  return game
}

const mine = (game: { lastRejected: Array<{ playerId: string; reason: string }> }) =>
  game.lastRejected.filter((r) => r.playerId === HUMAN)

describe('burn says why it did nothing', () => {
  it('too healthy: names the threshold and the unit INTEG', async () => {
    const game = await seedWave({ team: 'mine', integ: 380 })
    game.submit({ type: 'burn', target: { kind: 'wave', index: 0 } })
    await game.tick()
    const r = mine(game)
    expect(r).toHaveLength(1)
    expect(r[0]!.reason).toMatch(/too healthy to burn/i)
    expect(r[0]!.reason).toMatch(/50%/)
  })

  it('an enemy wave: points at the verb that works', async () => {
    const game = await seedWave({ team: 'theirs', integ: 100 })
    game.submit({ type: 'burn', target: { kind: 'wave', index: 0 } })
    await game.tick()
    expect(mine(game)[0]?.reason).toMatch(/enemy wave/i)
  })

  it('another zone / bad index: says how many waves are here', async () => {
    const game = await seedWave({ team: 'mine', integ: 100, zone: 'seawall-cross' })
    game.submit({ type: 'burn', target: { kind: 'wave', index: 0 } })
    await game.tick()
    expect(mine(game)[0]?.reason).toMatch(/No waves in this zone to burn/)
  })

  it('a legitimate burn is still not rejected', async () => {
    const game = await seedWave({ team: 'mine', integ: 100 })
    game.submit({ type: 'burn', target: { kind: 'wave', index: 0 } })
    await game.tick()
    expect(mine(game)).toEqual([])
    expect(game.lastEvents.some((e) => e._tag === 'wave_burn')).toBe(true)
  })
})

describe('attacks on Hardened ICE', () => {
  it('give the typed order a reason, as well as the world-visible event', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me = await game.me()
    const enemy = me.team === 'chaff' ? 'audit' : 'chaff'
    await game.patch((s) => {
      const target = s.ice.find((t) => t.team === enemy && t.alive)!
      return {
        ...s,
        players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: target.zone } },
        ice: s.ice.map((t) => (t.zone === target.zone ? { ...t, invulnerable: true } : t)),
      }
    })
    const st = await game.state()
    const zone = st.ice.find((t) => t.invulnerable && t.team === enemy)!.zone
    game.submit({ type: 'attack', target: { kind: 'ice', zone } })
    await game.tick()
    expect(game.lastEvents.some((e) => e._tag === 'ice_invulnerable')).toBe(true)
    expect(mine(game)[0]?.reason).toMatch(/Hardened/)
    // The event names the swinger and that the rejection already told them —
    // so the feed prints one line for them, not two (see combatNarrative).
    expect(game.lastEvents.find((e) => e._tag === 'ice_invulnerable')).toMatchObject({
      playerId: HUMAN,
      reported: true,
    })
  })

  it('a standing order bouncing off Hardened ICE is reported by the event alone', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me = await game.me()
    const enemy = me.team === 'chaff' ? 'audit' : 'chaff'
    let zone = ''
    await game.patch((s) => {
      const target = s.ice.find((t) => t.team === enemy && t.alive)!
      zone = target.zone
      return {
        ...s,
        cycle: 61,
        players: {
          ...s.players,
          [HUMAN]: {
            ...s.players[HUMAN]!,
            zone: target.zone,
            attackTarget: { kind: 'ice', zone: target.zone },
          },
        },
        ice: s.ice.map((t) => (t.zone === target.zone ? { ...t, invulnerable: true } : t)),
      }
    })
    await game.tick()
    expect(mine(game)).toEqual([])
    expect(game.lastEvents.find((e) => e._tag === 'ice_invulnerable')).toMatchObject({
      zone,
      playerId: HUMAN,
      reported: false,
    })
  })
})

describe('harden on cooldown', () => {
  it('is reported in the rejected channel with the time left', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    game.submit({ type: 'harden' })
    await game.tick()
    expect(mine(game)).toEqual([])
    game.submit({ type: 'harden' })
    await game.tick()
    expect(game.lastEvents.some((e) => e._tag === 'harden_on_cooldown')).toBe(true)
    expect(mine(game)[0]?.reason).toMatch(/Harden is not ready — \d+c remaining/)
  })
})

describe('select_talent exits', () => {
  it('rejects with a reason when there is no talent tree or no operator', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const base = await game.state()
    const act = [
      { playerId: HUMAN, command: { type: 'select_talent', tier: 10, talentId: 'x' } as const },
    ]
    const noTree = {
      ...base,
      players: { ...base.players, [HUMAN]: { ...base.players[HUMAN]!, heroId: 'not_a_hero' } },
    }
    expect(processSpecialActions(noTree as never, act as never).rejectedActions[0]?.reason).toBe(
      'No talent tree for this operator',
    )
    const noHero = {
      ...base,
      players: { ...base.players, [HUMAN]: { ...base.players[HUMAN]!, heroId: null } },
    }
    expect(processSpecialActions(noHero as never, act as never).rejectedActions[0]?.reason).toBe(
      'Pick an operator first',
    )
  })

  it('an unknown tier is a reason, not a crash', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const base = await game.state()
    const out = processSpecialActions(base, [
      { playerId: HUMAN, command: { type: 'select_talent', tier: 12, talentId: 'x' } },
    ] as never)
    expect(out.rejectedActions[0]?.reason).toBe('Invalid talent tier')
  })
})

// A typed `attack hero:<x>` with x elsewhere tripped anti-cheat's VISION_BYPASS
// and was dropped before the attack phase — no reason, the cycle simply gone.
// A legitimate mistake gets the attack phase's own generic text (which never
// says where the target is); the detection is still logged and recorded.
describe('a typed hero attack out of zone says why', () => {
  async function seedApart() {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, zone: 'coldstore-t1-chaff' },
        [ENEMY]: { ...s.players[ENEMY]!, zone: 'seawall-t2-audit' },
      },
    }))
    return game
  }

  it('gets "Target is not in your zone", never the target’s zone', async () => {
    clearPlayerViolations(HUMAN)
    const game = await seedApart()
    game.attackHero(ENEMY)
    await game.tick()
    const r = mine(game)
    expect(r).toEqual([{ playerId: HUMAN, reason: 'Target is not in your zone' }])
    expect(r[0]!.reason).not.toMatch(/seawall/i)
    // Still an anti-cheat detection (logged + recorded), still dropped.
    expect(getPlayerViolations(HUMAN).some((v) => v.violationType === 'VISION_BYPASS')).toBe(true)
    expect(
      game.lastEvents.some(
        (e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === ENEMY,
      ),
    ).toBe(false)
  })

  it('an ally elsewhere gets the resolver’s team text, not the zone text', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    const me = await game.me()
    // laning_combat is 1v1 — seat a teammate (a copy of the enemy, on our side).
    const ally = { id: 'ally1', name: 'Ally' }
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, zone: 'coldstore-t1-chaff' },
        ally1: { ...s.players[ENEMY]!, ...ally, team: me.team, zone: 'seawall-t2-chaff' },
      },
    }))
    // By NAME: anti-cheat looks heroes up by exact name, so this is the order it drops.
    game.submit({ type: 'attack', target: { kind: 'hero', name: ally.name } })
    await game.tick()
    expect(mine(game)[0]?.reason).toBe(`${ally.name} is on your team`)
  })
})
