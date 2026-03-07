import type { TeamId } from '~~/shared/types/game'
import type { QueueEntry } from '../matchmaking/queue'
import { HEROES } from '~~/shared/constants/heroes'
import type { HeroRole } from '~~/shared/types/hero'

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
  lastHitAccuracy: number
  reactionDelayTicks: number
  abilityComboChance: number
  runeAwareness: boolean
  jungleFarming: boolean
  threatAssessment: boolean
}

export const BOT_DIFFICULTY_CONFIGS: Record<BotDifficulty, BotDifficultyConfig> = {
  easy: {
    retreatHpPercent: 40,
    lastHitAccuracy: 0.5,
    reactionDelayTicks: 3,
    abilityComboChance: 0.2,
    runeAwareness: false,
    jungleFarming: false,
    threatAssessment: false,
  },
  medium: {
    retreatHpPercent: 30,
    lastHitAccuracy: 0.75,
    reactionDelayTicks: 1,
    abilityComboChance: 0.5,
    runeAwareness: true,
    jungleFarming: true,
    threatAssessment: true,
  },
  hard: {
    retreatHpPercent: 25,
    lastHitAccuracy: 0.9,
    reactionDelayTicks: 0,
    abilityComboChance: 0.8,
    runeAwareness: true,
    jungleFarming: true,
    threatAssessment: true,
  },
  unfair: {
    retreatHpPercent: 20,
    lastHitAccuracy: 0.98,
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

export function registerBots(
  gameId: string,
  players: { playerId: string; team: TeamId; heroId: string | null }[],
  difficulty: BotDifficulty = 'medium',
): void {
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

  assignLanesByRole(radiantBots, laneMap, 'radiant')
  assignLanesByRole(direBots, laneMap, 'dire')

  gameBots.set(gameId, botIds)
  gameBotLanes.set(gameId, laneMap)
  gameBotDifficulties.set(gameId, difficultyMap)
}

function assignLanesByRole(
  bots: { playerId: string; heroId: string | null; role: HeroRole }[],
  laneMap: Map<string, string>,
  team: TeamId,
): void {
  const laneCounts: Record<string, number> = { top: 0, mid: 0, bot: 0, jungle: 0 }
  const maxPerLane = 2

  bots.sort((a, b) => {
    const priorityOrder: HeroRole[] = ['carry', 'mage', 'assassin', 'tank', 'support', 'offlaner']
    return priorityOrder.indexOf(a.role) - priorityOrder.indexOf(b.role)
  })

  for (const bot of bots) {
    const preferredLanes = LANE_PRIORITY_BY_ROLE[bot.role]

    let assignedLane: string | null = null
    for (const lane of preferredLanes) {
      if (laneCounts[lane]! < maxPerLane) {
        assignedLane = lane
        break
      }
    }

    if (!assignedLane) {
      for (const lane of ['top', 'mid', 'bot', 'jungle']) {
        if (laneCounts[lane]! < maxPerLane) {
          assignedLane = lane
          break
        }
      }
    }

    if (!assignedLane) {
      assignedLane = 'mid'
    }

    laneMap.set(bot.playerId, assignedLane)
    laneCounts[assignedLane] = (laneCounts[assignedLane] ?? 0) + 1
  }
}

export function getBotPlayerIds(gameId: string): string[] {
  const bots = gameBots.get(gameId)
  return bots ? [...bots] : []
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
  gameBots.delete(gameId)
  gameBotLanes.delete(gameId)
  gameBotDifficulties.delete(gameId)
}
