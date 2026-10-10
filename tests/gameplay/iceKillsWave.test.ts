import { describe, it, expect } from 'vitest'
import { seedGame } from './harness'
import { LINE_UNIT_HP } from '~~/shared/constants/balance'

/**
 * ICE felled by a WAVE counts. trackIceKills used to run before NPC AI, so a
 * wave that killed ICE never incremented teams.iceKills nor emitted ice_kill
 * (scoreboards read 0:0 with 3-7 ICE dead). Hero kills must still count once.
 */
describe('ice kills from any source', () => {
  const ZONE = 'coldstore-t1-audit'

  it('a wave felling ICE increments the killing crew iceKills once and emits ice_kill once', async () => {
    const game = await seedGame('fresh', { mapId: 'one_lane' })
    await game.patch((s) => ({
      ...s,
      // Leave ONE point of INTEG so any wave swing finishes the ICE.
      ice: s.ice.map((t) => (t.zone === ZONE ? { ...t, integ: 1, invulnerable: false } : t)),
      waves: [
        {
          id: 'wave-fell',
          team: 'chaff' as const,
          zone: ZONE,
          integ: LINE_UNIT_HP,
          maxInteg: LINE_UNIT_HP,
          type: 'line' as const,
        },
      ],
    }))
    const before = (await game.state()).teams.chaff.iceKills

    await game.tick()

    const s = await game.state()
    expect(s.ice.find((t) => t.zone === ZONE)!.alive).toBe(false)
    expect(s.teams.chaff.iceKills).toBe(before + 1)
    const evs = game.lastEvents.filter(
      (e) => e._tag === 'ice_kill' && (e as { zone: string }).zone === ZONE,
    )
    expect(evs).toHaveLength(1)
    expect(evs[0]).toMatchObject({ killerTeam: 'chaff', team: 'audit' })

    // Later cycles never re-count an already-dead ICE.
    await game.tick(3)
    expect((await game.state()).teams.chaff.iceKills).toBe(before + 1)
  })

  it('a HERO felling ICE still counts exactly once (no double count)', async () => {
    const game = await seedGame('fresh', { mapId: 'one_lane' })
    await game.patch((s) => ({
      ...s,
      ice: s.ice.map((t) => (t.zone === ZONE ? { ...t, integ: 1, invulnerable: false } : t)),
      waves: [],
      players: {
        ...s.players,
        human: { ...s.players.human!, zone: ZONE, alive: true },
        enemy: { ...s.players.enemy!, zone: 'landing-anchor' },
      },
    }))
    game.submit({ type: 'attack', target: { kind: 'ice', zone: ZONE } as never })
    await game.tick()
    const s = await game.state()
    expect(s.ice.find((t) => t.zone === ZONE)!.alive).toBe(false)
    expect(s.teams.chaff.iceKills).toBe(1)
    expect(game.lastEvents.filter((e) => e._tag === 'ice_kill')).toHaveLength(1)
  })
})
