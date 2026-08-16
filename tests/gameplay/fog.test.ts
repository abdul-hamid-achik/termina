import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN, ENEMY } from './harness'
import { filterStateForPlayer } from '~~/server/game/engine/VisionCalculator'
import { ZONES, ZONE_MAP } from '~~/shared/constants/zones'
import type { GameState, PlayerState } from '~~/shared/types/game'

/**
 * Fog is a promise in both directions, and both halves have been broken here.
 *
 * The SERVER promise: a player never receives information about ground they do
 * not hold. That is a competitive-integrity property — a leak is not a cosmetic
 * bug, it is the whole strategic layer gone, and it is invisible from the UI
 * because the client simply renders whatever it was sent.
 *
 * The CLIENT promise: what it renders is what it was actually told. TRACE
 * violated this by listing every enemy on the roster as a live contact — the
 * payload was correct and the panel invented positions for people it could not
 * see (`fogged: false` was hardcoded at the call site).
 *
 * These tests pin the server half at the payload boundary, which is the only
 * place both halves can be checked against each other.
 */

/** Everything the payload says about one player, as raw keys. */
function keysFor(view: ReturnType<typeof filterStateForPlayer>, id: string): string[] {
  const p = view.players[id]
  return p ? Object.keys(p) : []
}

/** Move a player somewhere, for arranging vision. */
function place(state: GameState, id: string, zone: string): GameState {
  const p = state.players[id]
  if (!p) throw new Error(`no such player: ${id}`)
  return { ...state, players: { ...state.players, [id]: { ...p, zone } } }
}

describe('fog of war holds at the payload boundary', () => {
  it('the durable action log never rides a player view', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.patch((s) => ({
      ...s,
      actionLog: [
        { cycle: 1, playerId: HUMAN, command: { type: 'move', zone: 'coldstore-cross' } },
      ],
    }))
    const view = filterStateForPlayer(await game.state(), HUMAN)
    expect('actionLog' in view).toBe(false)
  })

  it('an enemy outside vision carries no position, scrip or items', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    const me = await game.me()
    const myAnchor = ZONES.find((z) => z.type === 'anchor' && z.team === me.team)!
    const theirAnchor = ZONES.find((z) => z.type === 'anchor' && z.team !== me.team)!

    await game.patch((s) => place(place(s, HUMAN, myAnchor.id), ENEMY, theirAnchor.id))
    const view = filterStateForPlayer(await game.state(), HUMAN)

    const leaked = ['zone', 'scrip', 'items', 'buffs', 'cooldowns'].filter((k) =>
      keysFor(view, ENEMY).includes(k),
    )
    expect(leaked, `fogged enemy leaked: ${leaked.join(', ')}`).toEqual([])
    expect(view.players[ENEMY]).toMatchObject({ fogged: true })
  })

  it('KDA and hero stay public in fog — the scoreboard is not a leak', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    const me = await game.me()
    const myAnchor = ZONES.find((z) => z.type === 'anchor' && z.team === me.team)!
    const theirAnchor = ZONES.find((z) => z.type === 'anchor' && z.team !== me.team)!
    await game.patch((s) => place(place(s, HUMAN, myAnchor.id), ENEMY, theirAnchor.id))

    const view = filterStateForPlayer(await game.state(), HUMAN)
    // Deliberately visible: without these a fogged enemy renders as 0/0/0 and
    // the scoreboard lies in the other direction.
    for (const key of ['kills', 'deaths', 'assists', 'heroId', 'level']) {
      expect(keysFor(view, ENEMY), `fog hid public field ${key}`).toContain(key)
    }
  })

  it('stepping into vision reveals the enemy completely', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    const me = await game.me()
    const theirAnchor = ZONES.find((z) => z.type === 'anchor' && z.team !== me.team)!

    await game.patch((s) => place(s, ENEMY, theirAnchor.id))
    expect(filterStateForPlayer(await game.state(), HUMAN).players[ENEMY]).toMatchObject({
      fogged: true,
    })

    // Same zone — nothing hidden any more.
    await game.patch((s) => place(s, ENEMY, s.players[HUMAN]!.zone))
    const revealed = filterStateForPlayer(await game.state(), HUMAN).players[ENEMY] as PlayerState
    expect(revealed.fogged).toBeFalsy()
    expect(revealed.zone).toBe((await game.me()).zone)
  })

  it('visibleZones only ever names zones the team has a claim to', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const state = await game.state()
    const view = filterStateForPlayer(state, HUMAN)
    const me = state.players[HUMAN]!

    // The four sources of vision, mirrored from calculateVisionUncached. Each
    // one lights its zone AND that zone's neighbours:
    //   - where a living team member stands
    //   - your own base and anchor (home ground is always lit)
    //   - any ICE you still hold
    //   - any zone you hold a tap on
    // Anything outside that union is ground you were shown for free.
    const claimed = new Set<string>()
    const light = (zoneId: string) => {
      claimed.add(zoneId)
      for (const adj of ZONE_MAP[zoneId]?.adjacentTo ?? []) claimed.add(adj)
    }
    for (const p of Object.values(state.players)) if (p.team === me.team && p.alive) light(p.zone)
    for (const z of ZONES) {
      if (z.team === me.team && (z.type === 'base' || z.type === 'anchor')) light(z.id)
    }
    for (const ice of state.ice) if (ice.team === me.team && ice.alive) light(ice.zone)
    for (const [zoneId, zone] of Object.entries(state.zones)) {
      if (zone.wards?.some((w) => w.team === me.team)) light(zoneId)
    }

    const unclaimed = view.visibleZones.filter((z) => !claimed.has(z))
    expect(unclaimed, `vision granted with no claim: ${unclaimed.join(', ')}`).toEqual([])
  })

  it('the two teams do not receive the same picture', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    const me = await game.me()
    const myAnchor = ZONES.find((z) => z.type === 'anchor' && z.team === me.team)!
    const theirAnchor = ZONES.find((z) => z.type === 'anchor' && z.team !== me.team)!
    await game.patch((s) => place(place(s, HUMAN, myAnchor.id), ENEMY, theirAnchor.id))

    const mine = filterStateForPlayer(await game.state(), HUMAN)
    const theirs = filterStateForPlayer(await game.state(), ENEMY)
    expect(mine.visibleZones).not.toEqual(theirs.visibleZones)
    // ...and each side sees its own ground.
    expect(mine.visibleZones).toContain(myAnchor.id)
    expect(theirs.visibleZones).toContain(theirAnchor.id)
    expect(mine.visibleZones).not.toContain(theirAnchor.id)
  })

  it('a tap buys vision, and losing it takes the vision back', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me = await game.me()
    const before = filterStateForPlayer(await game.state(), HUMAN)
    // Own ICE and home ground already light most of your half, so pick a zone
    // that is genuinely dark rather than assuming one is.
    const target = ZONES.find((z) => !before.visibleZones.includes(z.id))!
    expect(target, 'fixture assumption: some zone is dark').toBeDefined()

    await game.patch((s) => ({
      ...s,
      zones: {
        ...s.zones,
        [target.id]: {
          ...s.zones[target.id]!,
          wards: [{ team: me.team, placedTick: s.cycle, expiryTick: s.cycle + 40, type: 'camtap' }],
        },
      },
    }))
    expect(filterStateForPlayer(await game.state(), HUMAN).visibleZones).toContain(target.id)

    // Remove it: the vision must not persist.
    await game.patch((s) => ({
      ...s,
      zones: { ...s.zones, [target.id]: { ...s.zones[target.id]!, wards: [] } },
    }))
    expect(filterStateForPlayer(await game.state(), HUMAN).visibleZones).not.toContain(target.id)
  })

  it("an enemy's tap grants THEM vision, not you", async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    const me = await game.me()
    const dark = filterStateForPlayer(await game.state(), HUMAN).visibleZones
    const target = ZONES.find((z) => !dark.includes(z.id))!
    const enemyTeam = me.team === 'chaff' ? 'audit' : 'chaff'

    await game.patch((s) => ({
      ...s,
      zones: {
        ...s.zones,
        [target.id]: {
          ...s.zones[target.id]!,
          wards: [
            { team: enemyTeam, placedTick: s.cycle, expiryTick: s.cycle + 40, type: 'camtap' },
          ],
        },
      },
    }))
    expect(filterStateForPlayer(await game.state(), HUMAN).visibleZones).not.toContain(target.id)
  })
})
