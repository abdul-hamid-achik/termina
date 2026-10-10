import { describe, it, expect, afterEach } from 'vitest'
import { decideBotAction, cleanupBotState } from '~~/server/game/ai/BotAI'
import { registerBots, cleanupGame } from '~~/server/game/ai/BotManager'
import type { BotDifficulty } from '~~/server/game/ai/BotManager'
import type { GameState, PlayerState } from '~~/shared/types/game'
import { initializeZoneStates, initializeIce } from '~~/server/game/map/zones'
import { initializeTerminals } from '~~/server/game/engine/TerminalSystem'

/**
 * The batch clock resolves MOVEMENT before attacks/casts, so a swing or cast at
 * an enemy hero who is about to retreat lands on an empty room ("Target is not
 * in your zone"). In bot-vs-bot play that was ~half of every rejected action.
 * A bot must read the flight (the retreat rule is a pure function of state) and
 * spend its action somewhere that can land.
 */
const GAME = 'bot-flight-prediction'

function player(overrides: Partial<PlayerState>): PlayerState {
  return {
    id: 'bot_alpha',
    name: 'bot_alpha',
    team: 'chaff',
    heroId: 'echo',
    zone: 'coldstore-cross',
    integ: 500,
    maxInteg: 500,
    bw: 300,
    maxBw: 300,
    level: 6,
    xp: 0,
    scrip: 100,
    items: [null, null, null, null, null, null],
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

function stateWith(players: PlayerState[]): GameState {
  return {
    cycle: 10,
    phase: 'playing',
    teams: {
      chaff: { id: 'chaff', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
      audit: { id: 'audit', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
    },
    players: Object.fromEntries(players.map((p) => [p.id, p])),
    zones: initializeZoneStates(),
    waves: [],
    neutrals: [],
    ice: initializeIce(),
    terminals: initializeTerminals(),
    caches: [],
    tenant: { alive: true, integ: 5000, maxInteg: 5000, deathCycle: null },
    backup: null,
    events: [],
    surrenderVotes: { chaff: new Set(), audit: new Set() },
    timeOfDay: 'day',
    dayNightCycle: 0,
  } as unknown as GameState
}

function register(difficulty: BotDifficulty, foeIsBot: boolean): void {
  registerBots(
    GAME,
    [
      { playerId: 'bot_alpha', team: 'chaff' as const, heroId: 'echo' },
      ...(foeIsBot ? [{ playerId: 'bot_foe', team: 'audit' as const, heroId: 'daemon' }] : []),
    ],
    difficulty,
  )
}

/** Does this command try to land on the enemy hero in this zone? */
function aimsAtHero(cmd: ReturnType<typeof decideBotAction>): boolean {
  if (!cmd) return false
  if (cmd.type === 'attack') return cmd.target.kind === 'hero'
  if (cmd.type === 'cast') return cmd.target?.kind === 'hero'
  if (cmd.type === 'breach') return true
  return false
}

describe('bots do not chase an enemy hero who is about to retreat', () => {
  afterEach(() => {
    cleanupGame(GAME)
    cleanupBotState('bot_alpha')
  })

  it('a hurt enemy BOT (below its retreat floor) is left to go — no attack / cast / breach at it', () => {
    register('medium', true)
    const alpha = player({})
    // 10% INTEG is under every difficulty's retreat floor: the foe walks home.
    const foe = player({ id: 'bot_foe', name: 'bot_foe', team: 'audit', integ: 50 })
    const cmd = decideBotAction(stateWith([alpha, foe]), alpha, 'coldstore', GAME)
    expect(aimsAtHero(cmd), JSON.stringify(cmd)).toBe(false)
  })

  it('still engages a healthy enemy bot (the prediction is not blanket passivity)', () => {
    register('medium', true)
    const alpha = player({})
    const foe = player({ id: 'bot_foe', name: 'bot_foe', team: 'audit', integ: 500 })
    const cmd = decideBotAction(stateWith([alpha, foe]), alpha, 'coldstore', GAME)
    expect(aimsAtHero(cmd), JSON.stringify(cmd)).toBe(true)
  })

  it('still swings at a hurt HUMAN (humans are not predictable; they may stand and fight)', () => {
    register('medium', false)
    const alpha = player({})
    const human = player({ id: 'human_1', name: 'human_1', team: 'audit', integ: 50 })
    const cmd = decideBotAction(stateWith([alpha, human]), alpha, 'coldstore', GAME)
    expect(aimsAtHero(cmd), JSON.stringify(cmd)).toBe(true)
  })

  for (const held of ['root', 'stun', 'taunt', 'cyclone', 'hex']) {
    it(`a hurt enemy bot that is ${held === 'stun' ? 'stunned' : held}-held cannot flee — engage it`, () => {
      register('medium', true)
      const alpha = player({})
      const foe = player({
        id: 'bot_foe',
        name: 'bot_foe',
        team: 'audit',
        integ: 50,
        buffs: [{ id: held, stacks: 1, cyclesRemaining: 2, source: 'bot_alpha' }],
      })
      const cmd = decideBotAction(stateWith([alpha, foe]), alpha, 'coldstore', GAME)
      expect(aimsAtHero(cmd), JSON.stringify(cmd)).toBe(true)
    })
  }

  it('a rooted enemy bot under Hardshell can still walk — still predicted to flee', () => {
    register('medium', true)
    const alpha = player({})
    const foe = player({
      id: 'bot_foe',
      name: 'bot_foe',
      team: 'audit',
      integ: 50,
      buffs: [
        { id: 'root', stacks: 1, cyclesRemaining: 2, source: 'bot_alpha' },
        { id: 'airgap', stacks: 1, cyclesRemaining: 2, source: 'bot_foe' },
      ],
    })
    const cmd = decideBotAction(stateWith([alpha, foe]), alpha, 'coldstore', GAME)
    expect(aimsAtHero(cmd), JSON.stringify(cmd)).toBe(false)
  })

  it('a hurt enemy bot standing in its own base is not predicted to flee (it shops / stays)', () => {
    register('medium', true)
    const alpha = player({ zone: 'landing-terminal' })
    const foe = player({
      id: 'bot_foe',
      name: 'bot_foe',
      team: 'audit',
      zone: 'landing-terminal',
      integ: 50,
    })
    const cmd = decideBotAction(stateWith([alpha, foe]), alpha, 'coldstore', GAME)
    expect(aimsAtHero(cmd), JSON.stringify(cmd)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// CLOSED targets: a medium+ bot must never open with hard control it knows will
// be refused ("<target> is CLOSED — breach <target> first").
// ---------------------------------------------------------------------------
import { HEROES, HERO_IDS } from '~~/shared/constants/heroes'
import { isHardControlBuffId } from '~~/server/game/heroes/_base'

const hasHardControl = (heroId: string, slot: 'q' | 'w' | 'e' | 'r'): boolean =>
  HEROES[heroId]!.abilities[slot].effects.some((e) =>
    isHardControlBuffId(e.type === 'fear' ? 'feared' : e.type),
  )

describe('bots never cast hard control into a CLOSED enemy hero', () => {
  afterEach(() => {
    cleanupGame(GAME)
    cleanupBotState('bot_alpha')
  })

  const scenarios: Array<{ label: string; bw: number; breachCd: boolean }> = [
    { label: 'plenty of BW', bw: 400, breachCd: false },
    { label: 'too little BW to breach', bw: 40, breachCd: false },
    { label: 'breach on cooldown', bw: 400, breachCd: true },
  ]

  for (const sc of scenarios) {
    it(`every hero, ${sc.label}`, () => {
      const offenders: string[] = []
      for (const heroId of HERO_IDS) {
        // `unfair`: combo chance 1.0 + threat assessment, so the opener is certain.
        registerBots(
          GAME,
          [{ playerId: 'bot_alpha', team: 'chaff' as const, heroId }],
          'unfair' as BotDifficulty,
        )
        cleanupBotState('bot_alpha')
        const alpha = player({
          heroId,
          bw: sc.bw,
          maxBw: 400,
          buffs: sc.breachCd
            ? [{ id: 'item_cd_breach', stacks: 1, cyclesRemaining: 5, source: 'bot_alpha' }]
            : [],
        })
        const foe = player({ id: 'human_foe', name: 'human_foe', team: 'audit', heroId: 'echo' })
        const cmd = decideBotAction(stateWith([alpha, foe]), alpha, 'coldstore', GAME)
        if (
          cmd?.type === 'cast' &&
          cmd.target?.kind === 'hero' &&
          hasHardControl(heroId, cmd.ability)
        ) {
          offenders.push(`${heroId}.${cmd.ability}`)
        }
        cleanupGame(GAME)
      }
      expect(offenders).toEqual([])
    })
  }
})

describe('a dead bot does not issue orders the engine must refuse', () => {
  afterEach(() => {
    cleanupGame(GAME)
    cleanupBotState('bot_alpha')
  })

  it('on the cycle its respawn lands it sends nothing (it re-enters AT its fountain, and a dead player cannot act)', () => {
    register('medium', false)
    const state0 = stateWith([])
    const dead = player({
      alive: false,
      integ: 0,
      zone: 'coldstore-cross',
      respawnCycle: state0.cycle,
      scrip: 0,
    })
    const cmd = decideBotAction(stateWith([dead]), dead, 'coldstore', GAME)
    expect(cmd).toBeNull()
  })
})
