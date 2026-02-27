import type { TeamId } from '~~/shared/types/game'
import type { QueueEntry } from '../matchmaking/queue'

/** Track which players are bots per game. */
const gameBots = new Map<string, Set<string>>()

/** Track lane assignments per game: gameId -> (botId -> lane) */
const gameBotLanes = new Map<string, Map<string, string>>()

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
]

const LANE_ASSIGNMENTS: string[] = ['top', 'top', 'mid', 'bot', 'bot']

/** Create bot queue entries to fill remaining slots. */
export function createBotPlayers(count: number, existingPlayerIds: string[]): QueueEntry[] {
  const bots: QueueEntry[] = []
  let nameIdx = 0
  for (let i = 0; i < count; i++) {
    let botId = BOT_NAMES[nameIdx]!
    // Avoid collisions with existing players
    while (existingPlayerIds.includes(botId) || bots.some((b) => b.playerId === botId)) {
      nameIdx++
      botId = BOT_NAMES[nameIdx] ?? `bot_${nameIdx}`
    }
    bots.push({
      playerId: botId,
      mmr: 1000,
      joinedAt: Date.now(),
      mode: 'ranked_5v5',
    })
    nameIdx++
  }
  return bots
}

/** Check if a player ID belongs to a bot (convention: starts with "bot_"). */
export function isBot(playerId: string): boolean {
  return playerId.startsWith('bot_')
}

/** Register bots for a game and assign lanes. */
export function registerBots(gameId: string, players: { playerId: string; team: TeamId }[]): void {
  const botIds = new Set<string>()
  const laneMap = new Map<string, string>()

  // Group bots by team
  const radiantBots: string[] = []
  const direBots: string[] = []
  for (const p of players) {
    if (isBot(p.playerId)) {
      botIds.add(p.playerId)
      if (p.team === 'radiant') radiantBots.push(p.playerId)
      else direBots.push(p.playerId)
    }
  }

  // Assign lanes: 2 top, 1 mid, 2 bot per team
  for (const bots of [radiantBots, direBots]) {
    for (let i = 0; i < bots.length; i++) {
      laneMap.set(bots[i]!, LANE_ASSIGNMENTS[i % LANE_ASSIGNMENTS.length]!)
    }
  }

  gameBots.set(gameId, botIds)
  gameBotLanes.set(gameId, laneMap)
}

/** Get all bot player IDs for a game. */
export function getBotPlayerIds(gameId: string): string[] {
  const bots = gameBots.get(gameId)
  return bots ? [...bots] : []
}

/** Get a bot's assigned lane. */
export function getBotLane(gameId: string, botId: string): string {
  return gameBotLanes.get(gameId)?.get(botId) ?? 'mid'
}

/** Cleanup bot tracking on game end. */
export function cleanupGame(gameId: string): void {
  gameBots.delete(gameId)
  gameBotLanes.delete(gameId)
}
