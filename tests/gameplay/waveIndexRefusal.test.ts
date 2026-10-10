import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN } from './harness'
import type { WaveUnitState } from '~~/shared/types/game'

/**
 * Playtest 2: `attack wave:1` got "That is your own wave — use `burn` instead".
 * wave:N counts EVERY unit standing in your zone — both crews, in the engine's
 * list order — so the right index for the enemy unit is not obvious. The
 * indexing stays exactly as it is (the tutorial and the client depend on it);
 * the refusal now names the indices that WOULD work, state-true.
 */

const ZONE = 'coldstore-cross'
const unit = (id: string, team: 'chaff' | 'audit', integ = 400): WaveUnitState => ({
  id,
  team,
  zone: ZONE,
  integ,
  maxInteg: 400,
  type: 'line',
})

async function swingAt(index: number, waves: WaveUnitState[]): Promise<string[]> {
  const game = await seedGame('laning_combat', { heroSelf: 'echo' })
  await game.patch((s) => ({ ...s, waves }))
  game.submit({ type: 'attack', target: { kind: 'wave', index } })
  await game.tick()
  return game.lastRejected.filter((r) => r.playerId === HUMAN).map((r) => r.reason)
}

describe('attacking your own wave unit names the index that would work', () => {
  it('points at the enemy unit by its index', async () => {
    expect(await swingAt(1, [unit('e', 'audit'), unit('o', 'chaff')])).toEqual([
      'wave:1 is YOUR unit — `attack wave:0` is the enemy one (burn opens at ≤50% INTEG)',
    ])
  })

  it('offers the burn when your unit is inside the burn window', async () => {
    expect(await swingAt(0, [unit('o', 'chaff', 150), unit('e', 'audit')])).toEqual([
      'wave:0 is YOUR unit — `burn wave:0` denies it, or `attack wave:1` is the enemy one',
    ])
  })

  it('counts dead-but-unreaped units in the index, exactly as the engine resolves it', async () => {
    expect(
      await swingAt(2, [unit('gone', 'audit', 0), unit('e', 'audit'), unit('o', 'chaff')]),
    ).toEqual(['wave:2 is YOUR unit — `attack wave:1` is the enemy one (burn opens at ≤50% INTEG)'])
  })

  it('says so when no enemy unit stands in the zone', async () => {
    expect(await swingAt(0, [unit('o', 'chaff')])).toEqual([
      'wave:0 is YOUR unit — no enemy unit in this zone right now (burn opens at ≤50% INTEG)',
    ])
    expect(await swingAt(0, [unit('o', 'chaff', 150)])).toEqual([
      'wave:0 is YOUR unit — `burn wave:0` denies it (no enemy unit in this zone right now)',
    ])
  })
})
