import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN, ENEMY } from './harness'
import { WAVE_XP_SHARED, waveUnitMaxHp } from '~~/shared/constants/balance'
import type { WaveUnitState } from '~~/shared/types/game'

/**
 * Live quick match (Oct 2026): a defending human sat at their own ICE in a
 * losing lane and stayed far behind the bots in level. Presence XP
 * (XpDistributor.awardZoneXp) paid when a wave died to a HERO strip or to
 * another WAVE — but a wave felled by ICE paid nobody, and in a losing lane
 * that is how most enemy units die. Being there when a wave dies pays,
 * whoever or whatever lands the blow.
 */

const OWN_T1 = 'coldstore-t1-chaff'
/** A non-default cycle (escalated waves) and not a spawn cycle once ticked. */
const LATE = 211

function auditUnit(id: string, integ: number): WaveUnitState {
  return {
    id,
    team: 'audit',
    zone: OWN_T1,
    integ,
    maxInteg: waveUnitMaxHp('line', LATE),
    type: 'line',
  }
}

async function defenderAtOwnIce(units: WaveUnitState[]) {
  const game = await seedGame('fresh')
  await game.patch((s) => ({
    ...s,
    cycle: LATE,
    waves: units,
    players: {
      ...s.players,
      [HUMAN]: { ...s.players[HUMAN]!, zone: OWN_T1, alive: true },
      [ENEMY]: { ...s.players[ENEMY]!, zone: 'landing-anchor' },
    },
  }))
  return game
}

describe('a wave felled by ICE pays presence XP', () => {
  it('the defender standing in the ICE zone draws WAVE_XP_SHARED when its ICE downs an enemy unit', async () => {
    // 1 INTEG: the ICE's single shot this cycle is lethal whatever its attack.
    const game = await defenderAtOwnIce([auditUnit('wave-ice-fodder', 1)])
    const before = (await game.me()).xp

    await game.tick()

    const s = await game.state()
    expect(s.waves.some((w) => w.id === 'wave-ice-fodder')).toBe(false)
    expect(s.players[HUMAN]!.xp).toBe(before + WAVE_XP_SHARED)
  })

  it('pays only the ICE crew, only in that zone, and never the dead', async () => {
    const game = await seedGame('fresh', {
      players: [
        { id: HUMAN, name: HUMAN, team: 'chaff', heroId: 'echo' },
        { id: 'ally_away', name: 'ally_away', team: 'chaff', heroId: 'regex' },
        { id: 'ally_dead', name: 'ally_dead', team: 'chaff', heroId: 'kernel' },
        { id: ENEMY, name: ENEMY, team: 'audit', heroId: 'daemon' },
      ],
    })
    await game.patch((s) => ({
      ...s,
      cycle: LATE,
      waves: [auditUnit('wave-ice-fodder', 1)],
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, zone: OWN_T1 },
        ally_away: { ...s.players.ally_away!, zone: 'coldstore-t2-chaff' },
        ally_dead: {
          ...s.players.ally_dead!,
          zone: OWN_T1,
          alive: false,
          integ: 0,
          respawnCycle: LATE + 50,
        },
        // An enemy hero standing in the zone is no claimant of the chaff ICE's kill.
        [ENEMY]: { ...s.players[ENEMY]!, zone: OWN_T1 },
      },
    }))
    const before = await game.state()

    await game.tick()

    const s = await game.state()
    expect(s.players[HUMAN]!.xp).toBe(before.players[HUMAN]!.xp + WAVE_XP_SHARED)
    expect(s.players.ally_away!.xp).toBe(before.players.ally_away!.xp)
    expect(s.players.ally_dead!.xp).toBe(before.players.ally_dead!.xp)
    expect(s.players[ENEMY]!.xp).toBe(before.players[ENEMY]!.xp)
  })

  it('a unit the ICE only wounds pays nothing', async () => {
    const full = waveUnitMaxHp('line', LATE)
    const game = await defenderAtOwnIce([auditUnit('wave-tough', full)])
    const before = (await game.me()).xp

    await game.tick()

    const s = await game.state()
    expect(s.waves.find((w) => w.id === 'wave-tough')!.integ).toBeLessThan(full)
    expect(s.players[HUMAN]!.xp).toBe(before)
  })
})
