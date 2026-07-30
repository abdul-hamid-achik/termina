import { describe, it, expect } from 'vitest'
import { computeSituationalActions, type SituationalContext } from '~~/app/utils/situationalActions'
import { SURRENDER_MIN_TICK, HARDEN_COOLDOWN_TICKS } from '~~/shared/constants/balance'
import type { PlayerState, WaveUnitState } from '~~/shared/types/game'

const player = (over: Partial<PlayerState> = {}): PlayerState =>
  ({ items: [], zone: 'mid-river', team: 'chaff', ...over }) as unknown as PlayerState

const baseCtx = (over: Partial<SituationalContext> = {}): SituationalContext => ({
  player: player(),
  isAlive: true,
  waves: [],
  backup: null,
  caches: [],
  teams: null,
  tick: 0,
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

  it('offers BURN only when a low-HP allied wave is in the zone', () => {
    const lowAllyWave = {
      zone: 'mid-river',
      team: 'chaff',
      integ: 1,
      type: 'line',
    } as unknown as WaveUnitState
    expect(cmds(baseCtx({ waves: [lowAllyWave] }))).toContain('burn')
    expect(cmds(baseCtx({ waves: [] }))).not.toContain('burn')
  })

  it('offers BACKUP only when an unclaimed backup is in the zone', () => {
    expect(cmds(baseCtx({ backup: { zone: 'mid-river', holderId: null } }))).toContain('backup')
    expect(cmds(baseCtx({ backup: { zone: 'mid-river', holderId: 'someone' } }))).not.toContain(
      'backup',
    )
    expect(cmds(baseCtx({ backup: { zone: 'top-t1-chaff', holderId: null } }))).not.toContain(
      'backup',
    )
  })

  it('offers CACHE only when a cache is in the zone', () => {
    expect(cmds(baseCtx({ caches: [{ zone: 'mid-river' }] as never }))).toContain('cache')
    expect(cmds(baseCtx({ caches: [{ zone: 'top-t1-chaff' }] as never }))).not.toContain('cache')
  })

  it('hides HARDEN while the team harden is on cooldown', () => {
    const onCd = baseCtx({
      tick: 10,
      teams: { chaff: { hardenUsedTick: 10 }, audit: {} } as never,
    })
    expect(cmds(onCd)).not.toContain('harden')
    const offCd = baseCtx({
      tick: 10 + HARDEN_COOLDOWN_TICKS,
      teams: { chaff: { hardenUsedTick: 10 }, audit: {} } as never,
    })
    expect(cmds(offCd)).toContain('harden')
  })

  it('offers SURRENDER only once the surrender window opens', () => {
    expect(cmds(baseCtx({ tick: SURRENDER_MIN_TICK - 1 }))).not.toContain('surrender')
    expect(cmds(baseCtx({ tick: SURRENDER_MIN_TICK }))).toContain('surrender')
  })
})
