import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN, type Run } from './harness'
import type { GameState, WaveUnitState } from '~~/shared/types/game'
import {
  TUTORIAL_FLOW,
  TUTORIAL_STEP_DEADLINE_CYCLES,
  liveIceDrillZone,
  tutorialTryCommand,
} from '~~/shared/constants/tutorial'
import { waveUnitMaxHp } from '~~/shared/constants/balance'

/**
 * Playtest 2 (Oct 2026): the ICE drill was lethal when followed literally. The
 * player walked onto the enemy T1 and stood there reading and typing under four
 * enemy units, the ICE itself and both enemy heroes — died three times, and one
 * run timed out and "graduated" with ICE DAMAGE 0.
 *
 * The drill now (a) holds the enemy crew at their posts for its duration and
 * (b) keeps a friendly wave unit beside the player on the lane, so the ICE and
 * the enemy units shoot the escort, not a level-2 hero. With the hint's own
 * command (`attack ice:…` walks there and swings, see structureApproach.test.ts)
 * a newbie completes it; even a slow reader who walks in first and needs a few
 * cycles to type survives.
 */

const ICE_STEP = TUTORIAL_FLOW.findIndex((s) => s.id === 'ice')
const ICE_ZONE = 'coldstore-t1-audit'
const FOES = ['bot_e0', 'bot_e1'] as const

const enemyUnit = (id: string, zone: string): WaveUnitState => {
  const full = waveUnitMaxHp('line', 0)
  return { id, team: 'audit', zone, integ: full, maxInteg: full, type: 'line' }
}

/** The hot lane the playtester walked into, with the drill just opened. */
async function hotIceDrill(): Promise<Run> {
  const game = await seedGame('fresh', {
    mode: 'tutorial',
    mapId: 'one_lane',
    players: [
      { id: HUMAN, name: HUMAN, team: 'chaff', heroId: 'echo' },
      // Not registered with BotManager: their orders are scripted below, so the
      // test does not ride on bot-AI randomness. The `bot_` prefix still makes
      // them "not the human" to the tutorial.
      { id: 'bot_e0', name: 'bot_e0', team: 'audit', heroId: 'daemon' },
      { id: 'bot_e1', name: 'bot_e1', team: 'audit', heroId: 'kernel' },
    ],
  })
  await game.patch((s: GameState) => ({
    ...s,
    cycle: 60,
    tutorialStep: ICE_STEP,
    tutorialStepSince: 60,
    tutorialSkips: 0,
    players: {
      ...s.players,
      [HUMAN]: { ...s.players[HUMAN]!, zone: 'rookery-terminal', level: 2 },
      bot_e0: { ...s.players.bot_e0!, zone: 'coldstore-cross', level: 3 },
      bot_e1: { ...s.players.bot_e1!, zone: ICE_ZONE, level: 3 },
    },
    waves: [
      enemyUnit('hot-1', ICE_ZONE),
      enemyUnit('hot-2', ICE_ZONE),
      enemyUnit('hot-3', ICE_ZONE),
      enemyUnit('hot-4', ICE_ZONE),
      enemyUnit('hot-5', 'coldstore-cross'),
      enemyUnit('hot-6', 'coldstore-cross'),
    ],
  }))
  return game
}

/** The enemy crew does what bots do when a hero walks into them: hit it. */
async function foesSwing(game: Run): Promise<void> {
  const s = await game.state()
  const me = s.players[HUMAN]!
  for (const id of FOES) {
    const foe = s.players[id]!
    if (foe.alive && me.alive && foe.zone === me.zone) game.attackHero(HUMAN, id)
    else if (foe.alive && me.alive) game.submit({ type: 'move', zone: me.zone }, id)
  }
}

/** Play the drill out; `order(cycleIndex, state)` is the human's input for that cycle. */
async function playDrill(
  game: Run,
  order: (i: number, s: GameState) => void,
): Promise<{ deaths: number; done: boolean; state: GameState; lowest: number }> {
  let deaths = 0
  let lowest = Infinity
  for (let i = 0; i < 40; i++) {
    const before = await game.state()
    if (before.phase === 'ended' || (before.tutorialStep ?? 0) > ICE_STEP) break
    order(i, before)
    await foesSwing(game)
    await game.tick()
    const after = await game.state()
    if (before.players[HUMAN]!.alive && !after.players[HUMAN]!.alive) deaths++
    lowest = Math.min(lowest, after.players[HUMAN]!.integ / after.players[HUMAN]!.maxInteg)
  }
  const state = await game.state()
  return { deaths, done: (state.tutorialStep ?? 0) > ICE_STEP, state, lowest }
}

describe('the tutorial ICE drill is survivable when followed literally', () => {
  it('the hint’s own command, typed once from the shop, completes it without dying', async () => {
    const game = await hotIceDrill()
    const tryCmd = tutorialTryCommand(ICE_STEP)
    expect(tryCmd).toBe(`attack ice:${ICE_ZONE}`)
    const { deaths, done, state } = await playDrill(game, (i) => {
      if (i === 0) game.submit({ type: 'attack', target: { kind: 'ice', zone: ICE_ZONE } })
    })
    expect(done).toBe(true)
    expect(deaths).toBe(0)
    expect(state.tutorialSkips ?? 0).toBe(0)
    expect(state.players[HUMAN]!.iceDamageDealt).toBeGreaterThan(0)
  })

  it('a slow reader who walks in first and types three cycles later still survives', async () => {
    const game = await hotIceDrill()
    let arrived = -1
    const { deaths, done, lowest } = await playDrill(game, (i, s) => {
      const me = s.players[HUMAN]!
      if (i === 0) game.submit({ type: 'move', zone: ICE_ZONE })
      if (me.zone === ICE_ZONE && arrived < 0) arrived = i
      if (arrived >= 0 && i - arrived >= 3) {
        game.submit({ type: 'attack', target: { kind: 'ice', zone: ICE_ZONE } })
      }
    })
    expect(done).toBe(true)
    expect(deaths).toBe(0)
    // Not a near miss: until their own swing draws the ICE, the escort takes the fire.
    expect(lowest).toBeGreaterThan(0.75)
  })

  it('holds the enemy crew and puts an escort beside the player — and says so', async () => {
    const game = await hotIceDrill()
    game.submit({ type: 'move', zone: 'coldstore-t1-chaff' })
    await game.tick(2)
    const s = await game.state()
    for (const id of FOES) {
      expect(s.players[id]!.buffs.some((b) => b.id === 'stun' && b.source === id)).toBe(true)
    }
    const me = s.players[HUMAN]!
    expect(s.waves.some((w) => w.team === 'chaff' && w.zone === me.zone && w.integ > 0)).toBe(true)
    expect(game.allNotices.some((n) => n.playerId === HUMAN && n.message.includes('escort'))).toBe(
      true,
    )
  })

  it('an idle player does not feed a conveyor of escorts into the ICE', async () => {
    // The escort walks the lane like any unit. Planting a fresh one every cycle
    // behind a player who just stands there would march a stream of units into
    // T1 — killing the very ICE the hint names.
    const game = await hotIceDrill()
    // A calm lane: nothing to hold an escort in place, so each one walks on.
    await game.patch((s) => ({
      ...s,
      waves: [],
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, zone: 'coldstore-cross' },
        bot_e0: { ...s.players.bot_e0!, zone: 'landing-anchor' },
        bot_e1: { ...s.players.bot_e1!, zone: 'landing-anchor' },
      },
    }))
    let mostEscorts = 0
    for (let i = 0; i < 40; i++) {
      await game.tick()
      const s = await game.state()
      if ((s.tutorialStep ?? 0) !== ICE_STEP) break
      const escorts = s.waves.filter((w) => w.id.startsWith('wave-escort-') && w.integ > 0)
      mostEscorts = Math.max(mostEscorts, escorts.length)
    }
    const s = await game.state()
    expect(s.ice.find((t) => t.zone === ICE_ZONE)?.alive).toBe(true)
    expect(mostEscorts).toBeLessThanOrEqual(2)
  })

  it('with T1 already razed, every word points at the next ICE — and the drill still completes', async () => {
    // Waves can raze T1 before the drill opens. The chip and the notices used to
    // name the dead T1 forever ("No standing ice…", nothing about the next tier).
    const T2 = 'coldstore-t2-audit'
    const game = await hotIceDrill()
    await game.patch((s) => ({
      ...s,
      ice: s.ice.map((t) => (t.zone === ICE_ZONE ? { ...t, integ: 0, alive: false } : t)),
      waves: [],
      players: {
        ...s.players,
        bot_e0: { ...s.players.bot_e0!, zone: 'landing-anchor' },
        bot_e1: { ...s.players.bot_e1!, zone: 'landing-anchor' },
      },
    }))
    const live = liveIceDrillZone((await game.state()).ice, 'chaff')
    expect(live).toBe(T2)
    const { done, state } = await playDrill(game, (i) => {
      if (i === 0) game.submit({ type: 'attack', target: { kind: 'ice', zone: live } })
    })
    const mine = game.allNotices.filter((n) => n.playerId === HUMAN).map((n) => n.message)
    const escort = mine.find((m) => m.includes('escort'))
    expect(escort).toContain(`attack ice:${T2}`)
    expect(mine.some((m) => m.includes(ICE_ZONE))).toBe(false)
    expect(done).toBe(true)
    expect(state.tutorialSkips ?? 0).toBe(0)
  })

  it('the deadline help names the live ICE too', async () => {
    const T2 = 'coldstore-t2-audit'
    const game = await hotIceDrill()
    await game.patch((s) => ({
      ...s,
      tutorialStepSince: s.cycle + 1 - TUTORIAL_STEP_DEADLINE_CYCLES,
      ice: s.ice.map((t) => (t.zone === ICE_ZONE ? { ...t, integ: 0, alive: false } : t)),
    }))
    await game.tick()
    const help = game.lastNotices.find((n) => n.playerId === HUMAN)?.message ?? ''
    expect(help).toContain(`attack ice:${T2}`)
    expect(help).not.toContain(ICE_ZONE)
  })

  it('the hold and the escort belong to the drill: none of it before the ICE step', async () => {
    const game = await hotIceDrill()
    await game.patch((s) => ({ ...s, tutorialStep: ICE_STEP - 1, tutorialStepSince: s.cycle }))
    game.submit({ type: 'move', zone: 'coldstore-cross' })
    await game.tick(2)
    const s = await game.state()
    expect(s.players.bot_e0!.buffs.some((b) => b.id === 'stun')).toBe(false)
    expect(s.waves.some((w) => w.team === 'chaff' && w.zone === 'coldstore-cross')).toBe(false)
  })
})
