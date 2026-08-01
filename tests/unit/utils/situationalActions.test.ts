import { describe, it, expect } from 'vitest'
import { computeSituationalActions, type SituationalContext } from '~~/app/utils/situationalActions'
import { SURRENDER_MIN_CYCLE, HARDEN_COOLDOWN_CYCLES } from '~~/shared/constants/balance'
import type { PlayerState, WaveUnitState } from '~~/shared/types/game'

const player = (over: Partial<PlayerState> = {}): PlayerState =>
  ({ items: [], zone: 'coldstore-cross', team: 'chaff', ...over }) as unknown as PlayerState

const baseCtx = (over: Partial<SituationalContext> = {}): SituationalContext => ({
  player: player(),
  isAlive: true,
  waves: [],
  backup: null,
  caches: [],
  teams: null,
  cycle: 0,
  ...over,
})

const cmds = (ctx: SituationalContext) => computeSituationalActions(ctx).map((a) => a.cmd)

describe('computeSituationalActions', () => {
  it('returns nothing when there is no player or the player is dead', () => {
    expect(computeSituationalActions(baseCtx({ player: null }))).toEqual([])
    expect(computeSituationalActions(baseCtx({ isAlive: false }))).toEqual([])
  })

  it('offers only harden in the empty base case (tick 0, nothing nearby)', () => {
    // harden is ready when there is no team state; surrender is gated by tick.
    expect(cmds(baseCtx())).toEqual(['harden'])
  })

  it('offers WARD only when carrying a ward item', () => {
    expect(cmds(baseCtx({ player: player({ items: ['camtap'] }) }))).toContain('ward')
    expect(cmds(baseCtx({ player: player({ items: ['sniffer'] }) }))).toContain('ward')
    expect(cmds(baseCtx({ player: player({ items: ['blink_dagger'] }) }))).not.toContain('ward')
  })

  it('offers BURN only when a low-INTEG allied wave is in the zone', () => {
    const lowAllyWave = {
      zone: 'coldstore-cross',
      team: 'chaff',
      integ: 1,
      type: 'line',
    } as unknown as WaveUnitState
    expect(cmds(baseCtx({ waves: [lowAllyWave] }))).toContain('burn')
    expect(cmds(baseCtx({ waves: [] }))).not.toContain('burn')
  })

  it('offers BACKUP only when an unclaimed backup is in the zone', () => {
    expect(cmds(baseCtx({ backup: { zone: 'coldstore-cross', holderId: null } }))).toContain(
      'backup',
    )
    expect(
      cmds(baseCtx({ backup: { zone: 'coldstore-cross', holderId: 'someone' } })),
    ).not.toContain('backup')
    expect(cmds(baseCtx({ backup: { zone: 'seawall-t1-chaff', holderId: null } }))).not.toContain(
      'backup',
    )
  })

  it('offers CACHE only when a cache is in the zone', () => {
    expect(cmds(baseCtx({ caches: [{ zone: 'coldstore-cross' }] as never }))).toContain('grab')
    expect(cmds(baseCtx({ caches: [{ zone: 'seawall-t1-chaff' }] as never }))).not.toContain('grab')
  })

  it('offers FLUSH only while the player carries a BREACHED buff', () => {
    expect(cmds(baseCtx())).not.toContain('breach self')
    expect(
      cmds(
        baseCtx({
          player: player({
            buffs: [{ id: 'breached', stacks: 1, cyclesRemaining: 2, source: 'enemy' }],
          }),
        }),
      ),
    ).toContain('breach self')
  })

  it('hides HARDEN while the team harden is on cooldown', () => {
    const onCd = baseCtx({
      cycle: 10,
      teams: { chaff: { hardenUsedCycle: 10 }, audit: {} } as never,
    })
    expect(cmds(onCd)).not.toContain('harden')
    const offCd = baseCtx({
      cycle: 10 + HARDEN_COOLDOWN_CYCLES,
      teams: { chaff: { hardenUsedCycle: 10 }, audit: {} } as never,
    })
    expect(cmds(offCd)).toContain('harden')
  })

  it('offers SURRENDER only once the surrender window opens', () => {
    expect(cmds(baseCtx({ cycle: SURRENDER_MIN_CYCLE - 1 }))).not.toContain('surrender')
    expect(cmds(baseCtx({ cycle: SURRENDER_MIN_CYCLE }))).toContain('surrender')
  })
})
