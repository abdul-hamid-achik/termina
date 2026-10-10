import { describe, it, expect, beforeEach } from 'vitest'
import type { GameState } from '~~/shared/types/game'
import type { TargetRef } from '~~/shared/types/commands'
import type { HeroId } from '~~/shared/types/hero'
import { seedGame, ENEMY, HUMAN, type Run } from './harness'
import { resetWaveIdCounter } from '~~/server/game/map/spawner'
import { ZONE_MAP } from '~~/shared/constants/zones'

/**
 * Hero-kit defects found in adversarial review, each pinned by the scenario
 * that exposed it. Runs at cycle 173 (not the seed default) with a fixed seed.
 */

beforeEach(() => {
  resetWaveIdCounter()
})

async function ready(heroSelf: HeroId, heroEnemy: HeroId = 'daemon'): Promise<Run> {
  const game = await seedGame('laning_combat', { heroSelf, heroEnemy })
  await game.tick()
  await game.patch((s: GameState) => ({
    ...s,
    cycle: 173,
    rngSeed: 31,
    players: Object.fromEntries(
      Object.entries(s.players).map(([id, p]) => [
        id,
        { ...p, level: 8, cooldowns: { q: 0, w: 0, e: 0, r: 0 }, bw: p.maxBw, buffs: [] },
      ]),
    ),
  }))
  return game
}

describe('ally-only abilities that need ANOTHER hero refuse the caster', () => {
  const selfRefs: Array<[string, TargetRef]> = [
    ['target self', { kind: 'self' }],
    ['own handle', { kind: 'hero', name: HUMAN }],
  ]
  for (const [hero, slot, name] of [
    ['proxy', 'r', 'Reverse Proxy'],
    ['cron', 'q', 'Uptime'],
  ] as const) {
    for (const [label, ref] of selfRefs) {
      it(`${hero} ${slot.toUpperCase()} on ${label}: refused, nothing spent, no buff`, async () => {
        const game = await ready(hero)
        const before = await game.me()
        game.cast(slot, ref)
        await game.tick()
        const me = await game.me()
        expect(game.lastRejected).toContainEqual({
          playerId: HUMAN,
          reason: `${name} needs another allied hero — not yourself`,
        })
        expect(me.cooldowns[slot]).toBe(0)
        expect(me.bw).toBeGreaterThanOrEqual(before.bw)
        expect(me.buffs.some((b) => b.id === 'invulnerable' || b.id === 'uptimeAtk')).toBe(false)
      })
    }
  }

  it('a self-shield ally ability (proxy W) still accepts the caster', async () => {
    const game = await ready('proxy')
    game.cast('w', { kind: 'self' })
    await game.tick()
    expect(game.lastRejected.filter((r) => r.playerId === HUMAN)).toEqual([])
    expect((await game.me()).cooldowns.w).toBeGreaterThan(0)
  })
})

describe('Malloc E while rooted', () => {
  async function rootedMalloc(enemyNextDoor: boolean): Promise<Run> {
    const game = await ready('malloc')
    const s = await game.state()
    const here = s.players[HUMAN]!.zone
    const next = ZONE_MAP[here]!.adjacentTo[0]!
    await game.patch((st) => ({
      ...st,
      players: {
        ...st.players,
        [HUMAN]: {
          ...st.players[HUMAN]!,
          buffs: [{ id: 'root', stacks: 1, cyclesRemaining: 3, source: ENEMY }],
        },
        [ENEMY]: {
          ...st.players[ENEMY]!,
          zone: enemyNextDoor ? next : here,
          buffs: [{ id: 'breached', stacks: 1, cyclesRemaining: 4, source: HUMAN }],
        },
      },
    }))
    return game
  }

  it('cannot dash to a neighbour: refused before any BW is spent, Malloc stays put', async () => {
    const game = await rootedMalloc(true)
    const before = await game.me()
    game.cast('e', { kind: 'hero', name: ENEMY })
    await game.tick()
    const me = await game.me()
    expect(game.lastRejected).toContainEqual({
      playerId: HUMAN,
      reason: `Rooted — Pointer Dereference cannot dash to ${ENEMY}`,
    })
    expect(me.zone).toBe(before.zone)
    expect(me.cooldowns.e).toBe(0)
    expect(me.bw).toBeGreaterThanOrEqual(before.bw)
  })

  it('still strikes a target in its own zone (no dash needed)', async () => {
    const game = await rootedMalloc(false)
    game.cast('e', { kind: 'hero', name: ENEMY })
    await game.tick()
    expect(game.lastRejected.filter((r) => r.playerId === HUMAN)).toEqual([])
    expect((await game.me()).cooldowns.e).toBeGreaterThan(0)
  })
})

describe('Cipher Encrypt is not cancelled in the cycle it is cast', () => {
  const stealthed = async (game: Run) => (await game.me()).buffs.some((b) => b.id === 'stealth')

  it('an enemy swing that lands the same cycle does not break it', async () => {
    const game = await ready('cipher', 'daemon')
    game.cast('w')
    game.attackHero(HUMAN, ENEMY)
    await game.tick()
    expect(
      game.lastEvents.some(
        (e) => e._tag === 'damage' && e.targetId === HUMAN && e.sourceId === ENEMY,
      ),
    ).toBe(true)
    expect(await stealthed(game)).toBe(true)
  })

  it('a DoT ticking the same cycle does not break it', async () => {
    const game = await ready('cipher', 'daemon')
    game.cast('q', { kind: 'hero', name: HUMAN }, ENEMY) // daemon Inject: a DoT on cipher
    await game.tick()
    expect((await game.me()).buffs.some((b) => b.id === 'inject_dot')).toBe(true)
    game.cast('w')
    await game.tick()
    expect(game.lastEvents.some((e) => e._tag === 'damage' && e.targetId === HUMAN)).toBe(true)
    expect(await stealthed(game)).toBe(true)
  })

  it('a hit in the NEXT cycle still breaks it', async () => {
    const game = await ready('cipher', 'daemon')
    game.cast('w')
    await game.tick()
    expect(await stealthed(game)).toBe(true)
    // The enemy is in Cipher's zone; target the handle (no vision gate in the harness).
    game.attackHero(HUMAN, ENEMY)
    await game.tick()
    expect(
      game.lastEvents.some(
        (e) => e._tag === 'damage' && e.targetId === HUMAN && e.sourceId === ENEMY,
      ),
    ).toBe(true)
    expect(await stealthed(game)).toBe(false)
  })
})
