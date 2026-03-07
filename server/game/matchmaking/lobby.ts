import { Effect, Duration } from 'effect'
import type { RedisServiceApi } from '../../services/RedisService'
import type { WebSocketServiceApi } from '../../services/WebSocketService'
import type { DatabaseServiceApi } from '../../services/DatabaseService'
import type { TeamId } from '~~/shared/types/game'
import type { QueueEntry } from './queue'
import { HERO_IDS } from '~~/shared/constants/heroes'
import { isBot } from '../ai/BotManager'
import { sendToPeer } from '../../services/PeerRegistry'
import { lobbyLog } from '../../utils/log'

const PICK_TIME_SECONDS = 15
const PICK_TIME_MS = PICK_TIME_SECONDS * 1000
const BOT_PICK_DELAY_MS = 1500

const AVAILABLE_HEROES = [...HERO_IDS]

export interface LobbyPlayer {
  playerId: string
  username: string
  mmr: number
  team: TeamId
  heroId: string | null
  ready: boolean
}

export interface Lobby {
  id: string
  players: LobbyPlayer[]
  pickedHeroes: Set<string>
  bannedHeroes: Set<string> // Track banned heroes
  pickOrder: number[]
  currentPickIndex: number
  pickTimer: ReturnType<typeof setTimeout> | null
  phase: 'banning' | 'picking' | 'ready_check' | 'starting' | 'cancelled'
  currentBanIndex: number // Track ban phase progress
}

const activeLobbies = new Map<string, Lobby>()
const playerToLobby = new Map<string, string>()

export function getPlayerLobby(playerId: string): string | undefined {
  return playerToLobby.get(playerId)
}

function generateId(): string {
  return `lobby_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// Alternating pick order for 10 players (indices 0-9):
// Team 1: indices 0-4 (radiant), Team 2: indices 5-9 (dire)
// Pick order: R1, D1, D2, R2, R3, D3, D4, R4, R5, D5
const PICK_SEQUENCE_10 = [0, 5, 6, 1, 2, 7, 8, 3, 4, 9]

function snakeDraftTeams(sortedByMmr: QueueEntry[]): LobbyPlayer[] {
  const snakeOrder = [0, 1, 1, 0, 0, 1, 1, 0, 0, 1]
  return sortedByMmr.map((entry, i) => ({
    playerId: entry.playerId,
    username: entry.username,
    mmr: entry.mmr,
    team: snakeOrder[i] === 0 ? 'radiant' : ('dire' as TeamId),
    heroId: null,
    ready: false,
  }))
}

export function createLobby(
  queueEntries: QueueEntry[],
  ws: WebSocketServiceApi,
  redis: RedisServiceApi,
  db: DatabaseServiceApi,
): Lobby {
  const lobbyId = generateId()

  const sorted = [...queueEntries].sort((a, b) => b.mmr - a.mmr)
  const players = snakeDraftTeams(sorted)

  const lobby: Lobby = {
    id: lobbyId,
    players,
    pickedHeroes: new Set(),
    bannedHeroes: new Set(),
    pickOrder: PICK_SEQUENCE_10.slice(0, players.length),
    currentPickIndex: 0,
    currentBanIndex: 0, // Radiant bans first (index 0), Dire bans second (index 1)
    pickTimer: null,
    phase: 'banning', // Start with ban phase
  }

  activeLobbies.set(lobbyId, lobby)

  for (const p of players) {
    playerToLobby.set(p.playerId, lobbyId)
  }

  lobbyLog.info('Lobby created', { lobbyId, playerCount: players.length })

  const allPlayers = players.map((p) => ({
    playerId: p.playerId,
    username: p.username,
    team: p.team,
    heroId: p.heroId,
  }))

  for (const p of players) {
    if (isBot(p.playerId)) continue
    sendToPeer(p.playerId, {
      type: 'lobby_state',
      lobbyId,
      team: p.team,
      players: allPlayers,
      phase: 'banning',
      bannedHeroes: [],
      currentBanIndex: 0,
    })
  }

  startBanTimer(lobby, ws, redis, db)

  return lobby
}

function pickRandomHero(lobby: Lobby): string {
  // Prefer unpicked heroes, but allow duplicates if all are taken
  const available = AVAILABLE_HEROES.filter((h) => !lobby.pickedHeroes.has(h))
  const pool = available.length > 0 ? available : AVAILABLE_HEROES
  return pool[Math.floor(Math.random() * pool.length)]!
}

function startPickTimer(
  lobby: Lobby,
  ws: WebSocketServiceApi,
  redis: RedisServiceApi,
  db: DatabaseServiceApi,
): void {
  if (lobby.pickTimer) clearTimeout(lobby.pickTimer)

  // If current picker is a bot, auto-pick after a visible delay
  const pickIdx = lobby.pickOrder[lobby.currentPickIndex]
  if (pickIdx !== undefined) {
    const player = lobby.players[pickIdx]
    if (player && !player.heroId && isBot(player.playerId)) {
      const randomHero = pickRandomHero(lobby)
      lobbyLog.debug('Bot picking hero', {
        lobbyId: lobby.id,
        playerId: player.playerId,
        heroId: randomHero,
      })
      lobby.pickTimer = setTimeout(
        () => confirmPick(lobby, player.playerId, randomHero, ws, redis, db),
        BOT_PICK_DELAY_MS,
      )
      return
    }
  }

  lobby.pickTimer = setTimeout(() => {
    // Auto-pick random hero on timeout
    const pickIdx = lobby.pickOrder[lobby.currentPickIndex]
    if (pickIdx === undefined) return
    const player = lobby.players[pickIdx]
    if (!player || player.heroId) return

    const randomHero = pickRandomHero(lobby)
    confirmPick(lobby, player.playerId, randomHero, ws, redis, db)
  }, PICK_TIME_MS)
}

/** Ban a hero during the ban phase (1 ban per team) */
export function banHero(
  lobbyId: string,
  playerId: string,
  heroId: string,
  ws: WebSocketServiceApi,
  redis: RedisServiceApi,
  db: DatabaseServiceApi,
): { success: boolean; error?: string } {
  const lobby = activeLobbies.get(lobbyId)
  if (!lobby) return { success: false, error: 'Lobby not found' }
  if (lobby.phase !== 'banning') return { success: false, error: 'Not in ban phase' }

  // Check it's this player's turn to ban
  // Ban order: Radiant captain (index 0) bans first, Dire captain (index 5) bans second
  const currentBanPlayerIndex = lobby.currentBanIndex === 0 ? 0 : 5
  const currentBanPlayer = lobby.players[currentBanPlayerIndex]
  
  if (!currentBanPlayer || currentBanPlayer.playerId !== playerId) {
    return { success: false, error: 'Not your turn to ban' }
  }

  if (!AVAILABLE_HEROES.includes(heroId)) {
    return { success: false, error: 'Invalid hero' }
  }

  if (lobby.bannedHeroes.has(heroId)) {
    return { success: false, error: 'Hero already banned' }
  }

  // Confirm ban
  lobby.bannedHeroes.add(heroId)
  lobby.currentBanIndex++

  // Broadcast ban to all players
  for (const p of lobby.players) {
    if (isBot(p.playerId)) continue
    sendToPeer(p.playerId, {
      type: 'hero_ban',
      playerId,
      heroId,
    })
  }

  lobbyLog.debug('Hero banned', { lobbyId, playerId, heroId })

  // Check if both bans are done
  if (lobby.currentBanIndex >= 2) {
    if (lobby.pickTimer) clearTimeout(lobby.pickTimer)
    // Brief delay then transition to pick phase
    setTimeout(() => {
      lobby.phase = 'picking'
      lobby.currentPickIndex = 0
      startPickTimer(lobby, ws, redis, db)
    }, 1000)
    return { success: true }
  }

  // Start timer for next ban (Dire's ban)
  if (lobby.pickTimer) clearTimeout(lobby.pickTimer)
  lobby.pickTimer = setTimeout(() => {
    // Auto-ban random hero on timeout
    const available = AVAILABLE_HEROES.filter((h) => !lobby.bannedHeroes.has(h))
    if (available.length > 0) {
      const randomBan = available[Math.floor(Math.random() * available.length)]!
      banHero(lobbyId, lobby.players[5]!.playerId, randomBan, ws, redis, db)
    }
  }, PICK_TIME_MS)

  return { success: true }
}

/** Start ban timer for current team's captain */
function startBanTimer(
  lobby: Lobby,
  ws: WebSocketServiceApi,
  redis: RedisServiceApi,
  db: DatabaseServiceApi,
): void {
  if (lobby.pickTimer) clearTimeout(lobby.pickTimer)

  // Determine which captain should ban
  const currentBanPlayerIndex = lobby.currentBanIndex === 0 ? 0 : 5
  const currentBanPlayer = lobby.players[currentBanPlayerIndex]
  
  if (!currentBanPlayer) return

  // If captain is a bot, auto-ban after delay
  if (isBot(currentBanPlayer.playerId)) {
    const available = AVAILABLE_HEROES.filter((h) => !lobby.bannedHeroes.has(h))
    const randomBan = available[Math.floor(Math.random() * available.length)]!
    lobby.pickTimer = setTimeout(
      () => banHero(lobby.id, currentBanPlayer.playerId, randomBan, ws, redis, db),
      BOT_PICK_DELAY_MS,
    )
    return
  }

  // Human captain - wait for ban input
  lobby.pickTimer = setTimeout(() => {
    // Auto-ban random hero on timeout
    const available = AVAILABLE_HEROES.filter((h) => !lobby.bannedHeroes.has(h))
    if (available.length > 0 && lobby.currentBanIndex < 2) {
      const randomBan = available[Math.floor(Math.random() * available.length)]!
      const banPlayerIndex = lobby.currentBanIndex === 0 ? 0 : 5
      banHero(lobby.id, lobby.players[banPlayerIndex]!.playerId, randomBan, ws, redis, db)
    }
  }, PICK_TIME_MS)
}

export function pickHero(
  lobbyId: string,
  playerId: string,
  heroId: string,
  ws: WebSocketServiceApi,
  redis: RedisServiceApi,
  db: DatabaseServiceApi,
): { success: boolean; error?: string } {
  const lobby = activeLobbies.get(lobbyId)
  if (!lobby) return { success: false, error: 'Lobby not found' }
  if (lobby.phase !== 'picking') return { success: false, error: 'Not in picking phase' }

  // Check it's this player's turn
  const pickIdx = lobby.pickOrder[lobby.currentPickIndex]
  if (pickIdx === undefined) return { success: false, error: 'Invalid pick index' }
  const currentPicker = lobby.players[pickIdx]
  if (!currentPicker || currentPicker.playerId !== playerId) {
    return { success: false, error: 'Not your turn to pick' }
  }

  if (!AVAILABLE_HEROES.includes(heroId)) {
    return { success: false, error: 'Invalid hero' }
  }

  // Check hero is available (allow duplicates when all unique heroes are exhausted)
  const available = AVAILABLE_HEROES.filter((h) => !lobby.pickedHeroes.has(h))
  if (available.length > 0 && lobby.pickedHeroes.has(heroId)) {
    return { success: false, error: 'Hero already picked' }
  }

  confirmPick(lobby, playerId, heroId, ws, redis, db)
  lobbyLog.debug('Hero picked', { lobbyId, playerId, heroId })
  return { success: true }
}

function confirmPick(
  lobby: Lobby,
  playerId: string,
  heroId: string,
  ws: WebSocketServiceApi,
  redis: RedisServiceApi,
  db: DatabaseServiceApi,
): void {
  const player = lobby.players.find((p) => p.playerId === playerId)
  if (!player) return

  player.heroId = heroId
  lobby.pickedHeroes.add(heroId)

  // Broadcast pick to all players in lobby
  for (const p of lobby.players) {
    if (isBot(p.playerId)) continue
    sendToPeer(p.playerId, {
      type: 'hero_pick',
      playerId,
      heroId,
    })
  }

  lobby.currentPickIndex++

  // Check if all heroes are picked
  if (lobby.currentPickIndex >= lobby.pickOrder.length) {
    if (lobby.pickTimer) clearTimeout(lobby.pickTimer)
    // Brief delay so the UI can display the last hero pick before transitioning
    setTimeout(() => {
      lobby.phase = 'ready_check'
      startReadyCheck(lobby, ws, redis, db)
    }, 1500)
    return
  }

  // Start next pick timer
  startPickTimer(lobby, ws, redis, db)
}

function startReadyCheck(
  lobby: Lobby,
  ws: WebSocketServiceApi,
  redis: RedisServiceApi,
  _db: DatabaseServiceApi,
): void {
  // For now, auto-ready all players and transition to game
  for (const p of lobby.players) {
    p.ready = true
  }

  lobby.phase = 'starting'

  lobbyLog.info('Ready check started', { lobbyId: lobby.id })

  // Send 3-second countdown to all real players
  for (const p of lobby.players) {
    if (isBot(p.playerId)) continue
    sendToPeer(p.playerId, {
      type: 'game_countdown',
      seconds: 3,
    })
  }

  // Transition to game after 3s countdown (publish to Redis for game engine to pick up)
  const gameData = {
    lobbyId: lobby.id,
    players: lobby.players.map((p) => ({
      playerId: p.playerId,
      team: p.team,
      heroId: p.heroId!,
      mmr: p.mmr,
    })),
  }

  Effect.runPromise(
    Effect.sleep(Duration.seconds(3)).pipe(
      Effect.andThen(() => {
        lobbyLog.info('Publishing game_ready', { lobbyId: lobby.id })
        return redis.publish('matchmaking:game_ready', JSON.stringify(gameData))
      }),
      Effect.catchAll((err) => {
        lobbyLog.error('Failed to publish game_ready', { lobbyId: lobby.id, error: String(err) })
        return Effect.void
      }),
    ),
  )

  if (lobby.pickTimer) clearTimeout(lobby.pickTimer)
  // NOTE: Do NOT delete the lobby from activeLobbies/playerToLobby here.
  // The game-server will call cleanupLobby() after the game is created.
  // This prevents a race where the poll returns 'searching' between lobby
  // end and game creation.
}

export function cleanupLobby(lobbyId: string): void {
  const lobby = activeLobbies.get(lobbyId)
  if (!lobby) return
  for (const p of lobby.players) {
    playerToLobby.delete(p.playerId)
  }
  activeLobbies.delete(lobbyId)
  lobbyLog.info('Lobby cleaned up', { lobbyId })
}

export function getLobby(lobbyId: string): Lobby | undefined {
  return activeLobbies.get(lobbyId)
}

export function cancelLobby(lobbyId: string, _ws: WebSocketServiceApi): void {
  const lobby = activeLobbies.get(lobbyId)
  if (!lobby) return

  lobby.phase = 'cancelled'
  if (lobby.pickTimer) {
    clearTimeout(lobby.pickTimer)
    lobby.pickTimer = null
  }

  for (const p of lobby.players) {
    playerToLobby.delete(p.playerId)
    if (isBot(p.playerId)) continue
    sendToPeer(p.playerId, {
      type: 'announcement',
      message: 'Match cancelled. Returning to queue...',
      level: 'warning',
    })
  }

  activeLobbies.delete(lobbyId)
}

export function replacePlayerWithBot(
  lobbyId: string,
  playerId: string,
  botId: string,
): { success: boolean; error?: string } {
  const lobby = activeLobbies.get(lobbyId)
  if (!lobby) return { success: false, error: 'Lobby not found' }

  const player = lobby.players.find((p) => p.playerId === playerId)
  if (!player) return { success: false, error: 'Player not found' }

  player.playerId = botId
  player.username = botId.replace('bot_', 'Bot ').replace(/\b\w/g, (c) => c.toUpperCase())

  for (const p of lobby.players) {
    if (isBot(p.playerId)) continue
    sendToPeer(p.playerId, {
      type: 'announcement',
      message: `${player.username} has been replaced by a bot.`,
      level: 'info',
    })
  }

  lobbyLog.info('Player replaced with bot', { lobbyId, playerId, botId })
  return { success: true }
}
