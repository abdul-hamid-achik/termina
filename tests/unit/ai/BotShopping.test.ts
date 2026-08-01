import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { decideBotAction, counterBuyFor } from '~~/server/game/ai/BotAI'
import { registerBots, cleanupGame } from '~~/server/game/ai/BotManager'
import type { GameState, PlayerState } from '~~/shared/types/game'
import { initializeZoneStates, initializeIce } from '~~/server/game/map/zones'
import { resetWaveIdCounter, initializeTenant } from '~~/server/game/map/spawner'
import { initializeTerminals } from '~~/server/game/engine/TerminalSystem'
import { getItem } from '~~/shared/constants/items'
import { recommendedItemsForRole } from '~~/shared/constants/itemBuilds'
import { HEROES } from '~~/shared/constants/heroes'

/** BotAI's own `itemCost` is private; this is the same lookup. */
const itemCost = (id: string) => getItem(id)?.cost ?? 0

/**
 * Bots spending the scrip they earn.
 *
 * Before this, `tryBuyItem` ran only when the bot stood in its ANCHOR, and a
 * bot only reached its anchor by dying — so income just accumulated. A probe
 * over six full bot matches had them ending on ~830 unspent scrip apiece with
 * two or three items. Nothing failed: a bot that never shops and a bot with
 * nothing it can afford emit exactly the same commands, which is why the whole
 * gap sat there behind a green suite.
 *
 * So the assertions here are mostly DIFFERENTIAL — the same bot in the same
 * position, changed only by its scrip or its deaths, must decide differently.
 * An absolute assertion ("it moves toward home") proves nothing, because a bot
 * moves toward home when it is retreating too.
 */

const GAME_ID = 'bot-shopping-test'
const CHAFF_ANCHOR = 'rookery-anchor'

function makeBot(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'bot_alpha',
    name: 'bot_alpha',
    team: 'chaff',
    heroId: 'echo',
    zone: 'coldstore-t1-chaff',
    integ: 900,
    maxInteg: 900,
    bw: 400,
    maxBw: 400,
    level: 8,
    xp: 0,
    scrip: 0,
    items: [],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnCycle: null,
    plate: 3,
    ice: 15,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    iceDamageDealt: 0,
    killStreak: 0,
    buybackCost: 0,
    talents: { tier10: null, tier15: null, tier20: null, tier25: null },
    ...overrides,
  }
}

function makeState(
  players: Record<string, PlayerState>,
  overrides: Partial<GameState> = {},
): GameState {
  return {
    cycle: 40,
    phase: 'playing',
    teams: {
      chaff: { id: 'chaff', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
      audit: { id: 'audit', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
    },
    players,
    zones: initializeZoneStates(),
    waves: [],
    neutrals: [],
    ice: initializeIce(),
    terminals: initializeTerminals(),
    caches: [],
    tenant: initializeTenant(),
    backup: null,
    events: [],
    surrenderVotes: { chaff: new Set(), audit: new Set() },
    timeOfDay: 'day',
    dayNightCycle: 0,
    ...overrides,
  }
}

/**
 * The first item on a hero's build worth walking home for, and the one before
 * it. Read off the real build order rather than hard-coded, so a repricing
 * moves the test with it instead of silently making it vacuous.
 */
function buildMilestones(heroId: string) {
  const build = recommendedItemsForRole(HEROES[heroId]?.role)
  const worthTheTrip = build.find((id) => itemCost(id) >= 1000)!
  const trinket = build.find((id) => itemCost(id) < 1000)!
  return { worthTheTrip, trinket }
}

describe('bots shop where the engine lets them', () => {
  let prevNodeEnv: string | undefined

  beforeEach(() => {
    resetWaveIdCounter()
    prevNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    registerBots(GAME_ID, [{ playerId: 'bot_alpha', team: 'chaff', heroId: 'echo' }])
  })
  afterEach(() => {
    cleanupGame(GAME_ID)
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prevNodeEnv
  })

  it('buys in its BASE, not only its anchor', () => {
    // `landing-terminal`/`rookery-terminal` carry shop:true — the engine has
    // always allowed it. The bot walks through here on the way out of every
    // respawn, so gating on the anchor threw away a free stop each trip.
    const bot = makeBot({ zone: 'rookery-terminal', scrip: 5000 })
    const cmd = decideBotAction(makeState({ bot_alpha: bot }), bot, 'coldstore', GAME_ID)
    expect(cmd?.type, 'a bot standing in its own shop did not shop').toBe('buy')
  })

  it('does not stall in the base once it has nothing left to buy', () => {
    // The anchor is the only zone worth standing still in (it regenerates).
    // A bot that idled in the base would be giving away cycles for nothing.
    const bot = makeBot({ zone: 'rookery-terminal', scrip: 0, items: [] })
    const cmd = decideBotAction(makeState({ bot_alpha: bot }), bot, 'coldstore', GAME_ID)
    expect(cmd, 'a broke bot idled in its base instead of heading out').not.toBeNull()
    expect(cmd?.type).not.toBe('buy')
  })

  it('heads home to spend once it can afford a real core item', () => {
    // The differential: identical bot, identical zone, only the scrip differs.
    // Rich, it walks toward the shop; poor, it does something else entirely.
    const zone = 'coldstore-t1-chaff'
    const { worthTheTrip, trinket } = buildMilestones('echo')
    const cost = itemCost(worthTheTrip)

    // Already carrying the cheap starters, so the next thing on the list is
    // the core — otherwise the bot is saving for a trinket and stays out.
    const items = [trinket]
    const poor = makeBot({ zone, items, scrip: cost - 1 })
    const rich = makeBot({ zone, items, scrip: cost })

    const poorCmd = decideBotAction(makeState({ bot_alpha: poor }), poor, 'coldstore', GAME_ID)
    const richCmd = decideBotAction(makeState({ bot_alpha: rich }), rich, 'coldstore', GAME_ID)

    expect(richCmd?.type, 'a bot that could afford its core item did not go buy it').toBe('move')
    expect(
      JSON.stringify(richCmd),
      'scrip made no difference — the shopping trip never fired',
    ).not.toBe(JSON.stringify(poorCmd))
  })

  it('does not walk home for a trinket it can pick up on the way past', () => {
    // A round trip is ~10 cycles of no farm, no XP and no lane presence. For a
    // 430sc starter that is a losing trade, and a bot that took it would spend
    // the early game commuting.
    const zone = 'coldstore-t1-chaff'
    const { trinket } = buildMilestones('echo')
    const bot = makeBot({ zone, scrip: itemCost(trinket) })
    const cmd = decideBotAction(makeState({ bot_alpha: bot }), bot, 'coldstore', GAME_ID)
    expect(cmd?.type, 'the bot commuted home for a starter item').not.toBe('move')
  })

  it('does not walk out of a fight to go shopping', () => {
    const zone = 'coldstore-t1-chaff'
    const bot = makeBot({ zone, scrip: 9999 })
    const enemy = makeBot({ id: 'enemy', name: 'enemy', team: 'audit', heroId: 'mutex', zone })
    const cmd = decideBotAction(makeState({ bot_alpha: bot, enemy }), bot, 'coldstore', GAME_ID)
    expect(cmd?.type, 'the bot left an enemy hero standing to go shopping').not.toBe('move')
  })

  it('already in a shop zone, it buys rather than starting a trip', () => {
    const bot = makeBot({ zone: CHAFF_ANCHOR, scrip: 9999 })
    const cmd = decideBotAction(makeState({ bot_alpha: bot }), bot, 'coldstore', GAME_ID)
    expect(cmd?.type).toBe('buy')
  })
})

describe('counterBuyFor', () => {
  const CODE_HEAVY = ['lambda', 'regex', 'ping', 'null_ref', 'proxy']
  const KINETIC_HEAVY = ['echo', 'malloc', 'mutex', 'cron', 'kernel']

  function enemyTeam(heroIds: string[]): Record<string, PlayerState> {
    return Object.fromEntries(
      heroIds.map((heroId, i) => [
        `e${i}`,
        makeBot({ id: `e${i}`, name: `e${i}`, team: 'audit', heroId, zone: 'landing-anchor' }),
      ]),
    )
  }

  it('buys ice against a code-heavy enemy once it is actually dying to them', () => {
    const bot = makeBot({ deaths: 3, scrip: 9999 })
    const state = makeState({ bot_alpha: bot, ...enemyTeam(CODE_HEAVY) })
    expect(counterBuyFor(bot, state)).toBe('discord_routine')
  })

  it('buys plate against a kinetic-heavy enemy', () => {
    const bot = makeBot({ deaths: 3, scrip: 9999 })
    const state = makeState({ bot_alpha: bot, ...enemyTeam(KINETIC_HEAVY) })
    expect(counterBuyFor(bot, state)).toBe('bulwark_plate')
  })

  it('does NOT itemise against a draft it is beating', () => {
    // Deaths are the whole trigger. A bot that is winning should keep its
    // greedy build — buying mitigation it does not need is a slower build for
    // no benefit, which is worse than not reacting at all.
    const bot = makeBot({ deaths: 2, scrip: 9999 })
    const state = makeState({ bot_alpha: bot, ...enemyTeam(CODE_HEAVY) })
    expect(counterBuyFor(bot, state)).toBeNull()
  })

  it('does NOT itemise against a balanced draft', () => {
    const mixed = ['echo', 'lambda', 'malloc', 'regex', 'cache']
    const bot = makeBot({ deaths: 9, scrip: 9999 })
    const state = makeState({ bot_alpha: bot, ...enemyTeam(mixed) })
    expect(
      counterBuyFor(bot, state),
      'bought mitigation against a draft that deals both kinds evenly',
    ).toBeNull()
  })

  it('buys at most one counter item', () => {
    const bot = makeBot({ deaths: 9, scrip: 9999, items: ['discord_routine'] })
    const state = makeState({ bot_alpha: bot, ...enemyTeam(CODE_HEAVY) })
    expect(counterBuyFor(bot, state), 'a bot that keeps dying stopped building a hero').toBeNull()
  })

  it('does not pretend to buy what it cannot afford', () => {
    const bot = makeBot({ deaths: 9, scrip: itemCost('discord_routine') - 1 })
    const state = makeState({ bot_alpha: bot, ...enemyTeam(CODE_HEAVY) })
    expect(counterBuyFor(bot, state)).toBeNull()
  })

  it('reads the ENEMY team, not the whole lobby', () => {
    // Allies are code-heavy, enemies are kinetic-heavy. A version that mixed
    // both teams together would read this as balanced and buy nothing.
    const bot = makeBot({ deaths: 3, scrip: 9999 })
    const allies = Object.fromEntries(
      CODE_HEAVY.map((heroId, i) => [
        `a${i}`,
        makeBot({ id: `a${i}`, name: `a${i}`, team: 'chaff', heroId }),
      ]),
    )
    const state = makeState({ bot_alpha: bot, ...allies, ...enemyTeam(KINETIC_HEAVY) })
    expect(counterBuyFor(bot, state)).toBe('bulwark_plate')
  })
})
