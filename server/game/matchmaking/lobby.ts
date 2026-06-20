import { Effect, Duration } from 'effect'
import type { RedisServiceApi } from '~~/server/services/RedisService'
import type { WebSocketServiceApi } from '~~/server/services/WebSocketService'
import type { DatabaseServiceApi } from '~~/server/services/DatabaseService'
import type { TeamId } from '~~/shared/types/game'
import type { QueueEntry } from './queue'
import { HERO_IDS } from '~~/shared/constants/heroes'
import { isBot } from '~~/server/game/ai/BotManager'
import { sendToPeer } from '~~/server/services/PeerRegistry'
import { lobbyLog } from '~~/server/utils/log'

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
  pickOrder: number[]
  currentPickIndex: number
  pickTimer: ReturnType<typeof setTimeout> | null
  phase: 'picking' | 'ready_check' | 'starting' | 'cancelled'
}

const activeLobbies = new Map<string, Lobby>()
const playerToLobby = new Map<string, string>()

/** Redis key for the lobby + player→lobby mapping (cross-instance reads). */
const LOBBY_PLAYER_KEY = 'termina:lobby_players'

/** Redis service for the lobby mirror. Set once on boot via configureLobbyRedis. */
let _lobbyRedis: {
  hset: (key: string, field: string, value: string) => Effect.Effect<void>
  hget: (key: string, field: string) => Effect.Effect<string | null>
  hdel: (key: string, field: string) => Effect.Effect<void>
  del: (key: string) => Effect.Effect<void>
  get: (key: string) => Effect.Effect<string | null>
} | null = null

/** Wire up the Redis service for the lobby mirror (P4 Phase 4). In
 * single-instance mode this stays null and the local Maps are the only path. */
export function configureLobbyRedis(redis: typeof _lobbyRedis): void {
  _lobbyRedis = redis
}

/** Serialize a Lobby for Redis storage (Set → array, drop the non-serializable pickTimer). */
function serializeLobby(lobby: Lobby): string {
  return JSON.stringify({
    id: lobby.id,
    players: lobby.players,
    pickedHeroes: [...lobby.pickedHeroes],
    pickOrder: lobby.pickOrder,
    currentPickIndex: lobby.currentPickIndex,
    phase: lobby.phase,
  })
}

/** Deserialize a Lobby from Redis (array → Set, pickTimer = null). */
function deserializeLobby(raw: string): Lobby | null {
  try {
    const data = JSON.parse(raw) as {
      id: string
      players: LobbyPlayer[]
      pickedHeroes: string[]
      pickOrder: number[]
      currentPickIndex: number
      phase: Lobby['phase']
    }
    return {
      id: data.id,
      players: data.players,
      pickedHeroes: new Set(data.pickedHeroes),
      pickOrder: data.pickOrder,
      currentPickIndex: data.currentPickIndex,
      pickTimer: null,
      phase: data.phase,
    }
  } catch {
    return null
  }
}

/** Mirror the lobby to Redis (write-through). Best-effort — failures fall back to local-only. */
function mirrorLobbyToRedis(lobby: Lobby): void {
  if (!_lobbyRedis) return
  try {
    const serialized = serializeLobby(lobby)
    Effect.runSync(_lobbyRedis.hset(LOBBY_PLAYER_KEY, `lobby:${lobby.id}`, serialized))
    // Also map each player to the lobby ID for cross-instance getPlayerLobby.
    for (const p of lobby.players) {
      Effect.runSync(_lobbyRedis.hset(LOBBY_PLAYER_KEY, `player:${p.playerId}`, lobby.id))
    }
  } catch {
    // Redis unavailable — local Map is the source of truth.
  }
}

/** Remove the lobby + player mappings from Redis. Best-effort. */
function unmirrorLobbyFromRedis(lobbyId: string, playerIds: string[]): void {
  if (!_lobbyRedis) return
  try {
    Effect.runSync(_lobbyRedis.hdel(LOBBY_PLAYER_KEY, `lobby:${lobbyId}`))
    for (const pid of playerIds) {
      Effect.runSync(_lobbyRedis.hdel(LOBBY_PLAYER_KEY, `player:${pid}`))
    }
  } catch {
    // Redis unavailable — skip.
  }
}

export function getPlayerLobby(playerId: string): string | undefined {
  // Local first (fast path — the owning instance has the in-process Map).
  const local = playerToLobby.get(playerId)
  if (local) return local
  // Redis fallback (cross-instance — a non-owning instance can find the lobby).
  if (_lobbyRedis) {
    try {
      const lobbyId = Effect.runSync(_lobbyRedis.hget(LOBBY_PLAYER_KEY, `player:${playerId}`))
      if (lobbyId) return lobbyId
    } catch {
      // Redis unavailable.
    }
  }
  return undefined
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
    pickOrder: PICK_SEQUENCE_10.slice(0, players.length),
    currentPickIndex: 0,
    pickTimer: null,
    phase: 'picking', // Draft starts immediately — no ban phase
  }

  activeLobbies.set(lobbyId, lobby)

  for (const p of players) {
    playerToLobby.set(p.playerId, lobbyId)
  }

  // Mirror to Redis for cross-instance reads (P4 Phase 4).
  mirrorLobbyToRedis(lobby)

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
      phase: 'picking',
    })
  }

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

  // Tell all clients whose turn it is and the authoritative deadline so the
  // pick countdown is server-synced instead of a drifting client timer.
  const turnIdx = lobby.pickOrder[lobby.currentPickIndex]
  const turnPlayer = turnIdx !== undefined ? lobby.players[turnIdx] : undefined
  if (turnPlayer) {
    const turnIsBot = isBot(turnPlayer.playerId)
    for (const p of lobby.players) {
      if (isBot(p.playerId)) continue
      sendToPeer(p.playerId, {
        type: 'pick_turn',
        playerId: turnPlayer.playerId,
        username: turnPlayer.username,
        timeRemainingMs: turnIsBot ? BOT_PICK_DELAY_MS : PICK_TIME_MS,
      })
    }
  }

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

  // Mirror the updated lobby to Redis after the pick mutation.
  mirrorLobbyToRedis(lobby)

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

  // Mirror the phase change to Redis.
  mirrorLobbyToRedis(lobby)

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
  const playerIds = lobby.players.map((p) => p.playerId)
  for (const p of lobby.players) {
    playerToLobby.delete(p.playerId)
  }
  activeLobbies.delete(lobbyId)
  // Remove the Redis mirror (P4 Phase 4).
  unmirrorLobbyFromRedis(lobbyId, playerIds)
  lobbyLog.info('Lobby cleaned up', { lobbyId })
}

export function getLobby(lobbyId: string): Lobby | undefined {
  // Local first (fast path — the owning instance has the in-process Map).
  const local = activeLobbies.get(lobbyId)
  if (local) return local
  // Redis fallback (cross-instance — a non-owning instance can read the mirror).
  // Returns a Lobby without a pickTimer (read-only — the caller can't mutate
  // it on a non-owning instance anyway, since mutations run on the owner).
  if (_lobbyRedis) {
    try {
      const raw = Effect.runSync(_lobbyRedis.hget(LOBBY_PLAYER_KEY, `lobby:${lobbyId}`))
      if (raw) return deserializeLobby(raw) ?? undefined
    } catch {
      // Redis unavailable.
    }
  }
  return undefined
}

/**
 * The `pick_turn` payload for a lobby's current picker, or null if it isn't in
 * the picking phase. Used to re-send whose-turn-it-is on (re)connect — without
 * this, a client that connects AFTER the pick_turn push (a refresh, or a seeded
 * draft) never learns it's their turn and CONFIRM stays disabled.
 */
export function currentPickTurn(
  lobby: Lobby,
): { type: 'pick_turn'; playerId: string; username: string; timeRemainingMs: number } | null {
  if (lobby.phase !== 'picking') return null
  const idx = lobby.pickOrder[lobby.currentPickIndex]
  const player = idx !== undefined ? lobby.players[idx] : undefined
  if (!player) return null
  return {
    type: 'pick_turn',
    playerId: player.playerId,
    username: player.username,
    timeRemainingMs: isBot(player.playerId) ? BOT_PICK_DELAY_MS : PICK_TIME_MS,
  }
}

/**
 * Dev/test-only: build a draft lobby frozen at the human's pick turn, with the
 * bots ahead of them in the snake order already picked. No auto-pick timer — the
 * human's pick (via the normal `pickHero` path) RESUMES the real draft: the
 * remaining bots auto-pick and the lobby publishes `matchmaking:game_ready`
 * exactly as a live match would. This is the pre-game/draft analogue of
 * `createDevGame` (which seeds an in-progress game). Inert unless called — only
 * the double-gated /api/test/new-draft hook invokes it.
 *
 * `prepick` = how many snake-order slots are filled (by bots) before the human.
 * 9 ⇒ the human makes the FINAL pick, so a single confirm completes the draft
 * and starts the game; a smaller value leaves the human mid-draft.
 */
export function seedDraftLobby(opts: {
  humanId: string
  humanUsername: string
  prepick?: number
}): Lobby {
  const prepick = Math.max(0, Math.min(PICK_SEQUENCE_10.length - 1, opts.prepick ?? 9))
  const lobbyId = generateId()
  const snakeOrder = [0, 1, 1, 0, 0, 1, 1, 0, 0, 1]
  const humanIndex = PICK_SEQUENCE_10[prepick]!

  let botCount = 0
  const players: LobbyPlayer[] = Array.from({ length: 10 }, (_, i) => {
    const team: TeamId = snakeOrder[i] === 0 ? 'radiant' : 'dire'
    if (i === humanIndex) {
      return {
        playerId: opts.humanId,
        username: opts.humanUsername,
        mmr: 5000,
        team,
        heroId: null,
        ready: false,
      }
    }
    botCount += 1
    return {
      playerId: `bot_draft${botCount}_${lobbyId}`,
      username: `Bot ${botCount}`,
      mmr: 1000,
      team,
      heroId: null,
      ready: false,
    }
  })

  const lobby: Lobby = {
    id: lobbyId,
    players,
    pickedHeroes: new Set(),
    pickOrder: [...PICK_SEQUENCE_10],
    currentPickIndex: prepick,
    pickTimer: null,
    phase: 'picking',
  }

  // Pre-pick distinct heroes for the bots occupying the snake slots before the
  // human; leaves the rest (incl. the human's eventual pick) available.
  for (let k = 0; k < prepick; k++) {
    const slot = PICK_SEQUENCE_10[k]!
    const p = players[slot]!
    const hero = AVAILABLE_HEROES[k % AVAILABLE_HEROES.length]!
    p.heroId = hero
    lobby.pickedHeroes.add(hero)
  }

  activeLobbies.set(lobbyId, lobby)
  for (const p of players) playerToLobby.set(p.playerId, lobbyId)

  // Mirror to Redis (P4 Phase 4).
  mirrorLobbyToRedis(lobby)

  lobbyLog.info('Seeded draft lobby', { lobbyId, prepick, humanIndex, humanId: opts.humanId })
  return lobby
}

export function cancelLobby(lobbyId: string, _ws: WebSocketServiceApi): void {
  const lobby = activeLobbies.get(lobbyId)
  if (!lobby) return
  const playerIds = lobby.players.map((p) => p.playerId)

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
  // Remove the Redis mirror.
  unmirrorLobbyFromRedis(lobbyId, playerIds)
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
  // Mirror the updated lobby to Redis.
  mirrorLobbyToRedis(lobby)
  return { success: true }
}
