import type { TeamId } from '~~/shared/types/game'
import type { QueueEntry } from '~~/server/game/matchmaking/queue'
import { HEROES } from '~~/shared/constants/heroes'
import type { HeroRole } from '~~/shared/types/hero'
// Value import (function, used only at runtime in cleanupGame) — BotAI imports
// getBotDifficultyConfig back from here, but the cycle is benign: neither side
// invokes the other during module evaluation.
import { cleanupBotState } from './BotAI'

const gameBots = new Map<string, Set<string>>()
const gameBotLanes = new Map<string, Map<string, string>>()
const gameBotDifficulties = new Map<string, Map<string, BotDifficulty>>()

const BOT_NAMES = [
  'bot_alpha',
  'bot_beta',
  'bot_gamma',
  'bot_delta',
  'bot_epsilon',
  'bot_zeta',
  'bot_eta',
  'bot_theta',
  'bot_iota',
  'bot_kappa',
  'bot_lambda',
  'bot_mu',
  'bot_nu',
  'bot_xi',
  'bot_omicron',
  'bot_pi',
  'bot_rho',
  'bot_sigma',
  'bot_tau',
  'bot_upsilon',
  'bot_phi',
  'bot_chi',
  'bot_psi',
  'bot_omega',
  'bot_nova',
  'bot_stellar',
  'bot_cosmic',
  'bot_quantum',
  'bot_nebula',
  'bot_photon',
  'bot_neutron',
  'bot_pulsar',
  'bot_quasar',
  'bot_void',
  'bot_cipher',
  'bot_enigma',
  'bot_phantom',
  'bot_shadow',
  'bot_specter',
  'bot_vortex',
  'bot_tempest',
  'bot_storm',
  'bot_blaze',
  'bot_frost',
  'bot_titan',
  'bot_colossus',
  'bot_giant',
  'bot_mammoth',
  'bot_apex',
  'bot_prime',
  'bot_zenith',
  'bot_nadir',
  'bot_vertex',
  'bot_axis',
]

export type BotDifficulty = 'easy' | 'medium' | 'hard' | 'unfair'

export interface BotDifficultyConfig {
  retreatHpPercent: number
  reactionDelayTicks: number
  abilityComboChance: number
  runeAwareness: boolean
  jungleFarming: boolean
  threatAssessment: boolean
}

export const BOT_DIFFICULTY_CONFIGS: Record<BotDifficulty, BotDifficultyConfig> = {
  easy: {
    retreatHpPercent: 40,
    reactionDelayTicks: 3,
    abilityComboChance: 0.2,
    runeAwareness: false,
    jungleFarming: false,
    threatAssessment: false,
  },
  medium: {
    retreatHpPercent: 30,
    reactionDelayTicks: 1,
    abilityComboChance: 0.5,
    runeAwareness: true,
    jungleFarming: true,
    threatAssessment: true,
  },
  hard: {
    retreatHpPercent: 25,
    reactionDelayTicks: 0,
    abilityComboChance: 0.8,
    runeAwareness: true,
    jungleFarming: true,
    threatAssessment: true,
  },
  unfair: {
    retreatHpPercent: 20,
    reactionDelayTicks: 0,
    abilityComboChance: 1.0,
    runeAwareness: true,
    jungleFarming: true,
    threatAssessment: true,
  },
}

const LANE_PRIORITY_BY_ROLE: Record<HeroRole, string[]> = {
  carry: ['bot', 'top', 'mid'],
  support: ['mid', 'bot', 'top'],
  tank: ['top', 'mid', 'bot'],
  assassin: ['mid', 'top', 'bot'],
  mage: ['mid', 'top', 'bot'],
  offlaner: ['top', 'mid', 'bot'],
}

export function createBotPlayers(
  count: number,
  existingPlayerIds: string[],
  averageMmr?: number,
): QueueEntry[] {
  const bots: QueueEntry[] = []
  const botMmr = averageMmr ?? 1000
  for (let i = 0; i < count; i++) {
    let botId: string
    const baseName = BOT_NAMES[i]
    if (
      baseName &&
      !existingPlayerIds.includes(baseName) &&
      !bots.some((b) => b.playerId === baseName)
    ) {
      botId = baseName
    } else {
      botId = `bot_player_${i}_${Date.now()}`
    }
    bots.push({
      playerId: botId,
      username: botId.startsWith('bot_')
        ? botId
            .replace('bot_', '')
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase())
        : botId,
      mmr: botMmr,
      joinedAt: Date.now(),
      mode: 'ranked_5v5',
    })
  }
  return bots
}

export function isBot(playerId: string): boolean {
  return playerId.startsWith('bot_')
}

function getHeroRole(playerId: string, heroId: string | null): HeroRole {
  if (!heroId) return 'offlaner'
  const hero = HEROES[heroId]
  return hero?.role ?? 'offlaner'
}

export interface RegisterBotsOptions {
  difficulty?: BotDifficulty
  /**
   * Pin every bot to this lane instead of role-based assignment. Used on subset
   * maps (e.g. the one-lane tutorial map) where the role lanes (top/bot/jungle)
   * don't exist — bot pathing uses the global zone graph, so an off-map lane
   * target would send a bot stepping into a zone this game doesn't have.
   */
  forceLane?: string
  /**
   * Restrict role-based lane assignment to these lanes. Used on partial maps
   * (e.g. the two-lane 3v3 map, which has top + mid but no bot) so a bot's
   * role-preferred lane is remapped to a lane that actually exists. Ignored
   * when `forceLane` is set (forceLane wins outright).
   */
  availableLanes?: string[]
}

export function registerBots(
  gameId: string,
  players: { playerId: string; team: TeamId; heroId: string | null }[],
  options: BotDifficulty | RegisterBotsOptions = 'medium',
): void {
  // Back-compat: a bare difficulty string is still accepted as the 3rd arg.
  const opts: RegisterBotsOptions = typeof options === 'string' ? { difficulty: options } : options
  const difficulty = opts.difficulty ?? 'medium'

  const botIds = new Set<string>()
  const laneMap = new Map<string, string>()
  const difficultyMap = new Map<string, BotDifficulty>()

  const radiantBots: { playerId: string; heroId: string | null; role: HeroRole }[] = []
  const direBots: { playerId: string; heroId: string | null; role: HeroRole }[] = []

  for (const p of players) {
    if (isBot(p.playerId)) {
      botIds.add(p.playerId)
      const role = getHeroRole(p.playerId, p.heroId)
      const botData = { playerId: p.playerId, heroId: p.heroId, role }
      if (p.team === 'radiant') {
        radiantBots.push(botData)
      } else {
        direBots.push(botData)
      }
      difficultyMap.set(p.playerId, difficulty)
    }
  }

  if (opts.forceLane) {
    for (const id of botIds) laneMap.set(id, opts.forceLane)
  } else {
    assignLanesByRole(radiantBots, laneMap, 'radiant', opts.availableLanes)
    assignLanesByRole(direBots, laneMap, 'dire', opts.availableLanes)
  }

  gameBots.set(gameId, botIds)
  gameBotLanes.set(gameId, laneMap)
  gameBotDifficulties.set(gameId, difficultyMap)
}

function assignLanesByRole(
  bots: { playerId: string; heroId: string | null; role: HeroRole }[],
  laneMap: Map<string, string>,
  _team: TeamId,
  availableLanes?: string[],
): void {
  // Default lane pool; a partial map (e.g. two-lane 3v3) restricts this so a
  // bot is never assigned to a lane that doesn't exist on its map.
  const lanePool = availableLanes ?? ['top', 'mid', 'bot']
  const laneCounts: Record<string, number> = { top: 0, mid: 0, bot: 0, jungle: 0 }
  const maxPerLane = 2

  bots.sort((a, b) => {
    const priorityOrder: HeroRole[] = ['carry', 'mage', 'assassin', 'tank', 'support', 'offlaner']
    return priorityOrder.indexOf(a.role) - priorityOrder.indexOf(b.role)
  })

  for (const bot of bots) {
    const preferredLanes = LANE_PRIORITY_BY_ROLE[bot.role].filter((l) => lanePool.includes(l))

    let assignedLane: string | null = null
    for (const lane of preferredLanes) {
      if (laneCounts[lane]! < maxPerLane) {
        assignedLane = lane
        break
      }
    }

    if (!assignedLane) {
      for (const lane of lanePool) {
        if (laneCounts[lane]! < maxPerLane) {
          assignedLane = lane
          break
        }
      }
    }

    if (!assignedLane) {
      assignedLane = lanePool[0] ?? 'mid'
    }

    laneMap.set(bot.playerId, assignedLane)
    laneCounts[assignedLane] = (laneCounts[assignedLane] ?? 0) + 1
  }
}

export function getBotPlayerIds(gameId: string): string[] {
  const bots = gameBots.get(gameId)
  return bots ? [...bots] : []
}

/** True if `playerId` is in `gameId`'s bot roster — a real bot OR an AFK takeover. */
export function isGameBot(gameId: string, playerId: string): boolean {
  return gameBots.get(gameId)?.has(playerId) ?? false
}

/**
 * Replace a present human player with a bot ("AFK takeover"): add their id to
 * the bot roster (with a lane + difficulty) so the GameLoop's bot driver issues
 * actions for them, keeping their team at full strength.
 *
 * No-reclaim by design — once converted the player stays bot-controlled for the
 * rest of the match even if the human reconnects (the WS action path drops their
 * commands via `isGameBot`). Idempotent: returns `true` only on the call that
 * actually performs the conversion, so callers announce/record the swap once.
 */
export function convertToBot(
  gameId: string,
  playerId: string,
  lane = 'mid',
  difficulty: BotDifficulty = 'medium',
): boolean {
  let bots = gameBots.get(gameId)
  if (!bots) {
    bots = new Set<string>()
    gameBots.set(gameId, bots)
  }
  if (bots.has(playerId)) return false
  bots.add(playerId)

  let laneMap = gameBotLanes.get(gameId)
  if (!laneMap) {
    laneMap = new Map<string, string>()
    gameBotLanes.set(gameId, laneMap)
  }
  laneMap.set(playerId, lane)

  let difficultyMap = gameBotDifficulties.get(gameId)
  if (!difficultyMap) {
    difficultyMap = new Map<string, BotDifficulty>()
    gameBotDifficulties.set(gameId, difficultyMap)
  }
  difficultyMap.set(playerId, difficulty)

  return true
}

export function getBotLane(gameId: string, botId: string): string {
  return gameBotLanes.get(gameId)?.get(botId) ?? 'mid'
}

export function getBotDifficulty(gameId: string, botId: string): BotDifficulty {
  return gameBotDifficulties.get(gameId)?.get(botId) ?? 'medium'
}

export function getBotDifficultyConfig(gameId: string, botId: string): BotDifficultyConfig {
  const difficulty = getBotDifficulty(gameId, botId)
  return BOT_DIFFICULTY_CONFIGS[difficulty]
}

export function setBotDifficulty(gameId: string, botId: string, difficulty: BotDifficulty): void {
  const difficultyMap = gameBotDifficulties.get(gameId)
  if (difficultyMap) {
    difficultyMap.set(botId, difficulty)
  }
}

export function cleanupGame(gameId: string): void {
  // Clear each bot's per-bot combo state (BotAI's comboStates) before dropping
  // the roster. comboStates is keyed by bot id and is only pruned mid-combo, so
  // a bot that ended the game mid-combo would otherwise leak its entry forever.
  for (const botId of gameBots.get(gameId) ?? []) {
    cleanupBotState(botId)
  }
  gameBots.delete(gameId)
  gameBotLanes.delete(gameId)
  gameBotDifficulties.delete(gameId)
}
