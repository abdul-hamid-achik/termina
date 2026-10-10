import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { BuffState, GameState, PlayerState } from '~~/shared/types/game'
import type { Command } from '~~/shared/types/commands'
import { seedGame, type Run } from './harness'
import { resetWaveIdCounter } from '~~/server/game/map/spawner'
import { decideBotAction } from '~~/server/game/ai/BotAI'
import { registerBots, cleanupGame, getBotLane } from '~~/server/game/ai/BotManager'
import { validateAction } from '~~/server/game/engine/ActionResolver'
import { HARDEN_COOLDOWN_CYCLES } from '~~/shared/constants/balance'

/**
 * Bots must respect their OWN disables: a stunned / rooted / taunted /
 * silenced / feared / cycloned / hexed bot never issues an order the engine is
 * certain to refuse (validateAction is the oracle — the bot asks the same
 * single-source gate, disableBlockReason). A taunted bot swings at its taunter.
 * And harden is issued by exactly one bot per team per cycle.
 *
 * Every scenario runs at cycle 389, level 11, after one settling tick.
 */

const BOT = 'bot_a'
const FOE = 'bot_z'
const games: string[] = []

beforeEach(() => resetWaveIdCounter())
afterEach(() => {
  for (const g of games.splice(0)) cleanupGame(g)
})

const buff = (id: string, source = FOE, cyclesRemaining = 2): BuffState => ({
  id,
  stacks: 1,
  cyclesRemaining,
  source,
})

async function arena(
  opts: {
    botBuffs?: BuffState[]
    botIntegFrac?: number
    foe?: boolean
    hero?: 'kernel' | 'lambda' | 'echo'
  } = {},
): Promise<Run> {
  const foe = opts.foe ?? true
  const game = await seedGame('laning_combat', {
    players: [
      { id: BOT, name: BOT, team: 'chaff', heroId: opts.hero ?? 'lambda' },
      { id: FOE, name: FOE, team: 'audit', heroId: 'echo' },
    ],
  })
  registerBots(game.gameId, [
    { playerId: BOT, team: 'chaff', heroId: opts.hero ?? 'lambda' },
    { playerId: FOE, team: 'audit', heroId: 'echo' },
  ])
  games.push(game.gameId)
  await game.patch((s) => {
    const zone = 'coldstore-cross'
    const players: GameState['players'] = {}
    for (const [id, p] of Object.entries(s.players)) {
      const self = id === BOT
      players[id] = {
        ...p,
        zone: !foe && !self ? 'landing-anchor' : zone,
        level: 11,
        integ: self ? Math.round(p.maxInteg * (opts.botIntegFrac ?? 1)) : p.maxInteg,
        bw: p.maxBw,
        cooldowns: { q: 0, w: 0, e: 0, r: 0 },
        buffs: self ? (opts.botBuffs ?? []) : [],
        items: [null, null, null, null, null, null],
      } as PlayerState
    }
    return { ...s, cycle: 389, rngSeed: 31337, players }
  })
  return game
}

async function decide(game: Run): Promise<{ state: GameState; cmd: Command | null }> {
  const state = await game.state()
  const bot = state.players[BOT]!
  return { state, cmd: decideBotAction(state, bot, getBotLane(game.gameId, BOT), game.gameId) }
}

const DISABLES: Array<[string, BuffState[]]> = [
  ['stunned', [buff('stun')]],
  ['rooted', [buff('root')]],
  ['silenced', [buff('silence')]],
  ['feared', [buff('feared')]],
  ['taunted', [buff('taunt')]],
  ['cycloned', [buff('cyclone')]],
  ['hexed', [buff('hex'), buff('silence')]],
  ['rooted + silenced', [buff('root'), buff('silence')]],
]

describe('a disabled bot never issues an order its own disables refuse', () => {
  for (const [label, buffs] of DISABLES) {
    for (const scenario of ['enemy in zone', 'hurt and retreating', 'no enemy here'] as const) {
      it(`${label} — ${scenario}`, async () => {
        const game = await arena({
          botBuffs: buffs,
          botIntegFrac: scenario === 'hurt and retreating' ? 0.12 : 1,
          foe: scenario !== 'no enemy here',
        })
        const { state, cmd } = await decide(game)
        if (cmd) expect(validateAction(state, { playerId: BOT, command: cmd })).toBeNull()
      })
    }
  }

  it('cycloned / hexed: issues nothing at all', async () => {
    for (const buffs of [[buff('cyclone')], [buff('hex'), buff('silence')]]) {
      const game = await arena({ botBuffs: buffs })
      expect((await decide(game)).cmd).toBeNull()
    }
  })

  it('taunted by an enemy in the zone: swings at the taunter', async () => {
    const game = await arena({ botBuffs: [buff('taunt', FOE, 3)] })
    expect((await decide(game)).cmd).toEqual({
      type: 'attack',
      target: { kind: 'hero', name: FOE },
    })
  })

  it('taunted: swings at the TAUNTER, not the weakest enemy in the zone', async () => {
    const game = await arena({ botBuffs: [buff('taunt', FOE, 3)] })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        bot_y: { ...s.players[FOE]!, id: 'bot_y', name: 'bot_y', integ: 40 },
      },
    }))
    expect((await decide(game)).cmd).toEqual({
      type: 'attack',
      target: { kind: 'hero', name: FOE },
    })
  })

  it('silenced with an enemy in the zone: swings instead of casting', async () => {
    const game = await arena({ botBuffs: [buff('silence')] })
    const { cmd } = await decide(game)
    expect(cmd?.type).toBe('attack')
  })

  it('AIRGAP acts through a stun: the bot still fights (no over-blocking)', async () => {
    const game = await arena({ botBuffs: [buff('stun'), buff('airgap', BOT, 3)] })
    const { state, cmd } = await decide(game)
    expect(cmd).not.toBeNull()
    expect(['attack', 'cast', 'breach', 'use']).toContain(cmd!.type)
    expect(validateAction(state, { playerId: BOT, command: cmd! })).toBeNull()
  })

  it('end to end: a held bot draws no disable rejection over a cycle', async () => {
    for (const [, buffs] of DISABLES) {
      const game = await arena({ botBuffs: buffs.map((b) => ({ ...b, cyclesRemaining: 3 })) })
      await game.tick()
      const mine = game.lastRejected.filter((r) => r.playerId === BOT)
      expect(mine.filter((r) => /^Cannot (move|attack|cast|breach|act)/.test(r.reason))).toEqual([])
    }
  })
})

/** Three bots per team around a chaff ICE about to fall, an audit hero on it. */
async function siege(opts: { cooldownUsedAt?: number | null; busyLowest?: boolean } = {}) {
  const roster = [
    { id: 'bot_c3', team: 'chaff' as const, heroId: 'kernel' as const },
    { id: 'bot_c1', team: 'chaff' as const, heroId: 'lambda' as const },
    { id: 'bot_c2', team: 'chaff' as const, heroId: 'echo' as const },
    { id: 'bot_x1', team: 'audit' as const, heroId: 'ping' as const },
  ]
  const game = await seedGame('laning_combat', {
    players: roster.map((r) => ({ id: r.id, name: r.id, team: r.team, heroId: r.heroId })),
  })
  registerBots(
    game.gameId,
    roster.map((r) => ({ playerId: r.id, team: r.team, heroId: r.heroId })),
  )
  games.push(game.gameId)
  await game.patch((s) => {
    const ice = s.ice.find((t) => t.team === 'chaff' && t.alive)!
    const players: GameState['players'] = {}
    for (const [id, p] of Object.entries(s.players)) {
      // The lowest id stands in a fight (an enemy hero in its zone) when asked.
      const zone =
        id === 'bot_x1'
          ? ice.zone
          : id === 'bot_c1' && opts.busyLowest
            ? 'coldstore-cross'
            : 'landing-anchor'
      players[id] = { ...p, zone, level: 7, integ: p.maxInteg, bw: p.maxBw } as PlayerState
    }
    if (opts.busyLowest) {
      players.bot_x2 = { ...players.bot_x1!, id: 'bot_x2', name: 'bot_x2', zone: 'coldstore-cross' }
    }
    return {
      ...s,
      cycle: 523,
      players,
      ice: s.ice.map((t) =>
        t.zone === ice.zone ? { ...t, integ: Math.floor(t.maxInteg * 0.1) } : t,
      ),
      teams: {
        ...s.teams,
        chaff: { ...s.teams.chaff, hardenUsedCycle: opts.cooldownUsedAt ?? null },
      },
    }
  })
  return game
}

const hardensBy = async (game: Run) => {
  const state = await game.state()
  return ['bot_c1', 'bot_c2', 'bot_c3'].filter(
    (id) =>
      decideBotAction(state, state.players[id]!, getBotLane(game.gameId, id), game.gameId)?.type ===
      'harden',
  )
}

describe('harden: one bot per team per cycle', () => {
  it('only the lowest-id bot on the team issues harden', async () => {
    const game = await siege()
    expect(await hardensBy(game)).toEqual(['bot_c1'])
  })

  it('the designated hardener asks even mid-fight (harden is team-wide)', async () => {
    const game = await siege({ busyLowest: true })
    expect(await hardensBy(game)).toEqual(['bot_c1'])
  })

  it('a cycloned lowest-id bot hands harden to the next id', async () => {
    const game = await siege()
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        bot_c1: { ...s.players.bot_c1!, buffs: [buff('cyclone', 'bot_x1')] },
      },
    }))
    expect(await hardensBy(game)).toEqual(['bot_c2'])
  })

  it('a taunt-forced lowest-id bot (its order is overridden) hands harden on', async () => {
    const game = await siege()
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        bot_c1: {
          ...s.players.bot_c1!,
          zone: s.players.bot_x1!.zone,
          buffs: [buff('taunt', 'bot_x1', 3)],
        },
      },
    }))
    expect(await hardensBy(game)).toEqual(['bot_c2'])
  })

  it('never while harden is on cooldown', async () => {
    const game = await siege({ cooldownUsedAt: 523 - HARDEN_COOLDOWN_CYCLES + 5 })
    expect(await hardensBy(game)).toEqual([])
  })

  it('end to end: the cycle resolves one harden and rejects none', async () => {
    const game = await siege()
    await game.tick()
    expect(game.lastRejected.filter((r) => /Harden/i.test(r.reason))).toEqual([])
    expect((await game.state()).teams.chaff.hardenUsedCycle).not.toBeNull()
  })
})
