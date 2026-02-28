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
  mmr: number
  team: TeamId
  heroId: string | null
  ready: boolean
}

export interface Lobby {
  id: string
  players: LobbyPlayer[]
  pickedHeroes: Set<string>
  pickOrder: number[]
  currentPickIndex: number
  pickTimer: ReturnType<typeof setTimeout> | null
  phase: 'picking' | 'ready_check' | 'starting' | 'cancelled'
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

export function createLobby(
  queueEntries: QueueEntry[],
  ws: WebSocketServiceApi,
  redis: RedisServiceApi,
  db: DatabaseServiceApi,
): Lobby {
  const lobbyId = generateId()

  // Assign teams: sort by MMR and alternate to balance
  const sorted = [...queueEntries].sort((a, b) => b.mmr - a.mmr)
  const players: LobbyPlayer[] = sorted.map((entry, i) => ({
    playerId: entry.playerId,
    mmr: entry.mmr,
    team: i % 2 === 0 ? 'radiant' : ('dire' as TeamId),
    heroId: null,
    ready: false,
  }))

  const lobby: Lobby = {
    id: lobbyId,
    players,
    pickedHeroes: new Set(),
    pickOrder: PICK_SEQUENCE_10.slice(0, players.length),
    currentPickIndex: 0,
    pickTimer: null,
    phase: 'picking',
  }

  activeLobbies.set(lobbyId, lobby)

  // Track player → lobby mapping
  for (const p of players) {
    playerToLobby.set(p.playerId, lobbyId)
  }

  lobbyLog.info('Lobby created', { lobbyId, playerCount: players.length })

  // Send lobby_state to each player with their team and the full roster
  const allPlayers = players.map((p) => ({
    playerId: p.playerId,
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
    })
  }

  // Start the first pick timer
  startPickTimer(lobby, ws, redis, db)

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
      lobbyLog.debug('Bot picking hero', { lobbyId: lobby.id, playerId: player.playerId, heroId: randomHero })
      setTimeout(() => confirmPick(lobby, player.playerId, randomHero, ws, redis, db), BOT_PICK_DELAY_MS)
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
    lobby.phase = 'ready_check'
    startReadyCheck(lobby, ws, redis, db)
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
  if (lobby.pickTimer) clearTimeout(lobby.pickTimer)

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
