import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import { seedGame, HUMAN, ENEMY, type Run } from './harness'
import type { GameState } from '~~/shared/types/game'
import type { TargetRef } from '~~/shared/types/commands'
import { createInMemoryStateManager } from '~~/server/game/engine/StateManager'
import { processCycle, submitReplayAction } from '~~/server/game/engine/GameLoop'
import { resetWaveIdCounter } from '~~/server/game/map/spawner'
import {
  reconstructReplay,
  finalSummaryHash,
  type LoggedAction,
  type SnapshotMeta,
} from '~~/server/game/engine/replayArtifact'

/**
 * Playtest 2 (Oct 2026), tutorial ICE drill: the hint says
 * `attack ice:coldstore-t1-audit`, and typed from anywhere but that zone it was
 * refused — attacking a structure did not auto-path the way `move` does. A
 * player who then walked in had to read, type and wait a cycle under four waves
 * and the ICE itself, and died.
 *
 * ICE and Terminals never move, so an attack on one aimed from outside its zone
 * is a standing order: walk there (one hop per cycle, exactly like `move`) and
 * swing on arrival. Hero targets keep the old rule — they move.
 */

const T1_AUDIT = 'coldstore-t1-audit'
const ICE_T1: TargetRef = { kind: 'ice', zone: T1_AUDIT }

/** The human at `zone`, the enemy hero parked far away (its own fountain). */
async function setup(zone: string, patch: (s: GameState) => GameState = (s) => s): Promise<Run> {
  const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
  await game.patch((s) =>
    patch({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, zone },
        [ENEMY]: { ...s.players[ENEMY]!, zone: 'landing-anchor' },
      },
    }),
  )
  return game
}

const iceHitsBy = (game: Run, zone: string) =>
  game.lastEvents.filter(
    (e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === `ice_${zone}`,
  ).length

const mine = (game: Run) => game.lastRejected.filter((r) => r.playerId === HUMAN)

describe('attacking ICE from outside its zone walks there and swings', () => {
  it('walks every hop without another order, then hits on the cycle after arrival', async () => {
    // coldstore-t2-chaff → t1-chaff → cross → t1-audit: three hops.
    const game = await setup('coldstore-t2-chaff')
    game.submit({ type: 'attack', target: ICE_T1 })

    await game.tick()
    expect(mine(game)).toEqual([])
    let me = await game.me()
    expect(me.zone).toBe('coldstore-t1-chaff')
    expect(me.moveTarget).toBe(T1_AUDIT)
    expect(me.attackTarget).toEqual(ICE_T1)

    await game.tick(2)
    me = await game.me()
    expect(me.zone).toBe(T1_AUDIT)
    expect(mine(game)).toEqual([])
    expect(iceHitsBy(game, T1_AUDIT)).toBe(0) // arrival cycle: the walk was the action

    await game.tick()
    expect(iceHitsBy(game, T1_AUDIT)).toBe(1)
    expect(mine(game)).toEqual([])
    // And it keeps swinging, as a standing order on ICE always has.
    await game.tick()
    expect(iceHitsBy(game, T1_AUDIT)).toBe(1)
  })

  it('refuses an ICE still covered by the tier in front of it — no walk starts', async () => {
    const game = await setup('coldstore-cross')
    game.submit({ type: 'attack', target: { kind: 'ice', zone: 'coldstore-t2-audit' } })
    await game.tick()
    expect(mine(game).map((r) => r.reason)).toEqual([
      'That ice is protected — destroy the one in front of it first',
    ])
    const me = await game.me()
    expect(me.zone).toBe('coldstore-cross')
    expect(me.moveTarget ?? null).toBeNull()
    expect(me.attackTarget ?? null).toBeNull()
  })

  it('a Hardened ICE ordered from range walks (saying how long it holds) and swings once it expires', async () => {
    // Harden lasts 5 cycles; a 3-hop walk plus the wait at the ICE outlasts it.
    // Refusing the order at range made the player retype it when it expired.
    const game = await setup('coldstore-t2-chaff')
    const cycle = (await game.state()).cycle
    await game.patch((s) => ({
      ...s,
      teams: { ...s.teams, audit: { ...s.teams.audit, hardenUsedCycle: cycle } },
      ice: s.ice.map((t) => (t.team === 'audit' ? { ...t, invulnerable: true } : t)),
    }))
    game.submit({ type: 'attack', target: ICE_T1 })
    await game.tick() // resolves cycle+1: Hardened through cycle+5, swings land from cycle+6
    expect(mine(game)).toEqual([])
    expect(game.lastNotices.filter((n) => n.playerId === HUMAN).map((n) => n.message)).toEqual([
      'That ice is Hardened for 5 more cycles — walking there anyway; the attack lands once it expires',
    ])
    expect((await game.me()).moveTarget).toBe(T1_AUDIT)
    await game.tick(2) // arrive at cycle+3
    expect((await game.me()).zone).toBe(T1_AUDIT)
    let hits = 0
    for (let c = cycle + 4; c <= cycle + 5; c++) {
      await game.tick() // still Hardened: the held order waits, unreported
      hits += iceHitsBy(game, T1_AUDIT)
      expect(mine(game)).toEqual([])
      expect(game.lastEvents.some((e) => e._tag === 'ice_invulnerable')).toBe(true)
    }
    expect(hits).toBe(0)
    expect((await game.me()).attackTarget).toEqual(ICE_T1)
    await game.tick() // cycle+6: expired — the first swing lands, exactly as the note said
    expect(iceHitsBy(game, T1_AUDIT)).toBe(1)
  })

  it('a Hardened ICE typed IN its zone is still refused with the Hardened reason', async () => {
    const game = await setup(T1_AUDIT, (s) => ({
      ...s,
      ice: s.ice.map((t) => (t.zone === T1_AUDIT ? { ...t, invulnerable: true } : t)),
    }))
    game.submit({ type: 'attack', target: ICE_T1 })
    await game.tick()
    expect(mine(game).map((r) => r.reason)).toEqual([
      'That ice is Hardened — attacks do nothing until it expires',
    ])
  })

  it('a Hardened ICE that is also covered is refused as protected — Harden does not hide tier order', async () => {
    const game = await setup('coldstore-cross', (s) => ({
      ...s,
      ice: s.ice.map((t) => (t.team === 'audit' ? { ...t, invulnerable: true } : t)),
    }))
    game.submit({ type: 'attack', target: { kind: 'ice', zone: 'coldstore-t2-audit' } })
    await game.tick()
    expect(mine(game).map((r) => r.reason)).toEqual([
      'That ice is protected — destroy the one in front of it first',
    ])
    expect((await game.me()).moveTarget ?? null).toBeNull()
  })

  it('refuses your own ICE — from range and in its zone', async () => {
    const far = await setup('coldstore-cross')
    far.submit({ type: 'attack', target: { kind: 'ice', zone: 'coldstore-t1-chaff' } })
    await far.tick()
    expect(mine(far).map((r) => r.reason)).toEqual(['That is your own ICE'])
    expect((await far.me()).zone).toBe('coldstore-cross')

    const near = await setup('coldstore-t1-chaff')
    near.submit({ type: 'attack', target: { kind: 'ice', zone: 'coldstore-t1-chaff' } })
    await near.tick()
    expect(mine(near).map((r) => r.reason)).toEqual(['That is your own ICE'])
    expect(iceHitsBy(near, 'coldstore-t1-chaff')).toBe(0)
  })

  it('a walk toward ICE that falls on the way retires in silence', async () => {
    const game = await setup('coldstore-t2-chaff')
    game.submit({ type: 'attack', target: ICE_T1 })
    await game.tick()
    await game.patch((s) => ({
      ...s,
      ice: s.ice.map((t) => (t.zone === T1_AUDIT ? { ...t, integ: 0, alive: false } : t)),
    }))
    for (let i = 0; i < 4; i++) {
      await game.tick()
      expect(mine(game)).toEqual([])
    }
    expect((await game.me()).attackTarget ?? null).toBeNull()
  })

  it('a held ICE order never walks a hero back after something else moved them (recall)', async () => {
    // The hero was hitting T1 and recalled home: an item active keeps the attack
    // order (KEEPS_ATTACK), so the next idle cycle re-swings from the fountain.
    // That must retire the order quietly — not march the hero back to the ICE.
    const game = await setup('rookery-anchor', (s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, attackTarget: ICE_T1 } },
    }))
    await game.tick()
    const me = await game.me()
    expect(me.zone).toBe('rookery-anchor')
    expect(me.attackTarget ?? null).toBeNull()
    expect(me.moveTarget ?? null).toBeNull()
    expect(mine(game)).toEqual([])
  })

  it('a Harden that lands mid-walk holds the order instead of ending it', async () => {
    const game = await setup('coldstore-cross')
    game.submit({ type: 'attack', target: ICE_T1 })
    await game.tick() // arrive
    await game.patch((s) => ({
      ...s,
      ice: s.ice.map((t) => (t.zone === T1_AUDIT ? { ...t, invulnerable: true } : t)),
    }))
    await game.tick()
    expect(iceHitsBy(game, T1_AUDIT)).toBe(0)
    expect(mine(game)).toEqual([])
    expect((await game.me()).attackTarget).toEqual(ICE_T1)
    await game.patch((s) => ({
      ...s,
      ice: s.ice.map((t) => (t.zone === T1_AUDIT ? { ...t, invulnerable: false } : t)),
    }))
    await game.tick()
    expect(iceHitsBy(game, T1_AUDIT)).toBe(1)
  })

  it('a new move replaces the order, and death ends it', async () => {
    const game = await setup('coldstore-t2-chaff')
    game.submit({ type: 'attack', target: ICE_T1 })
    await game.tick()
    game.submit({ type: 'move', zone: 'coldstore-t3-chaff' })
    await game.tick()
    let me = await game.me()
    expect(me.attackTarget ?? null).toBeNull()
    expect(me.zone).toBe('coldstore-t2-chaff')

    const dies = await setup('coldstore-t2-chaff')
    dies.submit({ type: 'attack', target: ICE_T1 })
    await dies.tick()
    await dies.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, integ: 0, alive: false, respawnCycle: null },
      },
    }))
    await dies.tick()
    me = await dies.me()
    expect(me.attackTarget ?? null).toBeNull()
    expect(me.moveTarget ?? null).toBeNull()
  })

  it('a rooted hero is told why the walk cannot start', async () => {
    const game = await setup('coldstore-cross', (s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          buffs: [{ id: 'root', stacks: 1, cyclesRemaining: 3, source: ENEMY }],
        },
      },
    }))
    game.submit({ type: 'attack', target: ICE_T1 })
    await game.tick()
    expect(mine(game).map((r) => r.reason)).toEqual(['Cannot move while rooted or stunned'])
    expect((await game.me()).zone).toBe('coldstore-cross')
  })

  it('a taunt mid-walk forces a swing at the taunter but keeps the held ICE order', async () => {
    const game = await setup('coldstore-t2-chaff')
    game.submit({ type: 'attack', target: ICE_T1 })
    await game.tick()
    expect((await game.me()).attackTarget).toEqual(ICE_T1)
    // The enemy steps into the walker's zone and taunts for one cycle.
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [ENEMY]: { ...s.players[ENEMY]!, zone: s.players[HUMAN]!.zone },
        [HUMAN]: {
          ...s.players[HUMAN]!,
          buffs: [
            ...s.players[HUMAN]!.buffs,
            { id: 'taunt', stacks: 1, cyclesRemaining: 1, source: ENEMY },
          ],
        },
      },
    }))
    await game.tick()
    const forced = game.lastEvents.filter(
      (e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === ENEMY,
    )
    expect(forced.length).toBeGreaterThan(0) // the taunt did force the swing
    expect((await game.me()).attackTarget).toEqual(ICE_T1)
    expect((await game.me()).moveTarget).toBe(T1_AUDIT)
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [ENEMY]: { ...s.players[ENEMY]!, zone: 'landing-anchor' } },
    }))
    let hits = 0
    for (let i = 0; i < 5; i++) {
      await game.tick()
      hits += iceHitsBy(game, T1_AUDIT)
    }
    expect(hits).toBeGreaterThan(0)
    expect((await game.me()).attackTarget).toEqual(ICE_T1)
  })

  it('an item active typed mid-walk keeps the walk AND the held ICE order', async () => {
    // Step 1.3: an item active resolves from its own slot and must not cost the
    // walk it was bought for — a typed `use` used to null moveTarget, silently
    // retiring the held ICE attack with it.
    const game = await setup('coldstore-t2-chaff', (s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, items: ['hardshell', null, null, null, null, null] },
      },
    }))
    game.submit({ type: 'attack', target: ICE_T1 })
    await game.tick()
    expect((await game.me()).zone).toBe('coldstore-t1-chaff')
    game.submit({ type: 'use', item: 'hardshell' })
    await game.tick()
    let me = await game.me()
    expect(me.buffs.some((b) => b.id === 'airgap')).toBe(true) // the active fired
    expect(me.zone).toBe('coldstore-cross') // ...and the hop still happened
    expect(me.moveTarget).toBe(T1_AUDIT)
    expect(me.attackTarget).toEqual(ICE_T1)
    await game.tick(2)
    me = await game.me()
    expect(me.zone).toBe(T1_AUDIT)
    expect(iceHitsBy(game, T1_AUDIT)).toBe(1)
  })

  it('a relocating item active (recall) still ends the walk — it is a new positional intent', async () => {
    const game = await setup('coldstore-t2-chaff', (s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, items: ['recall_token', null, null, null, null, null] },
      },
    }))
    game.submit({ type: 'attack', target: ICE_T1 })
    await game.tick()
    game.submit({ type: 'use', item: 'recall_token' })
    await game.tick()
    const me = await game.me()
    expect(me.zone).toBe('coldstore-t1-chaff') // no hop: the channel is not broken
    expect(me.moveTarget ?? null).toBeNull()
    expect(me.buffs.some((b) => b.id === 'tp_channeling')).toBe(true)
    // The held ICE re-swing that follows must not break the channel: home it is.
    await game.tick(3)
    const home = await game.me()
    expect(home.zone).toBe('rookery-anchor')
    expect(home.attackTarget ?? null).toBeNull()
  })

  it('hero targets keep the old rule — no walk toward a hero', async () => {
    const game = await setup('coldstore-cross')
    game.attackHero(ENEMY)
    await game.tick()
    const me = await game.me()
    expect(me.zone).toBe('coldstore-cross')
    expect(me.moveTarget ?? null).toBeNull()
  })
})

describe('attacking the Terminal from outside the enemy base walks there', () => {
  it('refuses a firewalled Terminal at the order — no walk starts', async () => {
    const game = await setup('coldstore-cross')
    game.submit({ type: 'attack', target: { kind: 'terminal' } })
    await game.tick()
    expect(mine(game).map((r) => r.reason)).toEqual([
      'The enemy Terminal is firewalled — destroy a T3 ice first',
    ])
    expect((await game.me()).zone).toBe('coldstore-cross')
  })

  it('walks into the open enemy base and swings at the Terminal', async () => {
    // Every audit ICE on the route down — the walk passes through no fire.
    const game = await setup('coldstore-t3-audit', (s) => ({
      ...s,
      ice: s.ice.map((t) =>
        t.team === 'audit' && t.zone.startsWith('coldstore-')
          ? { ...t, integ: 0, alive: false }
          : t,
      ),
    }))
    game.submit({ type: 'attack', target: { kind: 'terminal' } })
    await game.tick()
    expect(mine(game)).toEqual([])
    expect((await game.me()).zone).toBe('landing-terminal')
    const before = (await game.state()).terminals.audit.integ
    await game.tick()
    expect(mine(game)).toEqual([])
    expect((await game.state()).terminals.audit.integ).toBeLessThan(before)
  })
})

describe('the tutorial gate still applies to an ICE order from range', () => {
  it('step 0 (move only) refuses the attack instead of turning it into a walk', async () => {
    const game = await seedGame('fresh', { mode: 'tutorial', mapId: 'one_lane' })
    const start = (await game.me()).zone
    game.submit({ type: 'attack', target: ICE_T1 })
    await game.tick()
    expect(mine(game)).toHaveLength(1)
    expect((await game.me()).zone).toBe(start)
  })
})

describe('replays of an ICE walk', () => {
  it('reconstruct the same game from the production action log — mid-walk and at the end', async () => {
    const meta: SnapshotMeta = {
      players: [
        { playerId: 'walker', team: 'chaff', heroId: 'echo', mmr: 1000 },
        { playerId: 'rival', team: 'audit', heroId: 'daemon', mmr: 1000 },
      ],
      mode: 'normal',
    }
    const cycles = 12
    const midWalk = 3
    const seed = 777

    resetWaveIdCounter()
    const gameId = `ice_walk_replay_${Date.now()}`
    const sm = createInMemoryStateManager()
    await Effect.runPromise(
      sm.createGame(
        gameId,
        meta.players.map((p) => ({
          id: p.playerId,
          name: p.playerId,
          team: p.team,
          heroId: p.heroId,
        })),
        { mode: meta.mode },
      ),
    )
    await Effect.runPromise(
      sm.updateState(gameId, (s) => ({ ...s, phase: 'playing' as const, rngSeed: seed })),
    )
    let live = await Effect.runPromise(sm.getState(gameId))
    submitReplayAction(gameId, 'walker', { type: 'attack', target: ICE_T1 })
    let liveMid: GameState | null = null
    for (let t = 1; t <= cycles; t++) {
      live = (await Effect.runPromise(processCycle(gameId, live))).state
      if (t === midWalk) liveMid = live
    }
    expect(live.players.walker!.iceDamageDealt).toBeGreaterThan(0)
    // Production re-feeds the WHOLE log — the synthesized walk hops included.
    const log = live.actionLog as LoggedAction[]
    expect(log.some((a) => a.synthesized && a.command.type === 'move')).toBe(true)

    resetWaveIdCounter()
    const mid = (await reconstructReplay(meta, log, seed, midWalk)).finalState
    expect(mid.players.walker!.zone).toBe(liveMid!.players.walker!.zone)
    expect(mid.players.walker!.moveTarget).toEqual(liveMid!.players.walker!.moveTarget)
    expect(mid.players.walker!.attackTarget).toEqual(liveMid!.players.walker!.attackTarget)

    resetWaveIdCounter()
    const { finalState } = await reconstructReplay(meta, log, seed, cycles)
    expect(finalSummaryHash(finalState)).toBe(finalSummaryHash(live))
    expect(finalState.players.walker!.iceDamageDealt).toBe(live.players.walker!.iceDamageDealt)
  })

  /** Play `cycles` live cycles with `order` typed on `orderCycle`; returns the live
   *  state after every cycle and the replay's final state. */
  async function liveAndReplay(opts: {
    heroId: string
    cycles: number
    orderCycle: number
    presenceOffline?: Record<number, string[]>
  }) {
    const meta: SnapshotMeta = {
      players: [
        { playerId: 'walker', team: 'chaff', heroId: opts.heroId, mmr: 1000 },
        { playerId: 'rival', team: 'audit', heroId: 'daemon', mmr: 1000 },
      ],
      mode: 'normal',
      ...(opts.presenceOffline ? { presenceOffline: opts.presenceOffline } : {}),
    }
    const seed = 5
    resetWaveIdCounter()
    const gameId = `ice_walk_parity_${opts.heroId}_${opts.cycles}_${Date.now()}`
    const sm = createInMemoryStateManager()
    await Effect.runPromise(
      sm.createGame(
        gameId,
        meta.players.map((p) => ({
          id: p.playerId,
          name: p.playerId,
          team: p.team,
          heroId: p.heroId,
        })),
        { mode: meta.mode },
      ),
    )
    await Effect.runPromise(
      sm.updateState(gameId, (s) => ({
        ...s,
        phase: 'playing' as const,
        rngSeed: seed,
        ...(opts.presenceOffline ? { presenceOffline: opts.presenceOffline } : {}),
      })),
    )
    let live = await Effect.runPromise(sm.getState(gameId))
    const liveFrames: GameState[] = []
    const liveTakeovers: unknown[] = []
    for (let t = 1; t <= opts.cycles; t++) {
      if (t === opts.orderCycle) {
        submitReplayAction(gameId, 'walker', { type: 'attack', target: ICE_T1 })
      }
      live = (await Effect.runPromise(processCycle(gameId, live))).state
      liveFrames.push(live)
      liveTakeovers.push(...live.events.filter((e) => e.type === 'afk_takeover'))
    }
    const log = live.actionLog as LoggedAction[]
    const replayed: GameState[] = []
    for (const t of [opts.orderCycle + 3, opts.cycles]) {
      resetWaveIdCounter()
      replayed.push((await reconstructReplay(meta, log, seed, t)).finalState)
    }
    return { live, liveFrames, liveTakeovers, replayed, log, meta }
  }

  it('a re-fed walk hop is not activity: lastActionCycle matches live mid-walk and at the end', async () => {
    // Live, a continuation is pushed after the activity stamp; on replay the log
    // re-feeds it through the same loop, and it used to stamp lastActionCycle
    // every hop (live 1, replay 8 over an 8-cycle ICE walk).
    const { liveFrames, replayed, log } = await liveAndReplay({
      heroId: 'echo',
      cycles: 8,
      orderCycle: 1,
    })
    expect(log.some((a) => a.synthesized && a.command.type === 'move')).toBe(true)
    const [mid, end] = replayed
    expect(mid!.players.walker!.lastActionCycle).toBe(
      liveFrames[3]!.players.walker!.lastActionCycle,
    )
    expect(end!.players.walker!.lastActionCycle).toBe(
      liveFrames[7]!.players.walker!.lastActionCycle,
    )
    expect(end!.players.walker!.lastActionCycle).toBe(1)
  })

  it('an ICE order then offline: the AFK takeover happens on replay too, on the same cycle', async () => {
    // Typed at cycle 30, then the player went offline (every presence sample).
    // Live converts them at the cycle-65 confirm; the replay's re-fed walk hops
    // used to keep stamping them "active", so the replay never converted — and
    // the hash (which did not carry aiControlled) still said "verified".
    const offline: Record<number, string[]> = {}
    for (let c = 1; c <= 120; c++) offline[c] = ['walker']
    const { live, liveTakeovers, replayed, log, meta } = await liveAndReplay({
      heroId: 'kernel',
      cycles: 70,
      orderCycle: 30,
      presenceOffline: offline,
    })
    expect(live.players.walker!.aiControlled).toBe(true)
    expect(liveTakeovers).toHaveLength(1)
    const end = replayed[1]!
    expect(end.players.walker!.aiControlled).toBe(true)
    expect(end.players.walker!.lastActionCycle).toBe(live.players.walker!.lastActionCycle)
    expect(finalSummaryHash(end)).toBe(finalSummaryHash(live))
    // The same takeover event, on the same cycle (state.events = last cycle's).
    const at = (liveTakeovers[0] as { cycle: number }).cycle
    resetWaveIdCounter()
    const atTakeover = (await reconstructReplay(meta, log, 5, at)).finalState
    expect(atTakeover.events.filter((e) => e.type === 'afk_takeover')).toEqual(liveTakeovers)
  })
})
