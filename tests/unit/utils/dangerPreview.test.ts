import { describe, it, expect } from 'vitest'
import {
  commandDanger,
  formatDangerWarning,
  isDangerous,
  isLethal,
  predictIncoming,
} from '~~/app/utils/dangerPreview'
import type { DangerState } from '~~/app/utils/dangerPreview'
import { ICE_ATTACK, waveUnitAttack } from '~~/shared/constants/balance'
import { HEROES } from '~~/shared/constants/heroes'
import { TRAINING_WAVE_PREFIX } from '~~/shared/constants/tutorial'
import type { FoggedPlayer, IceState, PlayerState, WaveUnitState } from '~~/shared/types/game'

const T2_AUDIT = 'coldstore-t2-audit'
const T1_AUDIT = 'coldstore-t1-audit'
const CROSS = 'coldstore-cross'

function unit(
  team: 'chaff' | 'audit',
  zone: string,
  i: number,
  type: WaveUnitState['type'] = 'line',
) {
  return { id: `w-${team}-${zone}-${i}`, team, zone, integ: 300, type } as WaveUnitState
}
function units(n: number, team: 'chaff' | 'audit', zone: string) {
  return Array.from({ length: n }, (_, i) => unit(team, zone, i))
}
function ice(team: 'chaff' | 'audit', zone: string, alive = true): IceState {
  return { team, zone, integ: 1500, maxInteg: 1500, alive, invulnerable: false }
}

/** A hero with no hero def (effective plate / ice fall back to its own
 *  plate / ice), no items, no buffs, level 1. */
function hero(over: Partial<PlayerState>): PlayerState {
  return {
    id: 'h',
    team: 'audit',
    zone: CROSS,
    integ: 550,
    alive: true,
    plate: 0,
    ice: 0,
    heroId: null,
    level: 1,
    items: [],
    buffs: [],
    ...over,
  } as PlayerState
}

function state(over: Partial<DangerState> = {}, me: Partial<PlayerState> = {}): DangerState {
  return {
    me: hero({ id: 'me', team: 'chaff', ...me }),
    waves: [],
    ice: [],
    players: {},
    cycle: 0,
    ...over,
  }
}

describe('predictIncoming', () => {
  it('reproduces the playtest stack: 12 enemy units at their T2 → ~540 against plate 6', () => {
    // cycle 199 on screen → the order resolves at 200 (multiplier 2.4 → line 48),
    // 48 × 100/106 = 45 per hit, 12 hits = 540.
    const s = state({ waves: units(12, 'audit', T2_AUDIT), cycle: 199 }, { plate: 6 })
    const z = predictIncoming(T2_AUDIT, s)
    expect(waveUnitAttack('line', 200)).toBe(48)
    expect(z.units).toBe(12)
    expect(z.total).toBe(540)
  })

  it("uses the NEXT cycle's wave attack (escalation steps on the boundary)", () => {
    const s = state({ waves: units(1, 'audit', CROSS), cycle: 49 })
    expect(predictIncoming(CROSS, s).total).toBe(waveUnitAttack('line', 50))
    expect(waveUnitAttack('line', 50)).not.toBe(waveUnitAttack('line', 49))
  })

  it('an escort of your own units takes the wave fire (WaveAI targets waves first)', () => {
    const s = state({ waves: [...units(6, 'audit', CROSS), unit('chaff', CROSS, 0)] })
    expect(predictIncoming(CROSS, s)).toMatchObject({ units: 0, total: 0 })
  })

  it('a dead or training unit is no escort and no threat', () => {
    const dead = { ...unit('chaff', CROSS, 9), integ: 0 }
    const tut = { ...unit('audit', CROSS, 8), id: `${TRAINING_WAVE_PREFIX}1` }
    const s = state({ waves: [...units(2, 'audit', CROSS), dead, tut] })
    expect(predictIncoming(CROSS, s)).toMatchObject({ units: 2, total: 40 })
  })

  it('counts enemy ICE when nothing of yours tanks it, or when the order draws its aggro', () => {
    const alone = state({ ice: [ice('audit', T1_AUDIT)] })
    expect(predictIncoming(T1_AUDIT, alone)).toMatchObject({ ice: true, total: ICE_ATTACK })

    const escorted = state({ ice: [ice('audit', T1_AUDIT)], waves: [unit('chaff', T1_AUDIT, 0)] })
    expect(predictIncoming(T1_AUDIT, escorted)).toMatchObject({ ice: false, total: 0 })
    expect(predictIncoming(T1_AUDIT, escorted, { drawsIceAggro: true })).toMatchObject({
      ice: true,
      total: ICE_ATTACK,
    })
  })

  it('ignores your own ICE and a dead enemy ICE', () => {
    const s = state({ ice: [ice('chaff', T1_AUDIT), ice('audit', T1_AUDIT, false)] })
    expect(predictIncoming(T1_AUDIT, s).total).toBe(0)
  })

  it('adds visible enemy heroes at their level attack; skips allies, fogged and dead', () => {
    const echo = HEROES.echo!
    const lvl = 5
    const atk = echo.baseStats.attack + (echo.growthPerLevel.attack ?? 0) * (lvl - 1)
    const fogged = { id: 'e3', team: 'audit', alive: true, heroId: 'echo', fogged: true }
    const players: Record<string, PlayerState | FoggedPlayer> = {
      e1: hero({ id: 'e1', heroId: 'echo', level: lvl }),
      e2: hero({ id: 'e2', alive: false, heroId: 'echo' }),
      e3: fogged as FoggedPlayer,
      a1: hero({ id: 'a1', team: 'chaff', heroId: 'echo', level: 9 }),
    }
    expect(predictIncoming(CROSS, state({ players }))).toMatchObject({ heroes: 1, total: atk })
  })

  it('applies plate to kinetic fire', () => {
    const s = state({ ice: [ice('audit', T1_AUDIT)] }, { plate: 20 })
    expect(predictIncoming(T1_AUDIT, s).total).toBe(Math.round(ICE_ATTACK * (100 / 120)))
  })
})

describe('isDangerous / isLethal', () => {
  it('is dangerous once three cycles of it would finish you, lethal at one', () => {
    expect(isDangerous(184, 550)).toBe(true)
    expect(isDangerous(183, 550)).toBe(false)
    expect(isDangerous(0, 0)).toBe(false)
    expect(isLethal(550, 550)).toBe(true)
    expect(isLethal(549, 550)).toBe(false)
  })
})

describe('formatDangerWarning', () => {
  it('names the zone, the sources, the rate and your INTEG', () => {
    expect(
      formatDangerWarning({ zone: T2_AUDIT, total: 540, units: 12, ice: false, heroes: 0 }, 550),
    ).toBe('⚠ Coldstore T2 (AUDIT): 12 enemy units (~540/cycle) — you have 550')
    expect(
      formatDangerWarning({ zone: T1_AUDIT, total: 300, units: 1, ice: true, heroes: 1 }, 250),
    ).toBe(
      '⚠ Coldstore T1 (AUDIT): 1 enemy unit + ICE + 1 enemy hero (~300/cycle) — you have 250 — lethal',
    )
  })
})

describe('commandDanger', () => {
  it('warns on a move into the stack', () => {
    const s = state(
      { waves: units(12, 'audit', T2_AUDIT), cycle: 199 },
      { zone: T1_AUDIT, plate: 6 },
    )
    const d = commandDanger({ type: 'move', zone: T2_AUDIT }, s)
    expect(d?.incoming.zone).toBe(T2_AUDIT)
    expect(d?.text).toContain('12 enemy units (~540/cycle) — you have 550')
  })

  it('warns on a multi-hop walk at the first dangerous zone on the way', () => {
    const s = state({ waves: units(12, 'audit', T1_AUDIT) })
    const d = commandDanger({ type: 'move', zone: T2_AUDIT }, s)
    expect(d?.incoming.zone).toBe(T1_AUDIT)
  })

  it('is silent for a move into a quiet zone', () => {
    const s = state({ waves: units(2, 'audit', T1_AUDIT) })
    expect(commandDanger({ type: 'move', zone: T1_AUDIT }, s)).toBeNull()
  })

  it('an `attack ice:` walk draws the ICE even with your units there', () => {
    const s = state(
      {
        waves: [...units(4, 'audit', T1_AUDIT), unit('chaff', T1_AUDIT, 0)],
        ice: [ice('audit', T1_AUDIT)],
      },
      { integ: 300 },
    )
    const d = commandDanger({ type: 'attack', target: { kind: 'ice', zone: T1_AUDIT } }, s)
    // Escort busy with the wave → units hold off, but the ICE is on you.
    expect(d?.incoming).toMatchObject({ zone: T1_AUDIT, ice: true, units: 0, total: ICE_ATTACK })
  })

  it('an `attack ice:` push into ICE + 4 units with no escort reads the playtest ~300', () => {
    const s = state(
      { waves: units(4, 'audit', T1_AUDIT), ice: [ice('audit', T1_AUDIT)], cycle: 199 },
      { plate: 6 },
    )
    const d = commandDanger({ type: 'attack', target: { kind: 'ice', zone: T1_AUDIT } }, s)
    expect(d?.incoming.total).toBe(4 * 45 + Math.round(ICE_ATTACK * (100 / 106)))
  })

  it('`attack wave:0` / `burn` keep you IN the zone and are judged there', () => {
    const s = state({ waves: units(12, 'audit', CROSS) }, { integ: 200 })
    expect(
      commandDanger({ type: 'attack', target: { kind: 'wave', index: 0 } }, s)?.incoming.zone,
    ).toBe(CROSS)
    expect(commandDanger({ type: 'burn', target: { kind: 'wave', index: 0 } }, s)).not.toBeNull()
  })

  it('`attack hero` in an enemy ICE zone draws the ICE over your escort', () => {
    const s = state(
      { ice: [ice('audit', T1_AUDIT)], waves: [unit('chaff', T1_AUDIT, 0)] },
      { zone: T1_AUDIT, integ: 300 },
    )
    const d = commandDanger({ type: 'attack', target: { kind: 'hero', name: 'echo' } }, s)
    expect(d?.incoming.ice).toBe(true)
  })

  it('says nothing for orders that do not place you anywhere, or when you are down', () => {
    const s = state({ waves: units(12, 'audit', CROSS) })
    expect(commandDanger({ type: 'buy', item: 'x' }, s)).toBeNull()
    expect(
      commandDanger(
        { type: 'burn', target: { kind: 'wave', index: 0 } },
        state({ waves: units(12, 'audit', CROSS) }, { alive: false }),
      ),
    ).toBeNull()
  })
})
