import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN, ENEMY } from './harness'
import { filterStateForPlayer, eventForViewer } from '~~/server/game/engine/VisionCalculator'
import { ZONES } from '~~/shared/constants/zones'
import type { GameState } from '~~/shared/types/game'

/**
 * Combat events must reach the players they concern through the REAL tick →
 * per-player fog filter path. They used to be dropped wholesale: damage, heal,
 * kill and status events carried no `team`/`playerId`/`zone`, so the filter
 * had nothing to key on and "why did I die?" was unanswerable in production.
 */

function place(state: GameState, id: string, zone: string): GameState {
  const p = state.players[id]!
  return { ...state, players: { ...state.players, [id]: { ...p, zone } } }
}

const topUp = (s: GameState): GameState => ({
  ...s,
  players: Object.fromEntries(
    Object.entries(s.players).map(([id, p]) => [
      id,
      { ...p, cooldowns: { q: 0, w: 0, e: 0, r: 0 }, bw: p.maxBw, integ: p.maxInteg },
    ]),
  ),
})

describe('combat events reach the players they concern', () => {
  it('an enemy hitting me: both of us receive the damage line, located where it landed', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.tick() // settle the first-tick maxInteg recompute
    game.attackHero(HUMAN, ENEMY)
    await game.tick()

    const state = await game.state()
    for (const viewer of [HUMAN, ENEMY]) {
      const hit = filterStateForPlayer(state, viewer).events.find(
        (e) => e.type === 'damage' && e.payload.sourceId === ENEMY && e.payload.targetId === HUMAN,
      )
      expect(hit, `${viewer} never received the hit`).toBeDefined()
      expect(hit!.payload.zone).toBe('coldstore-cross')
    }
  })

  it('a status lands where the target STOOD, even if they walk out the same cycle', async () => {
    // Cipher E (Decrypt) silences in the instant phase, before movement; a
    // silence doesn't stop the walk. Located post-move, the enemy's own crew
    // would place the silence in the wrong zone.
    const game = await seedGame('laning_combat', { heroSelf: 'cipher', heroEnemy: 'daemon' })
    await game.tick()
    await game.patch(topUp)
    // Already BREACHED, so the control lands instead of auto-converting.
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [ENEMY]: {
          ...s.players[ENEMY]!,
          buffs: [{ id: 'breached', stacks: 1, cyclesRemaining: 3, source: HUMAN }],
        },
      },
    }))
    game.cast('e', { kind: 'hero', name: ENEMY })
    game.submit({ type: 'move', zone: 'coldstore-t1-audit' }, ENEMY)
    await game.tick()

    const state = await game.state()
    expect(state.players[ENEMY]!.zone).toBe('coldstore-t1-audit')
    const silenced = state.events.find(
      (e) => e.type === 'status_applied' && e.payload.targetId === ENEMY,
    )
    expect(silenced, 'no status_applied for the silence').toBeDefined()
    expect(silenced!.payload.zone).toBe('coldstore-cross')
  })

  it('an enemy farming in my fog stays hidden; the same swing in sight is delivered', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    const me = await game.me()
    const myAnchor = ZONES.find((z) => z.type === 'anchor' && z.team === me.team)!
    const fog = 'coldstore-t2-audit'
    await game.patch((s) => ({
      ...place(place(s, HUMAN, myAnchor.id), ENEMY, fog),
      waves: [
        { id: 'wave-fog', team: me.team, zone: fog, integ: 400, maxInteg: 400, type: 'line' },
      ],
    }))
    await game.tick()
    game.submit({ type: 'attack', target: { kind: 'wave', index: 0 } }, ENEMY)
    await game.tick()

    const state = await game.state()
    const swing = (viewer: string) =>
      filterStateForPlayer(state, viewer).events.filter(
        (e) => e.type === 'damage' && e.payload.sourceId === ENEMY,
      )
    // Engine truth: the swing happened.
    expect(game.lastEvents.some((e) => e._tag === 'damage' && e.sourceId === ENEMY)).toBe(true)
    expect(swing(ENEMY)).toHaveLength(1)
    expect(swing(HUMAN), 'enemy position leaked through a fogged damage line').toEqual([])
  })
})

describe('enemy cast lines', () => {
  it('an enemy AoE cast in my zone reaches me (no targetId), located on the caster', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'kernel' })
    await game.tick()
    await game.patch((s) => ({ ...topUp(s), cycle: 158 }))
    game.cast('e', undefined, ENEMY) // Core Dump — untargeted AoE taunt
    await game.tick()
    const state = await game.state()
    const line = filterStateForPlayer(state, HUMAN).events.find(
      (e) => e.type === 'ability_used' && e.payload.playerId === ENEMY,
    )
    expect(line, 'the victim never saw the cast').toBeDefined()
    expect(line!.payload.zone).toBe(state.players[ENEMY]!.zone)
  })

  it('a cast in the fog stays hidden', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'kernel' })
    await game.tick()
    await game.patch((s) => ({ ...place(topUp(s), ENEMY, 'shallows-t3-audit'), cycle: 158 }))
    game.cast('e', undefined, ENEMY)
    await game.tick()
    const mine = filterStateForPlayer(await game.state(), HUMAN).events
    expect(mine.some((e) => e.type === 'ability_used')).toBe(false)
  })

  it('an enemy cast aimed at me carries no cooldown; my own cast line keeps it', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.tick()
    await game.patch((s) => ({ ...topUp(s), cycle: 158 }))
    game.cast('q', { kind: 'hero', name: HUMAN }, ENEMY) // Inject — damage, no control
    await game.tick()
    const state = await game.state()
    const seen = filterStateForPlayer(state, HUMAN).events.find(
      (e) => e.type === 'ability_used' && e.payload.playerId === ENEMY,
    )
    expect(seen).toBeDefined()
    expect('cooldown' in seen!.payload).toBe(false)
    const own = filterStateForPlayer(state, ENEMY).events.find(
      (e) => e.type === 'ability_used' && e.payload.playerId === ENEMY,
    )
    expect(own!.payload.cooldown).toBeGreaterThan(0)
  })
})

describe('an enemy cast seen only because it names my hero', () => {
  it('loses the caster zone stamp when that zone is fogged', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    const state = await game.state()
    const e = {
      cycle: 9,
      type: 'ability_used',
      payload: {
        playerId: ENEMY,
        abilityId: 'daemon-q',
        targetId: HUMAN,
        zone: 'shallows-t3-audit',
      },
    }
    const out = eventForViewer(e, state, 'chaff', new Set(['coldstore-cross']))
    expect(out).not.toBeNull()
    expect('zone' in out!.payload).toBe(false)
  })
})
