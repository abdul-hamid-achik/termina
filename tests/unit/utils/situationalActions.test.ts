import { describe, it, expect } from 'vitest'
import { computeSituationalActions, type SituationalContext } from '~~/app/utils/situationalActions'
import { SURRENDER_MIN_TICK, GLYPH_COOLDOWN_TICKS } from '~~/shared/constants/balance'
import type { PlayerState, CreepState } from '~~/shared/types/game'

const player = (over: Partial<PlayerState> = {}): PlayerState =>
  ({ items: [], zone: 'mid-river', team: 'chaff', ...over }) as unknown as PlayerState

const baseCtx = (over: Partial<SituationalContext> = {}): SituationalContext => ({
  player: player(),
  isAlive: true,
  creeps: [],
  backup: null,
  runes: [],
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

  it('offers only glyph in the empty base case (tick 0, nothing nearby)', () => {
    // glyph is ready when there is no team state; surrender is gated by tick.
    expect(cmds(baseCtx())).toEqual(['glyph'])
  })

  it('offers WARD only when carrying a ward item', () => {
    expect(cmds(baseCtx({ player: player({ items: ['observer_ward'] }) }))).toContain('ward')
    expect(cmds(baseCtx({ player: player({ items: ['sentry_ward'] }) }))).toContain('ward')
    expect(cmds(baseCtx({ player: player({ items: ['blink_dagger'] }) }))).not.toContain('ward')
  })

  it('offers DENY only when a low-HP allied creep is in the zone', () => {
    const lowAllyCreep = {
      zone: 'mid-river',
      team: 'chaff',
      hp: 1,
      type: 'melee',
    } as unknown as CreepState
    expect(cmds(baseCtx({ creeps: [lowAllyCreep] }))).toContain('deny')
    expect(cmds(baseCtx({ creeps: [] }))).not.toContain('deny')
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

  it('offers RUNE only when a rune is in the zone', () => {
    expect(cmds(baseCtx({ runes: [{ zone: 'mid-river' }] as never }))).toContain('rune')
    expect(cmds(baseCtx({ runes: [{ zone: 'top-t1-chaff' }] as never }))).not.toContain('rune')
  })

  it('hides GLYPH while the team glyph is on cooldown', () => {
    const onCd = baseCtx({
      tick: 10,
      teams: { chaff: { glyphUsedTick: 10 }, audit: {} } as never,
    })
    expect(cmds(onCd)).not.toContain('glyph')
    const offCd = baseCtx({
      tick: 10 + GLYPH_COOLDOWN_TICKS,
      teams: { chaff: { glyphUsedTick: 10 }, audit: {} } as never,
    })
    expect(cmds(offCd)).toContain('glyph')
  })

  it('offers SURRENDER only once the surrender window opens', () => {
    expect(cmds(baseCtx({ tick: SURRENDER_MIN_TICK - 1 }))).not.toContain('surrender')
    expect(cmds(baseCtx({ tick: SURRENDER_MIN_TICK }))).toContain('surrender')
  })
})
