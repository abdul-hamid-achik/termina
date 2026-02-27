import { Effect } from 'effect'
import type { RedisServiceApi } from '../../services/RedisService'
import type { WebSocketServiceApi } from '../../services/WebSocketService'
import type { DatabaseServiceApi } from '../../services/DatabaseService'
import type { TeamId } from '~~/shared/types/game'
import type { QueueEntry } from './queue'

const PICK_TIME_SECONDS = 30
const PICK_TIME_MS = PICK_TIME_SECONDS * 1000

// Available heroes (placeholder list - will be populated by hero definitions)
const AVAILABLE_HEROES = [
  'vex', 'korr', 'lyra', 'thane', 'nyx',
  'zara', 'rook', 'ember', 'shade', 'flux',
  'iris', 'kael', 'mira', 'dusk', 'vale',
]

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
    team: i % 2 === 0 ? 'radiant' : 'dire' as TeamId,
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

  // Notify all players they're in a lobby
  for (const p of players) {
    Effect.runPromise(
      ws.sendToPlayer(p.playerId, {
        type: 'announcement',
        message: `Match found! You are on team ${p.team.toUpperCase()}. Hero pick phase starting...`,
        level: 'info',
      }),
    ).catch(() => {})
  }

  // Start the first pick timer
  startPickTimer(lobby, ws, redis, db)

  return lobby
}

function startPickTimer(
  lobby: Lobby,
  ws: WebSocketServiceApi,
  redis: RedisServiceApi,
  db: DatabaseServiceApi,
): void {
  if (lobby.pickTimer) clearTimeout(lobby.pickTimer)

  lobby.pickTimer = setTimeout(() => {
    // Auto-pick random hero on timeout
    const pickIdx = lobby.pickOrder[lobby.currentPickIndex]
    if (pickIdx === undefined) return
    const player = lobby.players[pickIdx]
    if (!player || player.heroId) return

    const available = AVAILABLE_HEROES.filter((h) => !lobby.pickedHeroes.has(h))
    if (available.length === 0) return

    const randomHero = available[Math.floor(Math.random() * available.length)]!
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

  // Check hero is available
  if (lobby.pickedHeroes.has(heroId)) {
    return { success: false, error: 'Hero already picked' }
  }

  if (!AVAILABLE_HEROES.includes(heroId)) {
    return { success: false, error: 'Invalid hero' }
  }

  confirmPick(lobby, playerId, heroId, ws, redis, db)
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
    Effect.runPromise(
      ws.sendToPlayer(p.playerId, {
        type: 'hero_pick',
        playerId,
        heroId,
      }),
    ).catch(() => {})
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
  db: DatabaseServiceApi,
): void {
  // For now, auto-ready all players and transition to game
  for (const p of lobby.players) {
    p.ready = true
  }

  lobby.phase = 'starting'

  // Notify players game is starting
  for (const p of lobby.players) {
    Effect.runPromise(
      ws.sendToPlayer(p.playerId, {
        type: 'announcement',
        message: 'All heroes picked! Game starting...',
        level: 'info',
      }),
    ).catch(() => {})
  }

  // Transition to game (publish to Redis for game engine to pick up)
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
    redis.publish('matchmaking:game_ready', JSON.stringify(gameData)),
  ).catch((err) => {
    console.error('[Lobby] Failed to publish game_ready:', err)
  })

  // Cleanup
  if (lobby.pickTimer) clearTimeout(lobby.pickTimer)
  activeLobbies.delete(lobby.id)
}

export function getLobby(lobbyId: string): Lobby | undefined {
  return activeLobbies.get(lobbyId)
}

export function cancelLobby(lobbyId: string, ws: WebSocketServiceApi): void {
  const lobby = activeLobbies.get(lobbyId)
  if (!lobby) return

  lobby.phase = 'cancelled'
  if (lobby.pickTimer) clearTimeout(lobby.pickTimer)

  for (const p of lobby.players) {
    Effect.runPromise(
      ws.sendToPlayer(p.playerId, {
        type: 'announcement',
        message: 'Match cancelled. Returning to queue...',
        level: 'warning',
      }),
    ).catch(() => {})
  }

  activeLobbies.delete(lobbyId)
}
